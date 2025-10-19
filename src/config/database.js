// src/config/database.js
// Conexión PG solo desde variables de entorno (sin .env, sin fallback a localhost).
// Exports: { query, pool }

const { Pool } = require('pg');

// [change] Tomar cadena directa si existe
const CNX = process.env.DATABASE_URL || null;

// [change] Resolver SSL sólo si corresponde (Supabase/Neon o DB_SSL=true)
function sslNeededFromEnvOrCnx(cnx) {
  const looksSupabaseOrNeon = cnx && /supabase\.co|neon\.tech/i.test(cnx);
  const forced = (process.env.DB_SSL || '').toLowerCase() === 'true';
  return looksSupabaseOrNeon || forced ? { rejectUnauthorized: false } : undefined;
}

let pool;

if (CNX) {
  // [change] Modo DATABASE_URL (preferido)
  pool = new Pool({
    connectionString: CNX,
    ssl: sslNeededFromEnvOrCnx(CNX),
    application_name: 'apd-sync',
  });
  console.log('✓ DB config: DATABASE_URL');
} else {
  // [change] Modo DB_* (todas requeridas). Si falta alguna → error claro.
  const cfg = {
    host: process.env.DB_HOST,
    port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : undefined,
    user: process.env.DB_USER || process.env.PGUSER,
    password: process.env.DB_PASSWORD || process.env.PGPASSWORD,
    database: process.env.DB_NAME || process.env.PGDATABASE,
    application_name: 'apd-sync',
  };

  const missing = Object.entries(cfg)
    .filter(([k, v]) => k !== 'application_name' && !v)
    .map(([k]) => k);

  if (missing.length) {
    throw new Error(
      `No hay configuración de DB en variables de entorno. ` +
      `Definí DATABASE_URL o DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME. ` +
      `Faltan: ${missing.join(', ')}`
    );
  }

  pool = new Pool({ ...cfg, ssl: sslNeededFromEnvOrCnx(null) });
  console.log('✓ DB config: DB_*');
}

// Forzar sesión UTF-8 y strings estándar en cada conexión
pool.on('connect', async (client) => {
  try {
    await client.query("SET client_encoding TO 'UTF8'; SET standard_conforming_strings = on;");
  } catch (e) {
    console.warn('[DB] No se pudo setear client_encoding:', e.message);
  }
});

// Manejadores de pool (sin datos sensibles)
pool.on('error', (err) => {
  console.error('❌ Postgres pool error:', err);
  process.exit(1);
});

async function query(text, params) {
  const client = await pool.connect();
  try {
    return await client.query(text, params);
  } finally {
    client.release();
  }
}

module.exports = { query, pool };
