const express = require('express');
const router = express.Router();
const preferencesController = require('../controllers/preferencesController');
const { authenticateToken } = require('../middleware/authMiddleware');

/**
 * GET /api/preferences
 * Obtener preferencias del usuario autenticado
 */
router.get('/', authenticateToken, preferencesController.getPreferences);

/**
 * PUT /api/preferences
 * Actualizar preferencias del usuario autenticado
 */
router.put('/', authenticateToken, preferencesController.updatePreferences);

module.exports = router;