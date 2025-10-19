// jobs/syncOffers.js
// ========================================
// SYNC OFFERS FROM ABC SOLR (optimizado + vigencia)
// Upsert por lotes + limpieza + job_runs + desactivación
// ========================================

require('dotenv').config();
const { query } = require('../src/config/database');

// ----------------------------------------
// Helpers de limpieza (tus originales)
// ----------------------------------------
function cleanOfferDates(offer) {
  try {
    const desdeField = offer.supl_desde || offer.desde;
    const hastaField = offer.supl_hasta || offer.hasta;

    const desde = desdeField ? new Date(desdeField) : null;
    const hasta = hastaField ? new Date(hastaField) : null;

    if (desde && isNaN(desde.getTime())) {
      console.warn(`[SYNC] Oferta ${offer.id}: fecha 'desde' inválida (${desdeField}) - anulando`);
      return { desde: null, hasta: hastaField || null };
    }
    if (hasta && isNaN(hasta.getTime())) {
      console.warn(`[SYNC] Oferta ${offer.id}: fecha 'hasta' inválida (${hastaField}) - anulando`);
      return { desde: desdeField || null, hasta: null };
    }
    if (desde && hasta && hasta < desde) {
      console.warn(
        `[SYNC] Oferta ${offer.id}: fechas ilógicas (desde:${desdeField}, hasta:${hastaField}) - anulando ambas`
      );
      return { desde: null, hasta: null };
    }
    return { desde: desdeField || null, hasta: hastaField || null };
  } catch (e) {
    console.error(`[SYNC] Error limpiando fechas de oferta ${offer.id}:`, e.message);
    return { desde: null, hasta: null };
  }
}

function cleanOfferCodes(offer) {
  let turno = offer.turno ? offer.turno.toString().trim().substring(0, 1).toUpperCase() : null;
  const validTurnos = ['M', 'T', 'N', 'V', 'A'];
  if (turno && !validTurnos.includes(turno)) {
    console.warn(`[SYNC] Oferta ${offer.id}: turno inválido (${offer.turno}) - anulando`);
    turno = null;
  }

  const revistaField = offer.supl_revista || offer.revista || '';
  let revista = revistaField ? revistaField.toString().trim().substring(0, 1).toUpperCase() : null;
  const validRevistas = ['S', 'T', 'I', 'P'];
  if (revista && !validRevistas.includes(revista)) {
    console.warn(`[SYNC] Oferta ${offer.id}: revista inválida (${revistaField}) - anulando`);
    revista = null;
  }
  return { turno, revista };
}

function extractHorarios(offer) {
  const dias = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
  const horarios = [];
  dias.forEach((dia) => {
    const horario = offer[dia];
    if (horario && String(horario).trim() !== '') {
      horarios.push({
        dia: dia.charAt(0).toUpperCase() + dia.slice(1),
        hora: String(horario).trim(),
      });
    }
  });
  return horarios;
}

