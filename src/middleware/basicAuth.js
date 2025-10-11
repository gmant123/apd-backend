/**
 * Middleware de Basic Authentication para proteger endpoints administrativos
 * Uso: app.get('/admin', basicAuth, controller);
 */
const basicAuth = (req, res, next) => {
  const authHeader = req.headers.authorization;
  
  // Verificar si el header Authorization existe
  if (!authHeader || !authHeader.startsWith('Basic ')) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Admin Area"');
    return res.status(401).json({
      success: false,
      message: 'Autenticación requerida'
    });
  }

  // Decodificar credenciales (formato: "Basic base64(username:password)")
  const base64Credentials = authHeader.split(' ')[1];
  const credentials = Buffer.from(base64Credentials, 'base64').toString('ascii');
  const [username, password] = credentials.split(':');

  // Obtener credenciales válidas desde variables de entorno
  const validUsername = process.env.ADMIN_USERNAME || 'admin';
  const validPassword = process.env.ADMIN_PASSWORD || 'change-me-in-production';

  // Verificar credenciales
  if (username === validUsername && password === validPassword) {
    next();
  } else {
    res.setHeader('WWW-Authenticate', 'Basic realm="Admin Area"');
    return res.status(401).json({
      success: false,
      message: 'Credenciales inválidas'
    });
  }
};

module.exports = basicAuth;
