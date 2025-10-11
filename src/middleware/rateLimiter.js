const rateLimit = require('express-rate-limit');
const crypto = require('crypto');

/**
 * Rate limiter general para toda la API
 * 100 requests por 15 minutos por IP
 */
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 100, // 100 requests por ventana
  message: {
    success: false,
    message: 'Demasiadas solicitudes desde esta IP. Por favor, intenta de nuevo en 15 minutos.'
  },
  standardHeaders: true,  // Enviar info en headers `RateLimit-*`
  legacyHeaders: false,   // Deshabilitar headers `X-RateLimit-*`
  handler: (req, res) => {
    console.log(`[RATE LIMIT] IP bloqueada: ${req.ip} en ${req.path}`);
    res.status(429).json({
      success: false,
      message: 'Demasiadas solicitudes desde esta IP. Por favor, intenta de nuevo en 15 minutos.'
    });
  }
});

/**
 * Rate limiter estricto para login (por IP)
 * 5 intentos por 15 minutos por IP
 */
const authLoginLimiterByIP = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 5, // Solo 5 intentos
  skipSuccessfulRequests: true, // No contar logins exitosos
  message: {
    success: false,
    message: 'Demasiados intentos de login desde esta IP. Por favor, intenta de nuevo en 15 minutos.'
  },
  handler: (req, res) => {
    console.log(`[RATE LIMIT LOGIN] IP bloqueada: ${req.ip}`);
    res.status(429).json({
      success: false,
      message: 'Demasiados intentos de login. Por favor, intenta de nuevo en 15 minutos.'
    });
  }
});

/**
 * Rate limiter por email (en memoria)
 * Previene enumeración de usuarios desde múltiples IPs
 */
const loginAttemptsByEmail = new Map();

const authLoginLimiterByEmail = (req, res, next) => {
  const email = req.body.email?.toLowerCase();
  
  if (!email) {
    return next();
  }

  // Hash del email (no guardamos el email en texto plano en memoria)
  const emailHash = crypto.createHash('sha256').update(email).digest('hex');
  
  const now = Date.now();
  const attempts = loginAttemptsByEmail.get(emailHash) || { count: 0, resetAt: now + 15 * 60 * 1000 };
  
  // Reset después de 15 minutos
  if (now > attempts.resetAt) {
    loginAttemptsByEmail.set(emailHash, { count: 1, resetAt: now + 15 * 60 * 1000 });
    return next();
  }
  
  // Bloquear después de 5 intentos
  if (attempts.count >= 5) {
    console.log(`[RATE LIMIT EMAIL] Email bloqueado (hash): ${emailHash.substring(0, 16)}...`);
    return res.status(429).json({
      success: false,
      message: 'Demasiados intentos de login. Por favor, intenta de nuevo en 15 minutos.'
    });
  }
  
  // Incrementar contador
  attempts.count++;
  loginAttemptsByEmail.set(emailHash, attempts);
  next();
};

/**
 * Rate limiter para registro
 * 3 registros por hora por IP
 */
const authRegisterLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hora
  max: 3, // Solo 3 registros
  message: {
    success: false,
    message: 'Demasiados registros desde esta IP. Por favor, intenta de nuevo en 1 hora.'
  },
  handler: (req, res) => {
    console.log(`[RATE LIMIT REGISTER] IP bloqueada: ${req.ip}`);
    res.status(429).json({
      success: false,
      message: 'Demasiados intentos de registro. Por favor, intenta de nuevo en 1 hora.'
    });
  }
});

/**
 * Cleanup periódico de intentos de login por email
 * Se ejecuta cada hora
 */
setInterval(() => {
  const now = Date.now();
  let cleaned = 0;
  
  for (const [hash, data] of loginAttemptsByEmail.entries()) {
    if (now > data.resetAt) {
      loginAttemptsByEmail.delete(hash);
      cleaned++;
    }
  }
  
  if (cleaned > 0) {
    console.log(`[RATE LIMIT CLEANUP] ${cleaned} entradas de email limpiadas`);
  }
}, 60 * 60 * 1000); // Cada hora

module.exports = {
  apiLimiter,
  authLoginLimiterByIP,
  authLoginLimiterByEmail,
  authRegisterLimiter
};
