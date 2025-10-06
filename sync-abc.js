/**
 * SYNC MANUAL CON ABC SOLR
 * 
 * Este script consulta ABC Solr y llena la base de datos con ofertas reales
 * Filtro: estado:publicada (solo ofertas válidas post-adjudicación)
 * 
 * Ejecutar: node sync-abc.js
 */

require('dotenv').config();
const axios = require('axios');
const { query, testConnection } = require('./src/config/database');

// Configuración ABC Solr
const ABC_BASE_URL = process.env.ABC_SOLR_URL || 
  'https://servicios3.abc.gob.ar/valoracion.docente/api/apd.oferta.encabezado';

// Colores para terminal
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m'
};

const log = {
  success: (msg) => console.log(`${colors.green}✓${colors.reset} ${msg}`),
  error: (msg) => console.log(`${colors.red}✗${colors.reset} ${msg}`),
  info: (msg) => console.log(`${colors.blue}ℹ${colors.reset} ${msg}`),
  warn: (msg) => console.log(`${colors.yellow}⚠${colors.reset} ${msg}`),
  progress: (msg) => console.log(`${colors.cyan}➜${colors.reset} ${msg}`),
  data: (msg) => console.log(`${colors.magenta}◆${colors.reset} ${msg}`)
};

/**
 * Construir query string para Solr
 */
