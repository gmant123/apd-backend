const cron = require('node-cron');
const { syncOffersFromABC } = require('./syncOffers');

/**
 * Inicia los cron jobs programados
 */
function startCronJobs() {
  console.log('⏰ Iniciando cron jobs...');
  
  // 15:00 hs - Sync principal (post-adjudicación)
  cron.schedule('0 15 * * *', async () => {
    console.log('\n🔔 [CRON 15:00] Sync ofertas post-adjudicación');
    console.log('─'.repeat(50));
    await syncOffersFromABC();
    console.log('─'.repeat(50) + '\n');
  }, {
    timezone: 'America/Argentina/Buenos_Aires'
  });
  
  // 20:00 hs - Sync actualizaciones tardías
  cron.schedule('0 20 * * *', async () => {
    console.log('\n🔔 [CRON 20:00] Sync actualizaciones tardías');
    console.log('─'.repeat(50));
    await syncOffersFromABC();
    console.log('─'.repeat(50) + '\n');
  }, {
    timezone: 'America/Argentina/Buenos_Aires'
  });
  
  // 21:00 hs - Preparar notificaciones (implementar después)
  cron.schedule('0 21 * * *', async () => {
    console.log('\n🔔 [CRON 21:00] Preparando notificaciones...');
    console.log('─'.repeat(50));
    console.log('⏳ Push notifications pendiente de implementar (Track 3)');
    console.log('─'.repeat(50) + '\n');
    // TODO: Implementar sendDailyNotifications() cuando tengamos Firebase
  }, {
    timezone: 'America/Argentina/Buenos_Aires'
  });
  
  console.log('✅ Cron jobs configurados:');
  console.log('   📅 15:00 hs (AR): Sync ofertas post-adjudicación');
  console.log('   📅 20:00 hs (AR): Sync actualizaciones tardías');
  console.log('   📅 21:00 hs (AR): Notificaciones push (pendiente)');
  console.log('   🌍 Timezone: America/Argentina/Buenos_Aires\n');
}

module.exports = { startCronJobs };
