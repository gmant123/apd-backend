// src/config/database.js
require('dotenv').config();
const { Pool } = require('pg');

/**
 * Preferimos DATABASE_URL (como da Supabase).
 * Si no está, usamos variables sueltas.
 * SSL: se habilita para Supabase/Neon o si DB_SSL='true'.
 */
const connectionString = process.env.DATABASE_URL;

const isSupabase =
  connectionString && /supabase\.co/i.test(connectionString);

const sslConfig =
  process.env.DB_SSL === 'true' || isSupabase
    ? { rejectUnauthorized: false }
    : undefined;

const pool = connectionString
  ? new Pool({ connectionString, ssl: sslConfig })
  : new Pool({
      host: process.env.DB_HOST || '127.0.0.1',
      port: parseInt(process.env.DB_PORT || '5432', 10),
      user: process.env.DB_USER || process.env.PGUSER,
      password: process.env.DB_PASSWORD || process.env.PGPASSWORD,
      database: process.env.DB_NAME || process.env.PGDATABASE,
      ssl: sslConfig,
    });

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