function buildSolrQuery(params) {
  const parts = [];
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      value.forEach(v => parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(v)}`));
    } else {
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
    }
  }
  return parts.join('&');
}

/**
 * Consultar ABC Solr con paginación
 */
async function fetchFromABC(start = 0, rows = 100) {
  try {
    const params = {
      q: '*:*',
      fq: 'estado:publicada', // FILTRO CRÍTICO
      rows: rows,
      start: start,
      sort: 'finoferta desc',
      'json.nl': 'map',
      wt: 'json'
    };

    const queryString = buildSolrQuery(params);
    const url = `${ABC_BASE_URL}/select?${queryString}`;

    log.progress(`Consultando ABC: start=${start}, rows=${rows}`);
    
    const response = await axios.get(url, {
      timeout: 30000,
      headers: { 'Accept': 'application/json' }
    });

    // ABC a veces devuelve JSONP, limpiar si es necesario
    let data = response.data;
    if (typeof data === 'string') {
      const match = data.match(/^[a-zA-Z_]\w*\((.*)\)\s*$/s);
      if (match) {
        data = JSON.parse(match[1]);
      } else {
        data = JSON.parse(data);
      }
    }

    return {
      docs: data.response.docs || [],
      numFound: data.response.numFound || 0
    };

  } catch (error) {
    log.error(`Error al consultar ABC: ${error.message}`);
    throw error;
  }
}

/**
 * Extraer horarios de un documento ABC
 */
function extractHorarios(doc) {
  const dias = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
  const horarios = [];
  
  dias.forEach(dia => {
    const valor = doc[dia];
    if (valor && String(valor).trim() !== '') {
      horarios.push({
        dia: dia.charAt(0).toUpperCase() + dia.slice(1),
        hora: String(valor).trim()
      });
    }
  });
  
  return horarios;
}

/**
 * Limpiar y normalizar texto
 */
function cleanText(text) {
  if (!text) return null;
  return String(text)
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Parsear una oferta de ABC a nuestro formato
 */
function parseOffer(doc) {
  return {
    id: doc.id || doc.iddetalle,
    cargo: cleanText(doc.cargo || doc.descripcioncargo),
    distrito: cleanText(doc.descdistrito)?.toLowerCase(),
    modalidad: cleanText(doc.descnivelmodalidad)?.toLowerCase(),
    escuela: cleanText(doc.escuela),
    curso_division: cleanText(doc.cursodivision),
    turno: doc.turno || null,
    revista: doc.supl_revista || null,
    horas_modulos: doc.hsmodulos || 0,
    desde: doc.supl_desde ? doc.supl_desde.split('T')[0] : null,
    hasta: doc.supl_hasta ? doc.supl_hasta.split('T')[0] : null,
    horarios: extractHorarios(doc),
    domicilio: cleanText(doc.domiciliodesempeno),
    reemplaza_nombre: cleanText(doc.reemp_apeynom),
    reemplazo_motivo: cleanText(doc.reemp_motivo),
    cierre_oferta: doc.finoferta || null,
    raw_data: doc
  };
}

/**
 * Guardar ofertas en la base de datos
 */
async function saveOffers(offers) {
  let saved = 0;
  let updated = 0;
  let errors = 0;

  for (const offer of offers) {
    try {
      const result = await query(
        `INSERT INTO offers (
          id, cargo, distrito, modalidad, escuela, 
          curso_division, turno, revista, horas_modulos,
          desde, hasta, horarios, domicilio,
          reemplaza_nombre, reemplazo_motivo, cierre_oferta,
          raw_data, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, NOW(), NOW())
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
        RETURNING (xmax = 0) AS inserted`,
        [
          offer.id,
          offer.cargo,
          offer.distrito,
          offer.modalidad,
          offer.escuela,
          offer.curso_division,
          offer.turno,
          offer.revista,
          offer.horas_modulos,
          offer.desde,
          offer.hasta,
          JSON.stringify(offer.horarios),
          offer.domicilio,
          offer.reemplaza_nombre,
          offer.reemplazo_motivo,
          offer.cierre_oferta,
          JSON.stringify(offer.raw_data)
        ]
      );

      if (result.rows[0].inserted) {
        saved++;
      } else {
        updated++;
      }

    } catch (error) {
      errors++;
      log.error(`Error al guardar oferta ${offer.id}: ${error.message}`);
    }
  }

  return { saved, updated, errors };
}

/**
 * Asociar ofertas con usuarios según sus preferencias
 */
async function associateOffersWithUsers() {
  try {
    log.info('Asociando ofertas con usuarios según preferencias...');

    // Obtener usuarios con preferencias
    const usersResult = await query(`
      SELECT u.id, up.modalidades, up.distritos, up.turnos
      FROM users u
      JOIN user_preferences up ON u.id = up.user_id
      WHERE u.is_active = true
    `);

    if (usersResult.rows.length === 0) {
      log.warn('No hay usuarios activos para asociar ofertas');
      return;
    }

    let totalAssociations = 0;

    for (const user of usersResult.rows) {
      const modalidades = user.modalidades || [];
      const distritos = user.distritos || [];
      const turnos = user.turnos || [];

      if (modalidades.length === 0 && distritos.length === 0) {
        continue; // Sin preferencias configuradas
      }

      // Construir query dinámico
      let whereConditions = ['o.hasta >= CURRENT_DATE'];
      let params = [user.id];
      let paramIndex = 2;

      if (modalidades.length > 0) {
        whereConditions.push(`LOWER(o.modalidad) = ANY($${paramIndex})`);
        params.push(modalidades.map(m => m.toLowerCase()));
        paramIndex++;
      }

      if (distritos.length > 0) {
        whereConditions.push(`LOWER(o.distrito) = ANY($${paramIndex})`);
        params.push(distritos.map(d => d.toLowerCase()));
        paramIndex++;
      }

      if (turnos.length > 0) {
        const turnoMap = { 'mañana': 'M', 'tarde': 'T', 'noche': 'N' };
        const turnosCodes = turnos.map(t => turnoMap[t.toLowerCase()] || t);
        whereConditions.push(`o.turno = ANY($${paramIndex})`);
        params.push(turnosCodes);
        paramIndex++;
      }

      // Insertar asociaciones
      const insertQuery = `
        INSERT INTO user_offers (user_id, offer_id, is_new, created_at)
        SELECT $1, o.id, true, NOW()
        FROM offers o
        WHERE ${whereConditions.join(' AND ')}
        AND NOT EXISTS (
          SELECT 1 FROM user_offers uo 
          WHERE uo.user_id = $1 AND uo.offer_id = o.id
        )
      `;

      const result = await query(insertQuery, params);
      totalAssociations += result.rowCount;
    }

    log.success(`${totalAssociations} asociaciones creadas entre usuarios y ofertas`);

  } catch (error) {
    log.error(`Error al asociar ofertas: ${error.message}`);
  }
}

/**
 * Función principal
 */
async function main() {
  console.log('\n' + '='.repeat(70));
  console.log('🔄 SYNC MANUAL CON ABC SOLR');
  console.log('='.repeat(70) + '\n');

  try {
    // Verificar conexión a DB
    log.info('Verificando conexión a base de datos...');
    const connected = await testConnection();
    
    if (!connected) {
      log.error('No se pudo conectar a la base de datos');
      process.exit(1);
    }

    log.success('Conectado a PostgreSQL');

    // Paso 1: Consultar total de ofertas
    log.info('\nConsultando total de ofertas en ABC...');
    const firstPage = await fetchFromABC(0, 1);
    const totalOffers = firstPage.numFound;
    
    log.data(`Total de ofertas con estado:publicada = ${totalOffers}`);

    if (totalOffers === 0) {
      log.warn('No hay ofertas publicadas en ABC Solr');
      return;
    }

    // Paso 2: Consultar todas las páginas
    log.info('\nDescargando ofertas desde ABC...');
    
    const ROWS_PER_PAGE = 100;
    const totalPages = Math.ceil(totalOffers / ROWS_PER_PAGE);
    let allOffers = [];

    for (let page = 0; page < totalPages; page++) {
      const start = page * ROWS_PER_PAGE;
      const result = await fetchFromABC(start, ROWS_PER_PAGE);
      allOffers = allOffers.concat(result.docs);
      
      const progress = Math.round((allOffers.length / totalOffers) * 100);
      log.progress(`Descargadas ${allOffers.length}/${totalOffers} ofertas (${progress}%)`);
      
      // Delay para no saturar el servidor ABC
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    log.success(`${allOffers.length} ofertas descargadas`);

    // Paso 3: Parsear ofertas
    log.info('\nParseando ofertas...');
    const parsedOffers = allOffers.map(doc => parseOffer(doc));
    log.success(`${parsedOffers.length} ofertas parseadas`);

    // Mostrar muestra de datos
    if (parsedOffers.length > 0) {
      log.info('\nMuestra de primera oferta:');
      const sample = parsedOffers[0];
      console.log(`  ID: ${sample.id}`);
      console.log(`  Cargo: ${sample.cargo}`);
      console.log(`  Distrito: ${sample.distrito}`);
      console.log(`  Modalidad: ${sample.modalidad}`);
      console.log(`  Escuela: ${sample.escuela}`);
      console.log(`  Turno: ${sample.turno}`);
      console.log(`  Horarios: ${JSON.stringify(sample.horarios)}`);
    }

    // Paso 4: Guardar en base de datos
    log.info('\nGuardando ofertas en base de datos...');
    const stats = await saveOffers(parsedOffers);
    
    log.success(`Ofertas guardadas: ${stats.saved}`);
    log.success(`Ofertas actualizadas: ${stats.updated}`);
    if (stats.errors > 0) {
      log.warn(`Errores: ${stats.errors}`);
    }

    // Paso 5: Asociar con usuarios
    await associateOffersWithUsers();

    // Estadísticas finales
    console.log('\n' + '='.repeat(70));
    log.success('SYNC COMPLETADO EXITOSAMENTE');
    console.log('='.repeat(70));
    
    const finalStats = await query('SELECT COUNT(*) as total FROM offers');
    log.data(`Total de ofertas en base de datos: ${finalStats.rows[0].total}`);

    // Contar por modalidad
    const byModalidad = await query(`
      SELECT modalidad, COUNT(*) as count
      FROM offers
      GROUP BY modalidad
      ORDER BY count DESC
    `);

    console.log('\n📊 Ofertas por modalidad:');
    byModalidad.rows.forEach(row => {
      console.log(`  ${row.modalidad}: ${row.count}`);
    });

    console.log('\n✅ Ahora puedes usar el backend con datos reales!\n');

  } catch (error) {
    log.error(`Error fatal: ${error.message}`);
    console.error(error);
    process.exit(1);
  }

  process.exit(0);
}

// Ejecutar
main();