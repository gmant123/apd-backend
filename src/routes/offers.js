const express = require('express');
const router = express.Router();
const offersController = require('../controllers/offersController');
const { authenticateToken } = require('../middleware/authMiddleware');

/**
 * GET /api/offers/unread
 * Obtener ofertas no leídas (nuevas) del usuario
 */
router.get('/unread', authenticateToken, offersController.getUnreadOffers);

/**
 * GET /api/offers/all
 * Obtener todas las ofertas filtradas para el usuario
 */
router.get('/all', authenticateToken, offersController.getAllOffers);

/**
 * GET /api/offers/favorites
 * Obtener ofertas marcadas como favoritas
 */
router.get('/favorites', authenticateToken, offersController.getFavorites);

/**
 * GET /api/offers/:id
 * Obtener detalle completo de una oferta específica
 */
router.get('/:id', authenticateToken, offersController.getOfferById);

/**
 * POST /api/offers/:id/mark-read
 * Marcar oferta como leída
 */
router.post('/:id/mark-read', authenticateToken, offersController.markAsRead);

/**
 * POST /api/offers/:id/favorite
 * Agregar/quitar de favoritos
 */
router.post('/:id/favorite', authenticateToken, offersController.toggleFavorite);

module.exports = router;