const express = require('express');
const router = express.Router();
const { saveDeviceToken, deleteDeviceToken } = require('../controllers/usersController');
const { authenticateToken } = require('../middleware/authMiddleware'); // CORRECCIÓN AQUÍ

// POST /api/users/device-token - Registrar device token
router.post('/device-token', authenticateToken, saveDeviceToken);

// DELETE /api/users/device-token - Eliminar device token (logout)
router.delete('/device-token', authenticateToken, deleteDeviceToken);

module.exports = router;