// ----------------------------------------
// Upsert MASIVO por lotes (500) + vigencia
// Usa RETURNING (xmax=0) para contar inserts
// ----------------------------------------
async function bulkUpsertOffers(rows, beforeUpsertTimestamp, batchSize = 500) {
  if (!rows || !rows.length) return { inserted: 0, updated: 0, processed: 0 };

  const baseCols = [
    'id',
    'cargo',
    'distrito',
    'modalidad',
    'escuela',
    'curso_division',
    'turno',
    'revista',
    'horas_modulos',
    'desde',
    'hasta',
    'horarios',
    'domicilio',
    'reemplazo_motivo',
    'cierre_oferta',
    'raw_data',
    'is_active',
    'first_seen_at',
    'last_seen_at'
  ];
  const insertCols = [...baseCols, 'updated_at'];

  let inserted = 0;
  let updated = 0;
  let processed = 0;

  await query('BEGIN');

  try {
    for (let i = 0; i < rows.length; i += batchSize) {
      const chunk = rows.slice(i, i + batchSize);
      const values = [];

      const placeholders = chunk
        .map((r, idx) => {
          const base = idx * baseCols.length;
          values.push(
            r.id,
            r.cargo ?? null,
            r.distrito ?? null,
            r.modalidad ?? null,
            r.escuela ?? null,
            r.curso_division ?? null,
            r.turno ?? null,
            r.revista ?? null,
            r.horas_modulos ?? null,
            r.desde ?? null,
            r.hasta ?? null,
            r.horarios ? JSON.stringify(r.horarios) : null,
            r.domicilio ?? null,
            r.reemplazo_motivo ?? null,
            r.cierre_oferta ?? null,
            r.raw_data ? JSON.stringify(r.raw_data) : null,
            true,
            beforeUpsertTimestamp.toISOString(),
            beforeUpsertTimestamp.toISOString()
          );
          const ph = baseCols.map((_, j) => `$${base + j + 1}`).join(', ');
          return `(${ph}, NOW())`;
        })
        .join(', ');

      const updates = `
        cargo = EXCLUDED.cargo,
        distrito = EXCLUDED.distrito,
        modalidad = EXCLUDED.modalidad,
        escuela = EXCLUDED.escuela,
        curso_division = EXCLUDED.curso_division,
        turno = EXCLUDED.turno,
        revista = EXCLUDED.revista,
        horas_modulos = EXCLUDED.horas_modulos,
        desde = EXCLUDED.desde,
        hasta = EXCLUDED.hasta,
        horarios = EXCLUDED.horarios,
        domicilio = EXCLUDED.domicilio,
        reemplazo_motivo = EXCLUDED.reemplazo_motivo,
        cierre_oferta = EXCLUDED.cierre_oferta,
        raw_data = EXCLUDED.raw_data,
        is_active = TRUE,
        last_seen_at = EXCLUDED.last_seen_at,
        updated_at = NOW()
      `;

      const sql = `
        INSERT INTO offers (${insertCols.join(',')})
        VALUES ${placeholders}
        ON CONFLICT (id) DO UPDATE SET
          ${updates}
        RETURNING (xmax = 0) AS inserted
      `;

      const res = await query(sql, values);
      res.rows.forEach((r) => (r.inserted ? inserted++ : updated++));
      processed += chunk.length;

      if ((i + chunk.length) % 500 === 0 || i + chunk.length >= rows.length) {
        console.log(`   Procesadas: ${i + chunk.length}/${rows.length}`);
      }
    }

    await query('COMMIT');
    return { inserted, updated, processed };
  } catch (e) {
    await query('ROLLBACK');
    throw e;
  }
}

