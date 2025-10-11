const Joi = require('joi');

/**
 * Schema de validación para registro de usuario
 */
const registerSchema = Joi.object({
  email: Joi.string()
    .email()
    .required()
    .messages({
      'string.email': 'El email debe tener un formato válido',
      'any.required': 'El email es requerido',
      'string.empty': 'El email no puede estar vacío'
    }),
  
  password: Joi.string()
    .min(8)
    .pattern(/^(?=.*[A-Z])(?=.*\d)/)
    .required()
    .messages({
      'string.min': 'La contraseña debe tener mínimo 8 caracteres',
      'string.pattern.base': 'La contraseña debe contener al menos 1 mayúscula y 1 número',
      'any.required': 'La contraseña es requerida',
      'string.empty': 'La contraseña no puede estar vacía'
    }),
  
  dni: Joi.string()
    .pattern(/^\d{8}$/)
    .required()
    .messages({
      'string.pattern.base': 'El DNI debe tener exactamente 8 dígitos numéricos',
      'any.required': 'El DNI es requerido',
      'string.empty': 'El DNI no puede estar vacío'
    }),
  
  nombre: Joi.string()
    .min(2)
    .max(100)
    .pattern(/^[a-zA-ZáéíóúÁÉÍÓÚñÑ\s]+$/)
    .required()
    .messages({
      'string.min': 'El nombre debe tener al menos 2 caracteres',
      'string.max': 'El nombre no puede superar 100 caracteres',
      'string.pattern.base': 'El nombre solo puede contener letras y espacios',
      'any.required': 'El nombre es requerido',
      'string.empty': 'El nombre no puede estar vacío'
    }),
  
  telefono: Joi.string()
    .pattern(/^\d{10}$/)
    .optional()
    .allow('', null)
    .messages({
      'string.pattern.base': 'El teléfono debe tener exactamente 10 dígitos'
    }),

  gremios: Joi.array()
    .items(Joi.string())
    .optional()
    .default([])
});

/**
 * Schema de validación para login
 */
const loginSchema = Joi.object({
  email: Joi.string()
    .email()
    .required()
    .messages({
      'string.email': 'El email debe tener un formato válido',
      'any.required': 'El email es requerido',
      'string.empty': 'El email no puede estar vacío'
    }),
  
  password: Joi.string()
    .min(8)
    .required()
    .messages({
      'string.min': 'La contraseña debe tener mínimo 8 caracteres',
      'any.required': 'La contraseña es requerida',
      'string.empty': 'La contraseña no puede estar vacía'
    })
});

/**
 * Schema de validación para preferencias
 */
const preferencesSchema = Joi.object({
  modalidades: Joi.array()
    .items(Joi.string())
    .max(9)
    .optional()
    .default([])
    .messages({
      'array.max': 'No puedes seleccionar más de 9 modalidades'
    }),
  
  distritos: Joi.array()
    .items(Joi.string())
    .max(3)
    .optional()
    .default([])
    .messages({
      'array.max': 'No puedes seleccionar más de 3 distritos'
    }),
  
  turnos: Joi.array()
    .items(Joi.string().valid('M', 'T', 'N'))
    .optional()
    .default([])
    .messages({
      'any.only': 'Los turnos solo pueden ser M (Mañana), T (Tarde) o N (Noche)'
    }),
  
  notif_diaria: Joi.boolean()
    .optional()
    .default(true),
  
  notif_urgentes: Joi.boolean()
    .optional()
    .default(false),
  
  notif_hora: Joi.string()
    .pattern(/^([01]\d|2[0-3]):([0-5]\d)$/)
    .optional()
    .default('21:00')
    .messages({
      'string.pattern.base': 'La hora debe tener formato HH:MM (ejemplo: 21:00)'
    })
});

/**
 * Middleware de validación
 * Uso: router.post('/ruta', validate(schema), controller)
 */
const validate = (schema) => {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.body, {
      abortEarly: false,    // Retornar todos los errores
      stripUnknown: true,   // Remover campos no definidos en schema
      convert: true         // Convertir tipos automáticamente
    });

    if (error) {
      const errors = error.details.map(detail => ({
        field: detail.path.join('.'),
        message: detail.message
      }));

      return res.status(400).json({
        success: false,
        message: 'Errores de validación',
        errors
      });
    }

    // Reemplazar req.body con el valor validado y sanitizado
    req.body = value;
    next();
  };
};

module.exports = {
  validate,
  registerSchema,
  loginSchema,
  preferencesSchema
};
