const cron = require('node-cron');
const { syncOffersFromABC } = require('./syncOffers');
const { sendDailyNotifications } = require('./notifications');
const { initializeFirebase } = require('../services/firebase');

const TZ = 'America/Argentina/Buenos_Aires';
const SEP = '─'.repeat(60);

function startCronJobs() {
  console.log('⏰ Iniciando cron jobs...\n');

  try {
    initializeFirebase();
  } catch (error) {
    console.error('⚠️  Firebase no se pudo inicializar (las notificaciones NO funcionarán)\n');
  }

  cron.schedule('0 5 * * 0-5', async () => {
    console.log(`\n🔔 [CRON 05:00] Sync ofertas (madrugadores)\n${SEP}`);
    try {
      const result = await syncOffersFromABC();
      if (result.success) {
        console.log('✅ Sync 05:00 OK');
      } else {
        console.error('❌ Sync 05:00 falló:', result.error);
      }
    } catch (error) {
      console.error('❌ Error crítico en sync 05:00:', error.message);
    }
    console.log(`${SEP}\n`);
  }, { timezone: TZ });

  cron.schedule('0 12 * * 0-5', async () => {
    console.log(`\n🔔 [CRON 12:00] Sync ofertas (post turno mañana)\n${SEP}`);
    try {
      const result = await syncOffersFromABC();
      if (result.success) {
        console.log('✅ Sync 12:00 OK');
      } else {
        console.error('❌ Sync 12:00 falló:', result.error);
      }
    } catch (error) {
      console.error('❌ Error crítico en sync 12:00:', error.message);
    }
    console.log(`${SEP}\n`);
  }, { timezone: TZ });

  cron.schedule('0 14 * * 0-5', async () => {
    console.log(`\n🔔 [CRON 14:00] Sync ofertas (inicio actividad tarde)\n${SEP}`);
    try {
      const result = await syncOffersFromABC();
      if (result.success) {
        console.log('✅ Sync 14:00 OK');
      } else {
        console.error('❌ Sync 14:00 falló:', result.error);
      }
    } catch (error) {
      console.error('❌ Error crítico en sync 14:00:', error.message);
    }
    console.log(`${SEP}\n`);
  }, { timezone: TZ });

  cron.schedule('0 15 * * 0-5', async () => {
    console.log(`\n🔔 [CRON 15:00] Sync ofertas (pico 25%)\n${SEP}`);
    try {
      const result = await syncOffersFromABC();
      if (result.success) {
        console.log('✅ Sync 15:00 OK');
      } else {
        console.error('❌ Sync 15:00 falló:', result.error);
      }
    } catch (error) {
      console.error('❌ Error crítico en sync 15:00:', error.message);
    }
    console.log(`${SEP}\n`);
  }, { timezone: TZ });

  cron.schedule('0 16 * * 0-5', async () => {
    console.log(`\n🔔 [CRON 16:00] Sync ofertas (pico máximo 46%)\n${SEP}`);
    try {
      const result = await syncOffersFromABC();
      if (result.success) {
        console.log('✅ Sync 16:00 OK');
      } else {
        console.error('❌ Sync 16:00 falló:', result.error);
      }
    } catch (error) {
      console.error('❌ Error crítico en sync 16:00:', error.message);
    }
    console.log(`${SEP}\n`);
  }, { timezone: TZ });

  cron.schedule('0 17 * * 0-5', async () => {
    console.log(`\n🔔 [CRON 17:00] Sync ofertas (cierre turno tarde)\n${SEP}`);
    try {
      const result = await syncOffersFromABC();
      if (result.success) {
        console.log('✅ Sync 17:00 OK');
      } else {
        console.error('❌ Sync 17:00 falló:', result.error);
      }
    } catch (error) {
      console.error('❌ Error crítico en sync 17:00:', error.message);
    }
    console.log(`${SEP}\n`);
  }, { timezone: TZ });

  cron.schedule('0 20 * * 0-5', async () => {
    console.log(`\n🔔 [CRON 20:00] Sync ofertas (pico noche 26%)\n${SEP}`);
    try {
      const result = await syncOffersFromABC();
      if (result.success) {
        console.log('✅ Sync 20:00 OK');
      } else {
        console.error('❌ Sync 20:00 falló:', result.error);
      }
    } catch (error) {
      console.error('❌ Error crítico en sync 20:00:', error.message);
    }
    console.log(`${SEP}\n`);
  }, { timezone: TZ });

  cron.schedule('55 20 * * 0-5', async () => {
    console.log(`\n🔔 [CRON 20:55] Sync ofertas (pre-push)\n${SEP}`);
    try {
      const result = await syncOffersFromABC();
      if (result.success) {
        console.log('✅ Sync 20:55 OK (último del día)');
      } else {
        console.error('❌ Sync 20:55 falló:', result.error);
      }
    } catch (error) {
      console.error('❌ Error crítico en sync 20:55:', error.message);
    }
    console.log(`${SEP}\n`);
  }, { timezone: TZ });

  cron.schedule('0 21 * * 0-5', async () => {
    console.log(`\n🔔 [CRON 21:00] Notificaciones diarias\n${SEP}`);
    try {
      const result = await sendDailyNotifications();
      if (result && result.success) {
        console.log(`✅ Notificaciones 21:00 OK`);
        console.log(`   Usuarios notificados: ${result.notified}`);
        console.log(`   Usuarios sin ofertas: ${result.skipped}`);
      } else {
        console.error('❌ Notificaciones 21:00 fallaron:', result && result.error);
      }
    } catch (error) {
      console.error('❌ Error crítico en notificaciones 21:00:', error.message);
    }
    console.log(`${SEP}\n`);
  }, { timezone: TZ });

  cron.schedule('0 23 * * 0-5', async () => {
    console.log(`\n🔔 [CRON 23:00] Sync ofertas (tardías 3%)\n${SEP}`);
    try {
      const result = await syncOffersFromABC();
      if (result.success) {
        console.log('✅ Sync 23:00 OK');
      } else {
        console.error('❌ Sync 23:00 falló:', result.error);
      }
    } catch (error) {
      console.error('❌ Error crítico en sync 23:00:', error.message);
    }
    console.log(`${SEP}\n`);
  }, { timezone: TZ });

  console.log('✅ Cron jobs configurados:\n');
  console.log('   📅 05:00 (AR) Dom–Vie: Sync (madrugadores)');
  console.log('   📅 12:00 (AR) Dom–Vie: Sync (post turno mañana)');
  console.log('   📅 14:00 (AR) Dom–Vie: Sync (inicio tarde)');
  console.log('   📅 15:00 (AR) Dom–Vie: Sync (pico 25%)');
  console.log('   📅 16:00 (AR) Dom–Vie: Sync (pico máximo 46%)');
  console.log('   📅 17:00 (AR) Dom–Vie: Sync (cierre tarde)');
  console.log('   📅 20:00 (AR) Dom–Vie: Sync (pico noche 26%)');
  console.log('   📅 20:55 (AR) Dom–Vie: Sync (pre-push)');
  console.log('   📅 21:00 (AR) Dom–Vie: Push notifications');
  console.log('   📅 23:00 (AR) Dom–Vie: Sync (tardías 3%)');
  console.log(`   🌍 Timezone: ${TZ}\n${SEP}\n`);
}

module.exports = { startCronJobs };
