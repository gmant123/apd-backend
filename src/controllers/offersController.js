const { query } = require('../config/database');

/**
 * Helper: Formatear horarios desde JSONB a array legible
 */
const formatHorarios = (horariosJson) => {
  if (!horariosJson) return [];
  
  try {
    const horarios = typeof horariosJson === 'string' 
      ? JSON.parse(horariosJson) 
      : horariosJson;
    
    return Array.isArray(horarios) ? horarios : [];
  } catch {
    return [];
  }
};

/**
 * Helper: Formatear oferta para respuesta
 */
const formatOffer = (offer, userOffer = null) => {
  return {
    id: offer.id,
    cargo: offer.cargo,
    distrito: offer.distrito,
    modalidad: offer.modalidad,
    escuela: offer.escuela,
    cursoDivision: offer.curso_division,
    turno: offer.turno,
    revista: offer.revista === 'S' ? 'Suplente' : offer.revista === 'P' ? 'Provisional' : offer.revista,
    horasModulos: offer.horas_modulos,
    desde: offer.desde,
    hasta: offer.hasta,
    horarios: formatHorarios(offer.horarios),
    domicilio: offer.domicilio,
    reemplazaNombre: offer.reemplaza_nombre,
    reemplazoMotivo: offer.reemplazo_motivo,
    cierreOferta: offer.cierre_oferta,
    isNew: userOffer?.is_new || false,
    isFavorite: userOffer?.is_favorite || false,
    viewedAt: userOffer?.viewed_at || null
  };
};

/**
 * Obtener ofertas no leídas (nuevas)
 * GET /api/offers/unread
 */
const getUnreadOffers = async (req, res) => {
  try {
    const userId = req.user.id;

    const result = await query(
      `SELECT o.*, uo.is_new, uo.is_favorite, uo.viewed_at
       FROM offers o
       JOIN user_offers uo ON o.id = uo.offer_id
       WHERE uo.user_id = $1 
       AND uo.is_new = true
       ORDER BY o.created_at DESC`,
      [userId]
    );

    const offers = result.rows.map(row => formatOffer(row, row));

    res.json({
      success: true,
      count: offers.length,
      offers
    });

  } catch (error) {
    console.error('Error al obtener ofertas no leídas:', error);
    res.status(500).json({
      success: false,
      message: 'Error al obtener ofertas'
    });
  }
};

/**
 * Obtener todas las ofertas filtradas
 * GET /api/offers/all
 */
const getAllOffers = async (req, res) => {
  try {
    const userId = req.user.id;

    console.log('🔍 [getAllOffers] userId:', userId);

    const prefsResult = await query(
      'SELECT modalidades, distritos, turnos FROM user_preferences WHERE user_id = $1',
      [userId]
    );

    if (prefsResult.rows.length === 0) {
      return res.json({
        success: true,
        count: 0,
        offers: [],
        message: 'Configure sus preferencias primero'
      });
    }

    const prefs = prefsResult.rows[0];
    const modalidades = prefs.modalidades || [];
    const distritos = prefs.distritos || [];
    const turnos = prefs.turnos || [];

    console.log('🔍 [getAllOffers] Preferencias DB:');
    console.log('   - modalidades:', modalidades);
    console.log('   - distritos:', distritos);
    console.log('   - turnos:', turnos);

    if (modalidades.length === 0 && distritos.length === 0) {
      return res.json({
        success: true,
        count: 0,
        offers: [],
        message: 'Configure al menos una modalidad y un distrito'
      });
    }

    let whereConditions = [];
    let params = [userId];
    let paramIndex = 2;

    if (modalidades.length > 0) {
      whereConditions.push(`LOWER(o.modalidad) = ANY($${paramIndex})`);
      params.push(modalidades.map(m => m.toLowerCase()));
      paramIndex++;
    }

    if (distritos.length > 0) {
      whereConditions.push(`LOWER(o.distrito) = ANY($${paramIndex})`);
      params.push(distritos.map(d => d.toLowerCase()));
      paramIndex++;
    }

    if (turnos.length > 0) {
      const turnoMap = { 
        'mañana': 'M', 
        'manana': 'M',
        'tarde': 'T', 
        'noche': 'N' 
      };
      
      const turnosCodes = turnos.map(t => {
        const normalized = t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
        return turnoMap[normalized] || turnoMap[t.toLowerCase()] || null;
      }).filter(Boolean);
      
      if (turnosCodes.length > 0) {
        whereConditions.push(`o.turno = ANY($${paramIndex})`);
        params.push(turnosCodes);
        paramIndex++;
      }
    }

    const whereClause = whereConditions.length > 0 
      ? `WHERE ${whereConditions.join(' AND ')}`
      : '';

    const queryText = `
      SELECT o.*, uo.is_new, uo.is_favorite, uo.viewed_at
      FROM offers o
      LEFT JOIN user_offers uo ON o.id = uo.offer_id AND uo.user_id = $1
      ${whereClause}
      ORDER BY o.created_at DESC
      LIMIT 100
    `;

    console.log('🔍 [getAllOffers] Query SQL:', queryText);
    console.log('🔍 [getAllOffers] Params:', JSON.stringify(params, null, 2));
    console.log('🔍 [getAllOffers] WhereConditions:', whereConditions);

    const result = await query(queryText, params);
    
    console.log('🔍 [getAllOffers] Resultados obtenidos:', result.rows.length);
    if (result.rows.length > 0) {
      console.log('🔍 [getAllOffers] Primeras 3 ofertas - distritos:', 
        result.rows.slice(0, 3).map(r => r.distrito)
      );
    }

    const offers = result.rows.map(row => formatOffer(row, row));

    res.json({
      success: true,
      count: offers.length,
      offers
    });

  } catch (error) {
    console.error('Error al obtener todas las ofertas:', error);
    res.status(500).json({
      success: false,
      message: 'Error al obtener ofertas'
    });
  }
};

