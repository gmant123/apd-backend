const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { authenticateToken } = require('../middleware/authMiddleware');

/**
 * POST /api/auth/login
 * Login de usuario con DNI y contraseña
 */
router.post('/login', authController.login);

/**
 * POST /api/auth/register
 * Registro de nuevo usuario (validación con gremio)
 */
router.post('/register', authController.register);

/**
 * POST /api/auth/verify
 * Verificar si un token es válido (método antiguo)
 */
router.post('/verify', authController.verifyToken);

/**
 * GET /api/auth/verify
 * Verificar sesión activa (token en header)
 */
router.get('/verify', authenticateToken, authController.verify);

module.exports = router;
