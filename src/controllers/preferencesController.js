const { query } = require('../config/database');

/**
 * Obtener preferencias del usuario
 * GET /api/preferences
 */
const getPreferences = async (req, res) => {
  try {
    const userId = req.user.id;

    const result = await query(
      `SELECT modalidades, distritos, turnos, notif_diaria, notif_hora
       FROM user_preferences
       WHERE user_id = $1`,
      [userId]
    );

    if (result.rows.length === 0) {
      // Si no existen preferencias, crear por defecto
      await query(
        `INSERT INTO user_preferences (user_id, modalidades, distritos, turnos)
         VALUES ($1, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb)`,
        [userId]
      );

      return res.json({
        success: true,
        preferences: {
          modalidades: [],
          distritos: [],
          turnos: [],
          notif_diaria: true,
          notif_hora: '21:00'
        }
      });
    }

    const prefs = result.rows[0];

    res.json({
      success: true,
      preferences: {
        modalidades: prefs.modalidades || [],
        distritos: prefs.distritos || [],
        turnos: prefs.turnos || [],
        notif_diaria: prefs.notif_diaria !== false,
        notif_hora: prefs.notif_hora || '21:00'
      }
    });

  } catch (error) {
    console.error('Error al obtener preferencias:', error);
    res.status(500).json({
      success: false,
      message: 'Error al obtener preferencias'
    });
  }
};

/**
 * Actualizar preferencias del usuario
 * PUT /api/preferences
 */
const updatePreferences = async (req, res) => {
  try {
    const userId = req.user.id;
    const { modalidades, distritos, turnos, notif_diaria, notif_hora } = req.body;

    // Validar que se envíen datos
    if (!modalidades && !distritos && !turnos && notif_diaria === undefined) {
      return res.status(400).json({
        success: false,
        message: 'Debe enviar al menos una preferencia para actualizar'
      });
    }

    // Validar distritos (máximo 3)
    if (distritos && distritos.length > 3) {
      return res.status(400).json({
        success: false,
        message: 'Máximo 3 distritos permitidos'
      });
    }

    // UPSERT: Insertar o actualizar si ya existe
    const result = await query(
      `INSERT INTO user_preferences (
        user_id, 
        modalidades, 
        distritos, 
        turnos, 
        notif_diaria, 
        notif_hora,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, NOW())
      ON CONFLICT (user_id) 
      DO UPDATE SET
        modalidades = EXCLUDED.modalidades,
        distritos = EXCLUDED.distritos,
        turnos = EXCLUDED.turnos,
        notif_diaria = EXCLUDED.notif_diaria,
        notif_hora = EXCLUDED.notif_hora,
        updated_at = NOW()
      RETURNING *`,
      [
        userId,
        JSON.stringify(modalidades || []),
        JSON.stringify(distritos || []),
        JSON.stringify(turnos || []),
        notif_diaria !== undefined ? notif_diaria : true,
        notif_hora || '21:00'
      ]
    );

    const updated = result.rows[0];

    res.json({
      success: true,
      message: 'Preferencias actualizadas correctamente',
      preferences: {
        modalidades: updated.modalidades || [],
        distritos: updated.distritos || [],
        turnos: updated.turnos || [],
        notif_diaria: updated.notif_diaria,
        notif_hora: updated.notif_hora
      }
    });

  } catch (error) {
    console.error('Error al actualizar preferencias:', error);
    res.status(500).json({
      success: false,
      message: 'Error al actualizar preferencias'
    });
  }
};

module.exports = {
  getPreferences,
  updatePreferences
};
