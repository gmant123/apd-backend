const express = require('express');
const router = express.Router();
const { saveDeviceToken, deleteDeviceToken } = require('../controllers/usersController');
const authMiddleware = require('../middleware/authMiddleware');

// Todas las rutas requieren autenticación
router.use(authMiddleware);

// POST /api/users/device-token - Registrar device token
router.post('/device-token', saveDeviceToken);

// DELETE /api/users/device-token - Eliminar device token (logout)
router.delete('/device-token', deleteDeviceToken);

module.exports = router;
