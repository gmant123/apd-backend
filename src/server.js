require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { testConnection } = require('./config/database');
const { startCronJobs } = require('../jobs/scheduler');
const requestIdMiddleware = require('./middleware/requestId');
const basicAuth = require('./middleware/basicAuth');

const app = express();
const PORT = process.env.PORT || 3000;

// ========== REQUEST ID (DEBE IR PRIMERO) ==========
app.use(requestIdMiddleware);

// ========== MIDDLEWARE BÁSICO ==========
app.use(cors());
app.use(express.json());

// ========== RUTAS ==========
app.use('/api/auth', require('./routes/auth'));
app.use('/api/preferences', require('./routes/preferences'));
app.use('/api/offers', require('./routes/offers'));

// Ruta raíz protegida con Basic Auth
app.get('/', basicAuth, (req, res) => {
  res.json({ 
    message: 'APD Backend API', 
    status: 'running',
    version: '1.1.0',
    timestamp: new Date().toISOString()
  });
});

// ========== INICIALIZACIÓN ==========
testConnection();
startCronJobs();

app.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});
