const { v4: uuidv4 } = require('uuid');

/**
 * Middleware que genera un ID único para cada request
 * Útil para debugging y trazabilidad en logs
 */
const requestIdMiddleware = (req, res, next) => {
  // Generar ID único
  req.id = uuidv4();
  
  // Agregarlo al header de respuesta para que el cliente pueda referenciarlo
  res.setHeader('X-Request-ID', req.id);
  
  // Continuar con el siguiente middleware
  next();
};

module.exports = requestIdMiddleware;
