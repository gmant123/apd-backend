require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { testConnection } = require('./config/database');
const { startCronJobs } = require('../jobs/scheduler');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/preferences', require('./routes/preferences'));
app.use('/api/offers', require('./routes/offers'));

// Health check
app.get('/', (req, res) => {
  res.json({ message: 'APD Backend API', status: 'running' });
});

// Conectar a base de datos
testConnection();

// Iniciar cron jobs
startCronJobs();

// Start server
app.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});
