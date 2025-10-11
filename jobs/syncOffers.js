// ========================================
// SYNC OFFERS FROM ABC SOLR
// Sincroniza ofertas desde el sistema ABC
// con limpieza de datos inconsistentes
// ========================================

const { query } = require('../src/config/database');

// ========================================
// FUNCIÓN: Limpiar fechas ilógicas
// ========================================
function cleanOfferDates(offer) {
  try {
    const desdeField = offer.supl_desde || offer.desde;
    const hastaField = offer.supl_hasta || offer.hasta;
    
    const desde = desdeField ? new Date(desdeField) : null;
    const hasta = hastaField ? new Date(hastaField) : null;

    // Validar que las fechas sean válidas
    if (desde && isNaN(desde.getTime())) {
      console.warn(`[SYNC] Oferta ${offer.id}: fecha 'desde' inválida (${desdeField}) - anulando`);
      return { desde: null, hasta: hastaField };
    }

    if (hasta && isNaN(hasta.getTime())) {
      console.warn(`[SYNC] Oferta ${offer.id}: fecha 'hasta' inválida (${hastaField}) - anulando`);
      return { desde: desdeField, hasta: null };
    }

    // Si hasta < desde, anular ambas fechas
    if (desde && hasta && hasta < desde) {
      console.warn(
        `[SYNC] Oferta ${offer.id}: fechas ilógicas detectadas ` +
        `(desde: ${desdeField}, hasta: ${hastaField}) - anulando ambas fechas`
      );
      return { desde: null, hasta: null };
    }

    // Si las fechas son válidas, devolverlas normales
    return {
      desde: desdeField || null,
      hasta: hastaField || null
    };
  } catch (error) {
    console.error(`[SYNC] Error limpiando fechas de oferta ${offer.id}:`, error.message);
    return { desde: null, hasta: null };
  }
}

// ========================================
// FUNCIÓN: Limpiar turno y revista
// ========================================
function cleanOfferCodes(offer) {
  // Turno: solo primer carácter, uppercase
  let turno = offer.turno ? offer.turno.toString().trim().substring(0, 1).toUpperCase() : null;
  
  // Validar que turno sea válido
  const validTurnos = ['M', 'T', 'N', 'V', 'A'];
  if (turno && !validTurnos.includes(turno)) {
    console.warn(`[SYNC] Oferta ${offer.id}: turno inválido (${offer.turno}) - anulando`);
    turno = null;
  }

  // Revista: solo primer carácter, uppercase (con fallback)
  const revistaField = offer.supl_revista || offer.revista || '';
  let revista = revistaField ? revistaField.toString().trim().substring(0, 1).toUpperCase() : null;
  
  // Validar que revista sea válida
  const validRevistas = ['S', 'T', 'I', 'P'];
  if (revista && !validRevistas.includes(revista)) {
    console.warn(`[SYNC] Oferta ${offer.id}: revista inválida (${revistaField}) - anulando`);
    revista = null;
  }

  return { turno, revista };
}

/**
 * Extrae horarios de los días de la semana
 */
function extractHorarios(offer) {
  const dias = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
  const horarios = [];
  
  dias.forEach(dia => {
    const horario = offer[dia];
    if (horario && String(horario).trim() !== '') {
      horarios.push({
        dia: dia.charAt(0).toUpperCase() + dia.slice(1),
        hora: String(horario).trim()
      });
    }
  });
  
  return horarios;
}

/**
 * Sincroniza ofertas desde ABC Solr a la base de datos
 * Filtra solo ofertas con estado "publicada"
 */
