// jobs/scheduler.js
const cron = require('node-cron');
const { syncOffersFromABC } = require('./syncOffers');
const { sendDailyNotifications } = require('./notifications');
const { initializeFirebase } = require('../services/firebase');

const TZ = 'America/Argentina/Buenos_Aires';
const SEP = '─'.repeat(60);

/**
 * Horarios (AR, Dom→Vie; se excluye sábado = 6):
 * - 12:05 Sync
 * - 17:05 Sync
 * - 20:45 Sync (corte del día)
 * - 21:00 Notificaciones (leyenda “hasta 20:45”)
 */
function startCronJobs() {
  console.log('⏰ Iniciando cron jobs...\n');

  // Inicializar Firebase (necesario para notificaciones)
  try {
    initializeFirebase();
  } catch (error) {
    console.error('⚠️  Firebase no se pudo inicializar (las notificaciones NO funcionarán)\n');
  }

  // 12:05 — Primer sync del día (Dom-Vie)
  cron.schedule('5 12 * * 0-5', async () => {
    console.log(`\n🔔 [CRON 12:05] Sync ofertas (primer barrido)\n${SEP}`);
    try {
      const result = await syncOffersFromABC();
      if (result.success) {
        console.log('✅ Sync 12:05 OK');
      } else {
        console.error('❌ Sync 12:05 falló:', result.error);
      }
    } catch (error) {
      console.error('❌ Error crítico en sync 12:05:', error.message);
    }
    console.log(`${SEP}\n`);
  }, { timezone: TZ });

  // 17:05 — Segundo sync (Dom-Vie)
  cron.schedule('5 17 * * 0-5', async () => {
    console.log(`\n🔔 [CRON 17:05] Sync ofertas (actualización tarde)\n${SEP}`);
    try {
      const result = await syncOffersFromABC();
      if (result.success) {
        console.log('✅ Sync 17:05 OK');
      } else {
        console.error('❌ Sync 17:05 falló:', result.error);
      }
    } catch (error) {
      console.error('❌ Error crítico en sync 17:05:', error.message);
    }
    console.log(`${SEP}\n`);
  }, { timezone: TZ });

  // 20:45 — Tercer sync y corte del día (Dom-Vie)
  cron.schedule('45 20 * * 0-5', async () => {
    console.log(`\n🔔 [CRON 20:45] Sync ofertas (corte del día)\n${SEP}`);
    try {
      const result = await syncOffersFromABC();
      if (result.success) {
        console.log('✅ Sync 20:45 OK (corte aplicado)');
      } else {
        console.error('❌ Sync 20:45 falló:', result.error);
      }
    } catch (error) {
      console.error('❌ Error crítico en sync 20:45:', error.message);
    }
    console.log(`${SEP}\n`);
  }, { timezone: TZ });

  // 21:00 — Notificaciones diarias (Dom-Vie)
  cron.schedule('0 21 * * 0-5', async () => {
    console.log(`\n🔔 [CRON 21:00] Notificaciones diarias (corte 20:45)\n${SEP}`);
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

  console.log('✅ Cron jobs configurados:\n');
  console.log('   📅 12:05 (AR) Dom–Vie: Sync');
  console.log('   📅 17:05 (AR) Dom–Vie: Sync');
  console.log('   📅 20:45 (AR) Dom–Vie: Sync (corte del día)');
  console.log('   📅 21:00 (AR) Dom–Vie: Notificaciones (leyenda “hasta 20:45”)');
  console.log(`   🌍 Timezone: ${TZ}\n${SEP}\n`);
}

module.exports = { startCronJobs };
