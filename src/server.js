const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const { v4: uuidv4 } = require('uuid');

// Config & rutas
const pool = require('./config/database');
const authRoutes = require('./routes/auth');
const preferencesRoutes = require('./routes/preferences');
const offersRoutes = require('./routes/offers');
const usersRoutes = require('./routes/users');

// Jobs
const { syncOffersFromABC } = require('../jobs/syncOffers');
const { sendDailyNotifications } = require('../jobs/notifications');
const { initializeFirebase } = require('../services/firebase');

const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3000;
const AR_TZ = 'America/Argentina/Buenos_Aires';

// ======================
// REQUEST-ID
// ======================
app.use((req, res, next) => {
  req.id = uuidv4();
  res.setHeader('X-Request-ID', req.id);
  next();
});

// ======================
/* CORS (whitelist + permitir sin origin: apps móviles) */
const allowedOrigins = [
  'http://localhost:8081',
  'http://localhost:19006',
  'http://localhost:19000',
  'http://localhost:3000',
];

app.use(
  cors({
    origin(origin, cb) {
      if (!origin) return cb(null, true);
      if (allowedOrigins.includes(origin)) return cb(null, true);
      // En dev, permitir todo; en prod, comentar la línea:
      return cb(null, true);
    },
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization'],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  })
);

// ======================
// BASIC AUTH (para endpoints internos)
// ======================
const basicAuth = (req, res, next) => {
  const hdr = req.headers.authorization;
  if (!hdr || !hdr.startsWith('Basic ')) {
    res.setHeader('WWW-Authenticate', 'Basic realm="APD Backend"');
    return res.status(401).json({ success: false, message: 'Autenticación requerida' });
  }
  const [username, password] = Buffer.from(hdr.split(' ')[1], 'base64')
    .toString('ascii')
    .split(':');

  const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'apd_admin';
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

  if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) return next();
  res.setHeader('WWW-Authenticate', 'Basic realm="APD Backend"');
  return res.status(401).json({ success: false, message: 'Credenciales inválidas' });
};

// ======================
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ======================
// RUTAS
// ======================
app.get('/', basicAuth, (_req, res) => {
  res.json({
    success: true,
    message: 'APD Backend API',
    version: '2.0',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
  });
});

app.use('/api/auth', authRoutes);
app.use('/api/preferences', preferencesRoutes);
app.use('/api/offers', offersRoutes);
app.use('/api/users', usersRoutes);

// ======================
// ENDPOINT de observabilidad simple para cron
// ======================
let lastRuns = {
  sync1205: null,
  sync1705: null,
  sync2045: null,
  push2100: null,
};

app.get('/internal/cron-status', basicAuth, (_req, res) => {
  res.json({ success: true, lastRuns });
});

// ======================
// ERROR HANDLER
// ======================
app.use((err, req, res, _next) => {
  console.error(`[${req.id}]`, err);
  if (err.name === 'ValidationError')
    return res.status(400).json({ success: false, message: 'Error de validación', errors: err.details?.map(d => d.message) });
  if (err.name === 'JsonWebTokenError')
    return res.status(401).json({ success: false, message: 'Token inválido' });
  if (err.name === 'TokenExpiredError')
    return res.status(401).json({ success: false, message: 'Token expirado' });

  res.status(err.status || 500).json({
    success: false,
    message: process.env.NODE_ENV === 'production' ? 'Error interno del servidor' : err.message,
    requestId: req.id,
  });
});

app.use((req, res) => res.status(404).json({ success: false, message: 'Ruta no encontrada', path: req.path }));

// ======================
// CRON JOBS (Argentina)
// ======================
// ⏱️ Sincronizaciones por turnos (Lun–Vie)
cron.schedule('5 12 * * 1-5', async () => {
  console.log('🕐 [CRON 12:05] Sync ABC (mañana) …');
  await syncOffersFromABC();
  lastRuns.sync1205 = new Date().toISOString();
}, { timezone: AR_TZ });

cron.schedule('5 17 * * 1-5', async () => {
  console.log('🕐 [CRON 17:05] Sync ABC (tarde) …');
  await syncOffersFromABC();
  lastRuns.sync1705 = new Date().toISOString();
}, { timezone: AR_TZ });

cron.schedule('45 20 * * 1-5', async () => {
  console.log('🕐 [CRON 20:45] Sync ABC (noche, previo a push) …');
  await syncOffersFromABC();
  lastRuns.sync2045 = new Date().toISOString();
}, { timezone: AR_TZ });

// 🔔 Push diario 21:00 (Lun–Vie)
// si querés Dom–Vie: usa 0-5
cron.schedule('0 21 * * 1-5', async () => {
  console.log('🔔 [CRON 21:00] Push diario …');
  await sendDailyNotifications();
  lastRuns.push2100 = new Date().toISOString();
}, { timezone: AR_TZ });

// ======================
// ARRANQUE
// ======================
app.listen(PORT, async () => {
  console.log(`✅ [SERVER] Puerto ${PORT}`);
  try {
    const r = await pool.query('SELECT NOW()');
    console.log(`✅ [DB] Conectado - ${r.rows[0].now}`);
  } catch (e) {
    console.error('❌ [DB] Error conexión:', e.message);
  }

  try {
    initializeFirebase();
  } catch (e) {
    console.error('❌ [FIREBASE] Error init:', e.message);
  }

  console.log('🕐 [CRON] Programados: 12:05, 17:05, 20:45, 21:00 (AR, Lun–Vie)');
});

// Señales
process.on('SIGTERM', () => { console.log('👋 SIGTERM'); pool.end(); process.exit(0); });
process.on('SIGINT', () => { console.log('👋 SIGINT'); pool.end(); process.exit(0); });
