// ========================================
// APD BACKEND SERVER
// Sistema de notificaciones para docentes
// ========================================

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { testConnection } = require('./config/database');
const { startCronJobs } = require('../jobs/scheduler');
const requestIdMiddleware = require('./middleware/requestId');
const basicAuth = require('./middleware/basicAuth');

const app = express();
const PORT = process.env.PORT || 3000;

// ========================================
// MIDDLEWARE DE SEGURIDAD
// ========================================

// 1. Request ID (PRIMERO - para logs)
app.use(requestIdMiddleware);

// 2. Helmet - Headers de seguridad
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      scriptSrc: ["'self'"],
      connectSrc: ["'self'", "https://apd-backend.onrender.com"],
    },
  },
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: "cross-origin" },
}));

// 3. CORS con whitelist
const allowedOrigins = process.env.NODE_ENV === 'production' 
  ? [
      'https://apd-backend.onrender.com',
      'exp://localhost:8081',
      // Agregar dominio de app cuando esté publicada
    ]
  : [
      'http://localhost:3000',
      'http://localhost:19006',
      'exp://localhost:8081',
      'exp://192.168.0.0',
    ];

app.use(cors({
  origin: function (origin, callback) {
    // Permitir requests sin origin (mobile apps, Postman)
    if (!origin) return callback(null, true);
    
    // Permitir origins de la whitelist
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else if (origin.startsWith('exp://')) {
      // Permitir cualquier Expo Go en desarrollo
      callback(null, true);
    } else {
      console.warn(`[${new Date().toISOString()}] CORS blocked: ${origin}`);
      callback(new Error('No permitido por CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
}));

// ========================================
// MIDDLEWARE BÁSICO
// ========================================

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ========================================
// RUTAS
// ========================================

app.use('/api/auth', require('./routes/auth'));
app.use('/api/preferences', require('./routes/preferences'));
app.use('/api/offers', require('./routes/offers'));

// Ruta raíz protegida con Basic Auth
app.get('/', basicAuth, (req, res) => {
  res.json({ 
    message: 'APD Backend API', 
    status: 'running',
    version: '1.2.0',
    timestamp: new Date().toISOString(),
    requestId: req.id
  });
});

// ========================================
// ERROR HANDLERS
// ========================================

// 404 Handler - Debe ir DESPUÉS de todas las rutas
app.use((req, res, next) => {
  res.status(404).json({
    success: false,
    message: 'Endpoint no encontrado',
    path: req.path,
    method: req.method,
    requestId: req.id,
  });
});

// Error Handler Global - Debe ir AL FINAL
app.use((err, req, res, next) => {
  // Log del error con request ID
  console.error(`[${req.id || 'NO-ID'}] Error en ${req.method} ${req.path}:`, {
    message: err.message,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
    body: req.body,
    timestamp: new Date().toISOString(),
  });

  // Errores de validación Joi
  if (err.name === 'ValidationError') {
    return res.status(400).json({
      success: false,
      message: 'Error de validación',
      errors: err.details || err.message,
      requestId: req.id,
    });
  }

  // Errores de JWT
  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({
      success: false,
      message: 'Token inválido',
      requestId: req.id,
    });
  }

  if (err.name === 'TokenExpiredError') {
    return res.status(401).json({
      success: false,
      message: 'Token expirado',
      requestId: req.id,
    });
  }

  // Errores de rate limiting
  if (err.status === 429) {
    return res.status(429).json({
      success: false,
      message: 'Demasiados intentos, intenta más tarde',
      retryAfter: err.retryAfter,
      requestId: req.id,
    });
  }

  // Errores de CORS
  if (err.message && err.message.includes('CORS')) {
    return res.status(403).json({
      success: false,
      message: 'Acceso no permitido',
      requestId: req.id,
    });
  }

  // Error genérico (no exponer detalles en producción)
  res.status(err.status || 500).json({
    success: false,
    message: process.env.NODE_ENV === 'production' 
      ? 'Error interno del servidor' 
      : err.message,
    requestId: req.id,
  });
});

// ========================================
// INICIALIZACIÓN
// ========================================

testConnection();
startCronJobs();

app.listen(PORT, () => {
  console.log(`========================================`);
  console.log(`🚀 Servidor APD Backend iniciado`);
  console.log(`========================================`);
  console.log(`Puerto: ${PORT}`);
  console.log(`Entorno: ${process.env.NODE_ENV || 'development'}`);
  console.log(`Timestamp: ${new Date().toISOString()}`);
  console.log(`========================================\n`);
});

module.exports = app;
