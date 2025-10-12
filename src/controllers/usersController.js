const pool = require('../config/database');

/**
 * Registra o actualiza el device token de un usuario
 * POST /api/users/device-token
 */
const saveDeviceToken = async (req, res) => {
  const userId = req.user.id; // Viene del middleware de autenticación
  const { device_token } = req.body;

  // Validación básica
  if (!device_token || typeof device_token !== 'string') {
    return res.status(400).json({
      success: false,
      message: 'Device token es requerido y debe ser un string'
    });
  }

  // Validar formato de Expo Push Token
  if (!device_token.startsWith('ExponentPushToken[') && !device_token.startsWith('ExpoPushToken[')) {
    return res.status(400).json({
      success: false,
      message: 'Formato de token inválido. Debe ser un Expo Push Token'
    });
  }

  try {
    // Actualizar el device_token del usuario
    const result = await pool.query(
    'UPDATE users SET device_token = $1, updated_at = NOW() WHERE id = $2 RETURNING id, email, device_token',
    [device_token, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Usuario no encontrado'
      });
    }

    console.log(`[${req.id}] Device token actualizado para usuario ${userId}`);

    return res.json({
      success: true,
      message: 'Device token registrado correctamente',
      data: {
        user_id: result.rows[0].id,
        device_token: result.rows[0].device_token
      }
    });

  } catch (error) {
    console.error(`[${req.id}] Error guardando device token:`, error);
    return res.status(500).json({
      success: false,
      message: 'Error al guardar device token'
    });
  }
};

/**
 * Elimina el device token de un usuario (logout)
 * DELETE /api/users/device-token
 */
const deleteDeviceToken = async (req, res) => {
  const userId = req.user.id;

  try {
    await pool.query(
  'UPDATE users SET device_token = NULL, updated_at = NOW() WHERE id = $1',
  [userId]
  );

    console.log(`[${req.id}] Device token eliminado para usuario ${userId}`);

    return res.json({
      success: true,
      message: 'Device token eliminado correctamente'
    });

  } catch (error) {
    console.error(`[${req.id}] Error eliminando device token:`, error);
    return res.status(500).json({
      success: false,
      message: 'Error al eliminar device token'
    });
  }
};

module.exports = {
  saveDeviceToken,
  deleteDeviceToken
};
