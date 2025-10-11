const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { authenticateToken } = require('../middleware/authMiddleware');
const { validate, registerSchema, loginSchema } = require('../middleware/validation');
const { authLoginLimiterByIP, authLoginLimiterByEmail, authRegisterLimiter } = require('../middleware/rateLimiter');

/**
 * POST /api/auth/register
 * Registro de nuevo usuario
 * Rate limit: 3 registros por hora por IP
 * Validación: email, password, dni, nombre, telefono
 */
router.post('/register', 
  authRegisterLimiter,           // Rate limiting
  validate(registerSchema),      // Validación Joi
  authController.register
);

/**
 * POST /api/auth/login
 * Login de usuario existente
 * Rate limit: 5 intentos por 15 min (por IP y por email)
 * Validación: email, password
 */
router.post('/login', 
  authLoginLimiterByIP,          // Rate limiting por IP
  authLoginLimiterByEmail,       // Rate limiting por email
  validate(loginSchema),         // Validación Joi
  authController.login
);

/**
 * POST /api/auth/verify
 * Verificar token JWT (método legacy con body)
 */
router.post('/verify', authController.verifyToken);

/**
 * GET /api/auth/verify
 * Verificar sesión activa (método moderno con header)
 * Requiere: Authorization Bearer token
 */
router.get('/verify', authenticateToken, authController.verify);

module.exports = router;