const getFavorites = async (req, res) => {
  try {
    const userId = req.user.id;

    const result = await query(
      `SELECT o.*, uo.is_new, uo.is_favorite, uo.viewed_at
       FROM offers o
       JOIN user_offers uo ON o.id = uo.offer_id
       WHERE uo.user_id = $1 AND uo.is_favorite = true
       ORDER BY o.created_at DESC`,
      [userId]
    );

    const offers = result.rows.map(row => formatOffer(row, row));

    res.json({
      success: true,
      count: offers.length,
      offers
    });

  } catch (error) {
    console.error('Error al obtener favoritos:', error);
    res.status(500).json({
      success: false,
      message: 'Error al obtener favoritos'
    });
  }
};

const getOfferById = async (req, res) => {
  try {
    const userId = req.user.id;
    const offerId = req.params.id;

    const result = await query(
      `SELECT o.*, uo.is_new, uo.is_favorite, uo.viewed_at
       FROM offers o
       LEFT JOIN user_offers uo ON o.id = uo.offer_id AND uo.user_id = $1
       WHERE o.id = $2`,
      [userId, offerId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Oferta no encontrada'
      });
    }

    const offer = formatOffer(result.rows[0], result.rows[0]);

    res.json({
      success: true,
      offer
    });

  } catch (error) {
    console.error('Error al obtener oferta:', error);
    res.status(500).json({
      success: false,
      message: 'Error al obtener oferta'
    });
  }
};

const markAsRead = async (req, res) => {
  try {
    const userId = req.user.id;
    const offerId = req.params.id;

    const offerCheck = await query('SELECT id FROM offers WHERE id = $1', [offerId]);
    
    if (offerCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Oferta no encontrada'
      });
    }

    await query(
      `INSERT INTO user_offers (user_id, offer_id, is_new, viewed_at)
       VALUES ($1, $2, false, NOW())
       ON CONFLICT (user_id, offer_id) 
       DO UPDATE SET is_new = false, viewed_at = NOW()`,
      [userId, offerId]
    );

    res.json({
      success: true,
      message: 'Oferta marcada como leída'
    });

  } catch (error) {
    console.error('Error al marcar como leída:', error);
    res.status(500).json({
      success: false,
      message: 'Error al marcar oferta como leída'
    });
  }
};

const toggleFavorite = async (req, res) => {
  try {
    const userId = req.user.id;
    const offerId = req.params.id;

    const offerCheck = await query('SELECT id FROM offers WHERE id = $1', [offerId]);
    
    if (offerCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Oferta no encontrada'
      });
    }

    const currentState = await query(
      'SELECT is_favorite FROM user_offers WHERE user_id = $1 AND offer_id = $2',
      [userId, offerId]
    );

    const newFavoriteState = currentState.rows.length === 0 
      ? true 
      : !currentState.rows[0].is_favorite;

    await query(
      `INSERT INTO user_offers (user_id, offer_id, is_favorite)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, offer_id) 
       DO UPDATE SET is_favorite = $3`,
      [userId, offerId, newFavoriteState]
    );

    res.json({
      success: true,
      message: newFavoriteState ? 'Agregado a favoritos' : 'Removido de favoritos',
      isFavorite: newFavoriteState
    });

  } catch (error) {
    console.error('Error al actualizar favorito:', error);
    res.status(500).json({
      success: false,
      message: 'Error al actualizar favorito'
    });
  }
};

module.exports = {
  getUnreadOffers,
  getAllOffers,
  getFavorites,
  getOfferById,
  markAsRead,
  toggleFavorite
};