// ----------------------------------------
// SYNC PRINCIPAL con job_runs + desactivación
// ----------------------------------------
async function syncOffersFromABC() {
  console.log('🔄 Iniciando sync con ABC Solr...');
  const wallStart = Date.now();

  const open = await query(
    "INSERT INTO job_runs(kind) VALUES('sync') RETURNING id, started_at"
  );
  const runId = open.rows[0].id;
  const startedAt = open.rows[0].started_at;

  let cleanedDatesCount = 0;
  let cleanedCodesCount = 0;

  try {
    const ABC_SOLR_URL =
      process.env.ABC_SOLR_URL ||
      'https://servicios3.abc.gob.ar/valoracion.docente/api/apd.oferta.encabezado';

    const params = new URLSearchParams({
      q: '*:*',
      fq: 'estado:publicada',
      rows: 5000,
      wt: 'json',
      sort: 'finoferta desc'
    });

    const url = `${ABC_SOLR_URL}/select?${params}`;
    console.log('📡 Consultando ABC Solr...');

    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);

    const data = await response.json();
    const offers = data.response?.docs || [];
    console.log(`📊 Ofertas obtenidas: ${offers.length}`);

    if (offers.length === 0) {
      const deact = await query('SELECT public.deactivate_offers_before($1) AS deact', [startedAt]);
      await query(
        `UPDATE job_runs
         SET finished_at = NOW(),
             offers_seen = 0,
             offers_activated = 0,
             offers_deactivated = $1
         WHERE id = $2`,
        [deact.rows[0].deact || 0, runId]
      );
      console.log('⚠️  Sin ofertas publicadas (se aplicó desactivación si correspondía).');
      return { success: true, insertadas: 0, actualizadas: 0, total: 0, deactivated: deact.rows[0].deact || 0 };
    }

    const rows = offers.map((offer) => {
      const { desde, hasta } = cleanOfferDates(offer);
      const { turno, revista } = cleanOfferCodes(offer);

      if (
        (offer.supl_desde || offer.desde || offer.supl_hasta || offer.hasta) &&
        desde === null && hasta === null
      ) cleanedDatesCount++;

      if ((offer.turno && !turno) || ((offer.supl_revista || offer.revista) && !revista))
        cleanedCodesCount++;

      return {
        id: offer.id || offer.idoferta,
        cargo: offer.cargo || offer.descripcioncargo,
        distrito: offer.descdistrito ? offer.descdistrito.toLowerCase() : null,
        modalidad: offer.descnivelmodalidad ? offer.descnivelmodalidad.toLowerCase() : null,
        escuela: offer.escuela || offer.codestablecimiento,
        curso_division: offer.cursodivision || offer.curso_division || null,
        turno,
        revista,
        horas_modulos: offer.hsmodulos || offer.horas_modulos || null,
        desde,
        hasta,
        horarios: extractHorarios(offer),
        domicilio: offer.domiciliodesempeno || offer.domicilio || null,
        reemplazo_motivo: offer.reemp_motivo || null,
        cierre_oferta: offer.finoferta || offer.cierre_oferta || null,
        raw_data: offer
      };
    });

    const beforeUpsert = new Date();
    const res = await bulkUpsertOffers(rows, beforeUpsert, 500);
    const deact = await query('SELECT public.deactivate_offers_before($1) AS deact', [beforeUpsert]);

    await query(
      `UPDATE job_runs
         SET finished_at = NOW(),
             offers_seen = $1,
             offers_activated = $2,
             offers_deactivated = $3,
             notes = $4
       WHERE id = $5`,
      [
        offers.length,
        res.inserted,
        deact.rows[0].deact || 0,
        `cleanedDates=${cleanedDatesCount}; cleanedCodes=${cleanedCodesCount}`,
        runId
      ]
    );

    const duration = ((Date.now() - wallStart) / 1000).toFixed(2);
    console.log(`✅ Sync completado en ${duration}s`);
    console.log(`   📥 Insertadas: ${res.inserted}`);
    console.log(`   🔄 Actualizadas: ${res.updated}`);
    if (cleanedDatesCount > 0) console.log(`   🧹 Fechas limpiadas: ${cleanedDatesCount}`);
    if (cleanedCodesCount > 0) console.log(`   🧹 Códigos limpiados: ${cleanedCodesCount}`);
    console.log(`   📴 Desactivadas (no vistas): ${deact.rows[0].deact || 0}`);

    return {
      success: true,
      insertadas: res.inserted,
      actualizadas: res.updated,
      cleanedDates: cleanedDatesCount,
      cleanedCodes: cleanedCodesCount,
      total: offers.length,
      deactivated: deact.rows[0].deact || 0,
      duration: parseFloat(duration)
    };
  } catch (error) {
    await query(
      `UPDATE job_runs
         SET finished_at = NOW(),
             notes = $1
       WHERE id = $2`,
      [`ERROR: ${error.message}`, runId]
    );

    const duration = ((Date.now() - wallStart) / 1000).toFixed(2);
    console.error(`❌ Error en sync (${duration}s):`, error.message);
    return { success: false, error: error.message, duration: parseFloat(duration) };
  }
}

module.exports = { syncOffersFromABC };

if (require.main === module) {
  syncOffersFromABC()
    .then((r) => {
      console.log('ℹ️ Resultado:', r);
      process.exit(r && r.success ? 0 : 1);
    })
    .catch((e) => {
      console.error('❌ Sync terminó con error:', e);
      process.exit(1);
    });
}
