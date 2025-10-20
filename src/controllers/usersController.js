const pool = require('../config/database');

const saveDeviceToken = async (req, res) => {
  const userId = req.user.id;
  const { device_token } = req.body;
  
  if (!device_token || typeof device_token !== 'string') {
    return res.status(400).json({
      success: false,
      message: 'Device token es requerido y debe ser un string'
    });
  }
  
  const isExpo = /^Expo(nent)?PushToken\[/.test(device_token);
  const isFCM = device_token.length > 100 && /^[a-zA-Z0-9_:-]+$/.test(device_token);

  if (!isExpo && !isFCM) {
    return res.status(400).json({
      success: false,
      message: 'Formato de token inválido. Debe ser Expo Push Token o FCM token'
    });
  }
  
  try {
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
