const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const { v4: uuidv4 } = require('uuid');

// Config
const pool = require('./config/database');

// Rutas
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

// ======================
// REQUEST ID
// ======================
app.use((req, res, next) => {
  req.id = uuidv4();
  res.setHeader('X-Request-ID', req.id);
  next();
});

// ======================
// CORS
// ======================
const allowedOrigins = [
  'http://localhost:8081',
  'http://localhost:19006',
  'http://localhost:19000',
  'http://localhost:3000',
];

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin) return callback(null, true); // mobile/Postman
      if (allowedOrigins.includes(origin)) return callback(null, true);
      return callback(null, true); // permitir en dev
    },
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization'],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  })
);

// ======================
// BASIC AUTH (para endpoints admin públicos, como /)
// ======================
const basicAuth = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Basic ')) {
    res.setHeader('WWW-Authenticate', 'Basic realm="APD Backend"');
    return res.status(401).json({ success: false, message: 'Autenticación requerida' });
  }
  const base64Credentials = authHeader.split(' ')[1];
  const credentials = Buffer.from(base64Credentials, 'base64').toString('ascii');
  const [username, password] = credentials.split(':');

  const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'apd_admin';
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

  if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
    return next();
  }
  res.setHeader('WWW-Authenticate', 'Basic realm="APD Backend"');
  return res.status(401).json({ success: false, message: 'Credenciales inválidas' });
};

// ======================
// BODY PARSER
// ======================
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ======================
// RUTAS
// ======================

// Health (protegido)
app.get('/', basicAuth, (req, res) => {
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
// ERROR HANDLER
// ======================
app.use((err, req, res, next) => {
  console.error(`[${req.id}] Error:`, err.message);
  console.error(err.stack);

  if (err.name === 'ValidationError') {
    return res.status(400).json({
      success: false,
      message: 'Error de validación',
      errors: err.details?.map((d) => d.message) || [err.message],
    });
  }
  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({ success: false, message: 'Token inválido' });
  }
  if (err.name === 'TokenExpiredError') {
    return res.status(401).json({ success: false, message: 'Token expirado' });
  }
  res.status(err.status || 500).json({
    success: false,
    message: process.env.NODE_ENV === 'production' ? 'Error interno del servidor' : err.message,
    requestId: req.id,
  });
});

// 404
app.use((req, res) => {
  res.status(404).json({ success: false, message: 'Ruta no encontrada', path: req.path });
});

// ======================
/* CRON JOBS */

// 15:00 — sync post-adjudicación
cron.schedule(
  '0 15 * * *',
  async () => {
    console.log('🕐 [CRON] Iniciando sync 15:00 hs...');
    await syncOffersFromABC();
  },
  { timezone: 'America/Argentina/Buenos_Aires' }
);

// 20:00 — sync actualizaciones tardías
cron.schedule(
  '0 20 * * *',
  async () => {
    console.log('🕐 [CRON] Iniciando sync 20:00 hs...');
    await syncOffersFromABC();
  },
  { timezone: 'America/Argentina/Buenos_Aires' }
);

// 21:00 — push Dom–Vie (0=Dom … 5=Vie)
cron.schedule(
  '0 21 * * 0-5',
  async () => {
    console.log('🕐 [CRON] Enviando notificaciones push 21:00 hs (Dom–Vie)...');
    await sendDailyNotifications();
  },
  { timezone: 'America/Argentina/Buenos_Aires' }
);

// ======================
// START
// ======================
app.listen(PORT, async () => {
  console.log(`✅ [SERVER] Corriendo en puerto ${PORT}`);
  console.log(`✅ [ENV] ${process.env.NODE_ENV || 'development'}`);
  console.log(`✅ [CORS] Configurado`);

  try {
    const result = await pool.query('SELECT NOW()');
    console.log(`✅ [DATABASE] Conectado - ${result.rows[0].now}`);
  } catch (error) {
    console.error('❌ [DATABASE] Error de conexión:', error.message);
  }

  try {
    initializeFirebase();
  } catch (error) {
    console.error('❌ [FIREBASE] Error de inicialización:', error.message);
  }

  console.log('🕐 [CRON] Jobs: 15:00, 20:00, 21:00 (Dom–Vie) TZ America/Argentina/Buenos_Aires');
});

// Señales
process.on('SIGTERM', () => {
  console.log('👋 [SERVER] SIGTERM recibido, cerrando servidor...');
  pool.end();
  process.exit(0);
});
process.on('SIGINT', () => {
  console.log('👋 [SERVER] SIGINT recibido, cerrando servidor...');
  pool.end();
  process.exit(0);
});
