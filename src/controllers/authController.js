const argon2 = require('argon2');
const jwt = require('jsonwebtoken');
const { query } = require('../config/database');

/**
 * Login de usuario
 * POST /api/auth/login
 */
const login = async (req, res) => {
  try {
    const { dni, password } = req.body;

    // Validar datos recibidos
    if (!dni || !password) {
      return res.status(400).json({
        success: false,
        message: 'DNI y contraseña son requeridos'
      });
    }

    // Buscar usuario en la base de datos
    const result = await query(
      'SELECT * FROM users WHERE dni = $1 AND is_active = true',
      [dni]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'DNI o contraseña incorrectos'
      });
    }

    const user = result.rows[0];

    // Verificar contraseña
    const validPassword = await bcrypt.compare(password, user.password_hash);

    if (!validPassword) {
      return res.status(401).json({
        success: false,
        message: 'DNI o contraseña incorrectos'
      });
    }

    // Actualizar última conexión
    await query(
      'UPDATE users SET last_login = NOW() WHERE id = $1',
      [user.id]
    );

    // Generar JWT token
    const token = jwt.sign(
      {
        id: user.id,
        dni: user.dni,
        gremio: user.gremio
      },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRY || '7d' }
    );

    // Responder con token y datos del usuario
    res.json({
      success: true,
      message: 'Login exitoso',
      token,
      user: {
        id: user.id,
        dni: user.dni,
        nombre: user.nombre,
        email: user.email,
        gremio: user.gremio
      }
    });

  } catch (error) {
    console.error('Error en login:', error);
    res.status(500).json({
      success: false,
      message: 'Error al procesar login'
    });
  }
};

/**
 * Registro de nuevo usuario
 * POST /api/auth/register
 */
const register = async (req, res) => {
  try {
    const { dni, password, nombre, email, gremio } = req.body;

    // Validar datos requeridos
    if (!dni || !password || !nombre) {
      return res.status(400).json({
        success: false,
        message: 'DNI, contraseña y nombre son requeridos'
      });
    }

    // Validar formato DNI (8 dígitos)
    if (!/^\d{8}$/.test(dni)) {
      return res.status(400).json({
        success: false,
        message: 'DNI debe tener 8 dígitos'
      });
    }

    // Verificar si el usuario ya existe
    const existingUser = await query(
      'SELECT id FROM users WHERE dni = $1',
      [dni]
    );

    if (existingUser.rows.length > 0) {
      return res.status(409).json({
        success: false,
        message: 'El DNI ya está registrado'
      });
    }

    // Hash de la contraseña
    const salt = await bcrypt.genSalt(10);
    const passwordMatch = await argon2.verify(user.password_hash, password);

    // Insertar nuevo usuario
    const result = await query(
      'INSERT INTO users (dni, password_hash, nombre, email, gremio) VALUES ($1, $2, $3, $4, $5) RETURNING id, dni, nombre, email, gremio',
      [dni, passwordHash, nombre, email || null, gremio || 'AMET']
    );

    const newUser = result.rows[0];

    // Crear preferencias por defecto
    await query(
      'INSERT INTO user_preferences (user_id, modalidades, distritos, turnos) VALUES ($1, $2, $3, $4)',
      [newUser.id, JSON.stringify([]), JSON.stringify([]), JSON.stringify([])]
    );

    // Generar token
    const token = jwt.sign(
      {
        id: newUser.id,
        dni: newUser.dni,
        gremio: newUser.gremio
      },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRY || '7d' }
    );

    res.status(201).json({
      success: true,
      message: 'Usuario registrado exitosamente',
      token,
      user: newUser
    });

  } catch (error) {
    console.error('Error en registro:', error);
    res.status(500).json({
      success: false,
      message: 'Error al registrar usuario'
    });
  }
};

/**
 * Verificar token JWT (método antiguo - body)
 * POST /api/auth/verify
 */
const verifyToken = async (req, res) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({
        success: false,
        message: 'Token no proporcionado'
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    res.json({
      success: true,
      message: 'Token válido',
      user: {
        id: decoded.id,
        dni: decoded.dni,
        gremio: decoded.gremio
      }
    });

  } catch (error) {
    res.status(401).json({
      success: false,
      message: 'Token inválido o expirado'
    });
  }
};

/**
 * Verificar sesión activa (método nuevo - header)
 * GET /api/auth/verify
 * Requiere: authMiddleware
 */
const verify = async (req, res) => {
  try {
    // req.user ya viene del authMiddleware (token decodificado)
    const userId = req.user.id;

    // Consultar BD para obtener info actualizada
    const result = await query(
      'SELECT id, dni, nombre, email, gremios, created_at, last_login FROM users WHERE id = $1 AND is_active = true',
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Usuario no encontrado o inactivo'
      });
    }

    const user = result.rows[0];

    // Verificar si tiene preferencias configuradas
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
        dni: user.dni,
        nombre: user.nombre,
        email: user.email,
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

module.exports = {
  login,
  register,
  verifyToken,
  verify
};

