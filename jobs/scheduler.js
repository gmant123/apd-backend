const cron = require('node-cron');
const { syncOffersFromABC } = require('./syncOffers');
const { sendDailyNotifications } = require('./notifications');
const { initializeFirebase } = require('../services/firebase');

function startCronJobs() {
  console.log('⏰ Iniciando cron jobs...\n');

  // Inicializar Firebase
  try {
    initializeFirebase();
  } catch (error) {
    console.error('⚠️  Firebase no se pudo inicializar');
    console.error('   Las notificaciones push NO funcionarán\n');
  }

  // 15:00 hs - Sync post-adjudicación
  cron.schedule('0 15 * * *', async () => {
    console.log('\n🔔 [CRON 15:00] Sync ofertas post-adjudicación');
    console.log('─'.repeat(60));
    try {
      const result = await syncOffersFromABC();
      if (result.success) {
        console.log('✅ Sync 15:00 completado exitosamente');
      } else {
        console.error('❌ Sync 15:00 falló:', result.error);
      }
    } catch (error) {
      console.error('❌ Error crítico en sync 15:00:', error.message);
    }
    console.log('─'.repeat(60) + '\n');
  }, {
    timezone: 'America/Argentina/Buenos_Aires'
  });

  // 20:00 hs - Sync actualizaciones tardías
  cron.schedule('0 20 * * *', async () => {
    console.log('\n🔔 [CRON 20:00] Sync actualizaciones tardías');
    console.log('─'.repeat(60));
    try {
      const result = await syncOffersFromABC();
      if (result.success) {
        console.log('✅ Sync 20:00 completado exitosamente');
      } else {
        console.error('❌ Sync 20:00 falló:', result.error);
      }
    } catch (error) {
      console.error('❌ Error crítico en sync 20:00:', error.message);
    }
    console.log('─'.repeat(60) + '\n');
  }, {
    timezone: 'America/Argentina/Buenos_Aires'
  });

  // 21:00 hs - Notificaciones diarias
  cron.schedule('0 21 * * *', async () => {
    console.log('\n🔔 [CRON 21:00] Notificaciones diarias');
    console.log('─'.repeat(60));
    try {
      const result = await sendDailyNotifications();
      if (result.success) {
        console.log(`✅ Notificaciones 21:00 completadas`);
        console.log(`   Usuarios notificados: ${result.notified}`);
        console.log(`   Usuarios sin ofertas: ${result.skipped}`);
      } else {
        console.error('❌ Notificaciones 21:00 fallaron:', result.error);
      }
    } catch (error) {
      console.error('❌ Error crítico en notificaciones 21:00:', error.message);
    }
    console.log('─'.repeat(60) + '\n');
  }, {
    timezone: 'America/Argentina/Buenos_Aires'
  });

  console.log('✅ Cron jobs configurados correctamente:\n');
  console.log('   📅 15:00 hs (AR): Sync ofertas post-adjudicación');
  console.log('   📅 20:00 hs (AR): Sync actualizaciones tardías');
  console.log('   📅 21:00 hs (AR): Notificaciones push diarias ✨');
  console.log('   🌍 Timezone: America/Argentina/Buenos_Aires\n');
  console.log('─'.repeat(60) + '\n');
}

module.exports = { startCronJobs };