async function syncOffersFromABC() {
  console.log('🔄 Iniciando sync con ABC Solr...');
  const startTime = Date.now();
  
  let cleanedDatesCount = 0;
  let cleanedCodesCount = 0;
  
  try {
    const ABC_SOLR_URL = process.env.ABC_SOLR_URL || 'https://servicios3.abc.gob.ar/valoracion.docente/api/apd.oferta.encabezado';
    
    // Construir query para obtener TODAS las ofertas publicadas
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
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const data = await response.json();
    const offers = data.response?.docs || [];
    
    console.log(`📊 Ofertas obtenidas: ${offers.length}`);
    
    if (offers.length === 0) {
      console.log('⚠️ No se encontraron ofertas publicadas');
      return { success: true, insertadas: 0, actualizadas: 0, total: 0 };
    }
    
    let insertadas = 0;
    let actualizadas = 0;
    let errores = 0;
    
    // Procesar ofertas en lotes de 100
    const batchSize = 100;
    for (let i = 0; i < offers.length; i += batchSize) {
      const batch = offers.slice(i, i + batchSize);
      
      for (const offer of batch) {
        try {
          // 👇 LIMPIEZA DE DATOS (LO NUEVO)
          const cleanedDates = cleanOfferDates(offer);
          const cleanedCodes = cleanOfferCodes(offer);
          
          // Contar limpiezas
          if (cleanedDates.desde === null && cleanedDates.hasta === null && 
              (offer.supl_desde || offer.desde || offer.supl_hasta || offer.hasta)) {
            cleanedDatesCount++;
          }
          if ((cleanedCodes.turno === null && offer.turno) || 
              (cleanedCodes.revista === null && (offer.supl_revista || offer.revista))) {
            cleanedCodesCount++;
          }
          // 👆 FIN LIMPIEZA
          
          const horarios = extractHorarios(offer);
          
          const result = await query(`
            INSERT INTO offers (
              id, cargo, distrito, modalidad, escuela, 
              curso_division, turno, revista, horas_modulos,
              desde, hasta, horarios, domicilio,
              reemplaza_nombre, reemplazo_motivo, cierre_oferta,
              raw_data, updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, NOW())
            ON CONFLICT (id) DO UPDATE SET
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
              reemplaza_nombre = EXCLUDED.reemplaza_nombre,
              reemplazo_motivo = EXCLUDED.reemplazo_motivo,
              cierre_oferta = EXCLUDED.cierre_oferta,
              raw_data = EXCLUDED.raw_data,
              updated_at = NOW()
            RETURNING (xmax = 0) AS inserted
          `, [
            offer.id || offer.idoferta,
            offer.cargo || offer.descripcioncargo,
            offer.descdistrito?.toLowerCase(),
            offer.descnivelmodalidad?.toLowerCase(),
            offer.escuela || offer.codestablecimiento,
            offer.cursodivision || offer.curso_division,
            cleanedCodes.turno,        // 👈 LIMPIADO
            cleanedCodes.revista,      // 👈 LIMPIADO
            offer.hsmodulos || offer.horas_modulos,
            cleanedDates.desde,        // 👈 LIMPIADO
            cleanedDates.hasta,        // 👈 LIMPIADO
            JSON.stringify(horarios),
            offer.domiciliodesempeno || offer.domicilio,
            offer.reemp_apeynom,
            offer.reemp_motivo,
            offer.finoferta || offer.cierre_oferta,
            JSON.stringify(offer)
          ]);
          
          if (result.rows[0].inserted) {
            insertadas++;
          } else {
            actualizadas++;
          }
        } catch (error) {
          errores++;
          if (errores <= 3) {
            console.error(`\n❌ Error procesando oferta ${offer.id}:`);
            console.error('Mensaje:', error.message);
            console.error('Stack:', error.stack);
          }
        }
      }
      
      // Log progreso cada 100 ofertas
      if ((i + batchSize) % 500 === 0 || i + batchSize >= offers.length) {
        console.log(`   Procesadas: ${Math.min(i + batchSize, offers.length)}/${offers.length}`);
      }
    }
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`✅ Sync completado en ${duration}s`);
    console.log(`   📥 Insertadas: ${insertadas}`);
    console.log(`   🔄 Actualizadas: ${actualizadas}`);
    if (cleanedDatesCount > 0) {
      console.log(`   🧹 Fechas limpiadas: ${cleanedDatesCount}`);
    }
    if (cleanedCodesCount > 0) {
      console.log(`   🧹 Códigos limpiados: ${cleanedCodesCount}`);
    }
    if (errores > 0) {
      console.log(`   ⚠️ Errores: ${errores}`);
    }
    
    return { 
      success: true, 
      insertadas, 
      actualizadas, 
      errores,
      cleanedDates: cleanedDatesCount,
      cleanedCodes: cleanedCodesCount,
      total: offers.length,
      duration: parseFloat(duration)
    };
    
  } catch (error) {
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.error(`❌ Error en sync (${duration}s):`, error.message);
    return { 
      success: false, 
      error: error.message,
      duration: parseFloat(duration)
    };
  }
}

module.exports = { syncOffersFromABC };
