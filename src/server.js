const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const { v4: uuidv4 } = require('uuid');

// Importar configuraciones
const pool = require('./config/database');

// Importar rutas
const authRoutes = require('./routes/auth');
const preferencesRoutes = require('./routes/preferences');
const offersRoutes = require('./routes/offers');

// Importar jobs
const { syncOffersFromABC } = require('../jobs/syncOffers');

const app = express();
const PORT = process.env.PORT || 3000;

// ======================
// MIDDLEWARE - REQUEST ID
// ======================
app.use((req, res, next) => {
  req.id = uuidv4();
  res.setHeader('X-Request-ID', req.id);
  next();
});

// ======================
// MIDDLEWARE - CORS
// ======================
const allowedOrigins = [
  'http://localhost:8081',
  'http://localhost:19006',
  'http://localhost:19000',
  'http://localhost:3000'
];

app.use(cors({
  origin: function (origin, callback) {
    // Permitir requests sin origin (mobile apps, Postman, Thunder Client)
    if (!origin) return callback(null, true);
    
    // Permitir orígenes en whitelist
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    
    // En desarrollo, permitir todos (comentar en producción)
    return callback(null, true);
  },
  credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization'],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
}));

// ======================
// MIDDLEWARE - BASIC AUTH (para endpoints admin)
// ======================
const basicAuth = (req, res, next) => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Basic ')) {
    res.setHeader('WWW-Authenticate', 'Basic realm="APD Backend"');
    return res.status(401).json({ 
      success: false, 
      message: 'Autenticación requerida' 
    });
  }

  const base64Credentials = authHeader.split(' ')[1];
  const credentials = Buffer.from(base64Credentials, 'base64').toString('ascii');
  const [username, password] = credentials.split(':');

  const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'apd_admin';
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

  if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
    next();
  } else {
    res.setHeader('WWW-Authenticate', 'Basic realm="APD Backend"');
    return res.status(401).json({ 
      success: false, 
      message: 'Credenciales inválidas' 
    });
  }
};

// ======================
// MIDDLEWARE - BODY PARSER
// ======================
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ======================
// RUTAS PÚBLICAS
// ======================

// Health check (protegido con Basic Auth)
app.get('/', basicAuth, (req, res) => {
  res.json({
    success: true,
    message: 'APD Backend API',
    version: '2.0',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/preferences', preferencesRoutes);
app.use('/api/offers', offersRoutes);

// ======================
// ERROR HANDLER GLOBAL
// ======================
app.use((err, req, res, next) => {
  console.error(`[${req.id}] Error:`, err.message);
  console.error(err.stack);

  // Error de validación (Joi)
  if (err.name === 'ValidationError') {
    return res.status(400).json({
      success: false,
      message: 'Error de validación',
      errors: err.details?.map(d => d.message) || [err.message]
    });
  }

  // Error de JWT
  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({
      success: false,
      message: 'Token inválido'
    });
  }

  if (err.name === 'TokenExpiredError') {
    return res.status(401).json({
      success: false,
      message: 'Token expirado'
    });
  }

  // Error genérico
  res.status(err.status || 500).json({
    success: false,
    message: process.env.NODE_ENV === 'production' 
      ? 'Error interno del servidor' 
      : err.message,
    requestId: req.id
  });
});

// 404 - Ruta no encontrada
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Ruta no encontrada',
    path: req.path
  });
});

// ======================
// CRON JOBS
// ======================

// Sync ofertas - 15:00 hs Argentina (post-adjudicación)
cron.schedule('0 15 * * *', async () => {
  console.log('🕐 [CRON] Iniciando sync 15:00 hs...');
  await syncOffersFromABC();
}, {
  timezone: 'America/Argentina/Buenos_Aires'
});

// Sync ofertas - 20:00 hs Argentina (actualizaciones tardías)
cron.schedule('0 20 * * *', async () => {
  console.log('🕐 [CRON] Iniciando sync 20:00 hs...');
  await syncOffersFromABC();
}, {
  timezone: 'America/Argentina/Buenos_Aires'
});

// TODO: Push notifications - 21:00 hs Argentina
// cron.schedule('0 21 * * *', async () => {
//   console.log('🕐 [CRON] Enviando notificaciones push 21:00 hs...');
//   await sendDailyNotifications();
// }, {
//   timezone: 'America/Argentina/Buenos_Aires'
// });

// ======================
// INICIAR SERVIDOR
// ======================
app.listen(PORT, async () => {
  console.log(`✅ [SERVER] Corriendo en puerto ${PORT}`);
  console.log(`✅ [ENV] ${process.env.NODE_ENV || 'development'}`);
  console.log(`✅ [CORS] Configurado`);
  
  // Verificar conexión a DB
  try {
    const result = await pool.query('SELECT NOW()');
    console.log(`✅ [DATABASE] Conectado - ${result.rows[0].now}`);
  } catch (error) {
    console.error('❌ [DATABASE] Error de conexión:', error.message);
  }
  
  console.log('🕐 [CRON] Jobs programados: 15:00, 20:00 (timezone Argentina)');
});

// Manejo de señales de terminación
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
