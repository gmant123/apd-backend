/**
 * Utilidades de criptografía para DNI
 * - Hash con HMAC-SHA256 (para índice único)
 * - Cifrado con AES-256-GCM (para almacenamiento seguro)
 */

const crypto = require('crypto');

/**
 * Normaliza un DNI: quita espacios, puntos, guiones
 * Retorna 8 dígitos o lanza error
 */
function normalizeDni(dni) {
  if (!dni) {
    throw new Error('DNI requerido');
  }

  // Quitar todo excepto números
  const clean = String(dni).replace(/\D/g, '');

  // Validar longitud
  if (clean.length !== 8) {
    throw new Error('DNI debe tener 8 dígitos');
  }

  // Validar que sea numérico
  if (!/^\d{8}$/.test(clean)) {
    throw new Error('DNI debe contener solo números');
  }

  return clean;
}

/**
 * Genera hash del DNI usando HMAC-SHA256
 * Este hash se usa como índice único en la BD
 * @param {string} dni - DNI de 8 dígitos
 * @returns {string} Hash hexadecimal de 64 caracteres
 */
function dniHash(dni) {
  const normalized = normalizeDni(dni);
  const secret = process.env.DNI_HASH_SECRET;

  if (!secret) {
    throw new Error('DNI_HASH_SECRET no configurado en variables de entorno');
  }

  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(normalized);
  return hmac.digest('hex');
}

/**
 * Cifra un DNI usando AES-256-GCM
 * @param {string} dni - DNI de 8 dígitos
 * @returns {object} { encrypted: string, iv: string, authTag: string }
 */
function encryptDni(dni) {
  const normalized = normalizeDni(dni);
  const encKey = process.env.DNI_ENC_KEY;

  if (!encKey) {
    throw new Error('DNI_ENC_KEY no configurado en variables de entorno');
  }

  // Convertir clave base64 a Buffer
  const key = Buffer.from(encKey, 'base64');

  if (key.length !== 32) {
    throw new Error('DNI_ENC_KEY debe ser de 32 bytes (256 bits)');
  }

  // Generar IV único de 16 bytes
  const iv = crypto.randomBytes(16);

  // Crear cipher
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  // Cifrar
  let encrypted = cipher.update(normalized, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  // Obtener auth tag (para integridad)
  const authTag = cipher.getAuthTag();

  return {
    encrypted: encrypted,
    iv: iv.toString('hex'),
    authTag: authTag.toString('hex')
  };
}

/**
 * Descifra un DNI
 * @param {string} encrypted - DNI cifrado (hex)
 * @param {string} ivHex - IV usado para cifrar (hex)
 * @param {string} authTagHex - Auth tag (hex)
 * @returns {string} DNI descifrado (8 dígitos)
 */
function decryptDni(encrypted, ivHex, authTagHex) {
  const encKey = process.env.DNI_ENC_KEY;

  if (!encKey) {
    throw new Error('DNI_ENC_KEY no configurado');
  }

  const key = Buffer.from(encKey, 'base64');
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

module.exports = {
  normalizeDni,
  dniHash,
  encryptDni,
  decryptDni
};
