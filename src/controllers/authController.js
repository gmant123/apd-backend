const argon2 = require('argon2');
const jwt = require('jsonwebtoken');
const { query } = require('../config/database');
const { dniHash, encryptDni, decryptDni } = require('../utils/crypto');

/**
 * REGISTRO de usuario
 * POST /api/auth/register
 * Body: { email, password, dni, nombre, telefono }
 */
const register = async (req, res) => {
  try {
    const { email, password, dni, nombre, telefono } = req.body;

    // Validaciones básicas
    if (!email || !password || !dni) {
      return res.status(400).json({
        success: false,
        message: 'Email, password y DNI son requeridos'
      });
    }

    // Validar formato email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        message: 'Formato de email inválido'
      });
    }

    // Validar longitud password
    if (password.length < 8) {
      return res.status(400).json({
        success: false,
        message: 'La contraseña debe tener al menos 8 caracteres'
      });
    }

    // Calcular hash del DNI (para índice único)
    let dniHashValue;
    try {
      dniHashValue = dniHash(dni);
    } catch (error) {
      return res.status(400).json({
        success: false,
        message: error.message // "DNI debe tener 8 dígitos", etc.
      });
    }

    // Verificar si email ya existe
    const emailCheck = await query(
      'SELECT id FROM users WHERE email = $1',
      [email.toLowerCase()]
    );

    if (emailCheck.rows.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'El email ya está registrado'
      });
    }

    // Verificar si DNI ya existe (por hash)
    const dniCheck = await query(
      'SELECT id FROM users WHERE dni_hash = $1',
      [dniHashValue]
    );

    if (dniCheck.rows.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'El DNI ya está registrado'
      });
    }

    // Hashear password con Argon2id
    const passwordHash = await argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 4
    });

    // Cifrar DNI con AES-256-GCM
    const { encrypted, iv, authTag } = encryptDni(dni);
    const dniEncValue = `${encrypted}:${authTag}`; // Formato: encrypted:authTag

    // Insertar usuario
    const result = await query(
      `INSERT INTO users (
        email, password_hash, dni_hash, dni_enc, dni_iv, 
        nombre, telefono, gremios, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
      RETURNING id, email, nombre, telefono, gremios, created_at`,
      [
        email.toLowerCase(),
        passwordHash,
        dniHashValue,
        dniEncValue,
        iv,
        nombre || null,
        telefono || null,
        JSON.stringify([]) // gremios vacío por defecto
      ]
    );

    const user = result.rows[0];

    // Crear preferencias por defecto
    await query(
      `INSERT INTO user_preferences (user_id) VALUES ($1)`,
      [user.id]
    );

    // Generar token JWT
    const token = jwt.sign(
      { id: user.id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRY || '7d' }
    );

    res.status(201).json({
      success: true,
      token,
      user: {
        id: user.id,
        email: user.email,
        nombre: user.nombre,
        telefono: user.telefono,
        gremios: user.gremios,
        createdAt: user.created_at
      }
    });

  } catch (error) {
    console.error('Error en register:', error);
    res.status(500).json({
      success: false,
      message: 'Error al registrar usuario'
    });
  }
};

/**
 * LOGIN de usuario
 * POST /api/auth/login
 * Body: { email, password }
 */
const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email y contraseña son requeridos'
      });
    }

    // Buscar usuario por email
    const result = await query(
      'SELECT * FROM users WHERE email = $1 AND is_active = true',
      [email.toLowerCase()]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'Email o contraseña incorrectos'
      });
    }

    const user = result.rows[0];

    // Verificar password con Argon2
    const validPassword = await argon2.verify(user.password_hash, password);

    if (!validPassword) {
      return res.status(401).json({
        success: false,
        message: 'Email o contraseña incorrectos'
      });
    }

    // Actualizar last_login
    await query(
      'UPDATE users SET last_login = NOW() WHERE id = $1',
      [user.id]
    );

    // Generar token JWT
    const token = jwt.sign(
      { id: user.id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRY || '7d' }
    );

    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        email: user.email,
        nombre: user.nombre,
        telefono: user.telefono,
        gremios: user.gremios
      }
    });

  } catch (error) {
    console.error('Error en login:', error);
    res.status(500).json({
      success: false,
      message: 'Error al iniciar sesión'
    });
  }
};

/**
 * Verificar sesión activa (GET /api/auth/verify)
 * Requiere: authMiddleware
 */
const verify = async (req, res) => {
  try {
    const userId = req.user.id;

    const result = await query(
      'SELECT id, email, nombre, telefono, gremios, created_at, last_login FROM users WHERE id = $1 AND is_active = true',
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Usuario no encontrado o inactivo'
      });
    }

    const user = result.rows[0];

    const prefsResult = await query(
      'SELECT modalidades, distritos, turnos FROM user_preferences WHERE user_id = $1',
      [userId]
    );

    const hasPreferences = prefsResult.rows.length > 0 && 
      (prefsResult.rows[0].modalidades.length > 0 || 
       prefsResult.rows[0].distritos.length > 0);

    res.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        nombre: user.nombre,
        telefono: user.telefono,
        gremios: user.gremios,
        hasPreferences: hasPreferences
      }
    });

  } catch (error) {
    console.error('Error en verify:', error);
    res.status(500).json({
      success: false,
      message: 'Error al verificar sesión'
    });
  }
};

/**
 * UTILIDAD: Obtener DNI descifrado (solo para admin/soporte)
 * NO exponer como endpoint público
 */
const getDniForUser = async (userId) => {
  try {
    const result = await query(
      'SELECT dni_enc, dni_iv FROM users WHERE id = $1',
      [userId]
    );

    if (result.rows.length === 0) {
      throw new Error('Usuario no encontrado');
    }

    const { dni_enc, dni_iv } = result.rows[0];

    if (!dni_enc || !dni_iv) {
      return null; // Usuario sin DNI guardado
    }

    // Formato: encrypted:authTag
    const [encrypted, authTag] = dni_enc.split(':');
    const dni = decryptDni(encrypted, dni_iv, authTag);

    return dni;

  } catch (error) {
    console.error('Error al descifrar DNI:', error);
    throw error;
  }
};

// DEPRECADO: verifyToken con body (mantener por compatibilidad temporal)
const verifyToken = async (req, res) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({
        success: false,
        message: 'Token requerido'
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const result = await query(
      'SELECT id, email, nombre FROM users WHERE id = $1 AND is_active = true',
      [decoded.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Usuario no encontrado'
      });
    }

    res.json({
      success: true,
      user: result.rows[0]
    });

  } catch (error) {
    console.error('Error en verifyToken:', error);
    res.status(401).json({
      success: false,
      message: 'Token inválido o expirado'
    });
  }
};

module.exports = {
  login,
  register,
  verify,
  verifyToken,
  getDniForUser // NO exportar en routes, solo para uso interno
};
