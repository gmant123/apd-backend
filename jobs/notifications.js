/**
 * Notificaciones diarias + Test
 * Soporta FCM y Expo. Limpia tokens inválidos automáticamente.
 */

const { query } = require('../src/config/database');
const {
  initializeFirebase,
  sendBatchNotifications,
  sendPushNotification,
} = require('../services/firebase');

// ---- Helpers Expo -----------------------------------------------------------
function isExpoToken(token) {
  return typeof token === 'string' && /^ExponentPushToken\[/i.test(token);
}

async function sendExpoBatch(notifs, notification, data) {
  // notifs: [{ userId, token }]
  if (!notifs.length) return { success: 0, failure: 0, responses: [] };

  const payloads = notifs.map(n => ({
    to: n.token,
    title: notification?.title || 'APD Ofertas',
    body: notification?.body || 'Hay ofertas disponibles para vos',
    data: data || {},
    sound: 'default',
    priority: 'high',
  }));

  const res = await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Accept-Encoding': 'gzip, deflate',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payloads),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Expo push HTTP ${res.status} ${res.statusText} ${txt}`.trim());
  }

  const json = await res.json().catch(() => null);
  const arr = Array.isArray(json) ? json : json?.data || [];
  let success = 0, failure = 0;

  // Mapear 1:1 respuesta → notifs para poder limpiar tokens inválidos
  for (let i = 0; i < arr.length; i++) {
    const r = arr[i];
    const n = notifs[i];
    if (r?.status === 'ok') {
      success++;
    } else {
      failure++;
      const err = r?.details?.error || r?.message || 'unknown';
      if (/DeviceNotRegistered/i.test(err)) {
        // Limpia el token inválido: la app lo repondrá al abrirse
        try { await query(`UPDATE users SET device_token = NULL WHERE id = $1`, [n.userId]); }
        catch (e) { console.error(`   ⚠️  No se pudo limpiar token Expo de user ${n.userId}:`, e.message); }
      }
    }
  }

  return { success, failure, responses: arr };
}

const CUTOFF_LABEL = 'Ofertas de hoy (hasta 20:45)';
// ----------------------------------------------------------------------------

async function sendDailyNotifications() {
  console.log('🔔 Iniciando envío de notificaciones diarias...');
  const startTime = Date.now();

  // Inicializar Firebase (solo una vez)
  try { initializeFirebase(); } catch (e) {
    const msg = (e && e.message) || '';
    if (!/already exists|duplicate-app/i.test(msg)) throw e;
  }

  try {
    // 1) Usuarios activos con notificaciones habilitadas y token presente
    const usersResult = await query(`
      SELECT 
        u.id,
        u.email,
        u.nombre,
        u.device_token,
        COALESCE(up.notif_diaria, true) AS notif_diaria
      FROM users u
      LEFT JOIN user_preferences up ON up.user_id = u.id
      WHERE 
        u.is_active = true 
        AND u.device_token IS NOT NULL 
        AND u.device_token <> ''
        AND COALESCE(up.notif_diaria, true) = true
    `);

    const users = usersResult.rows;
    console.log(`👥 Usuarios con notificaciones activas: ${users.length}`);

    if (users.length === 0) {
      console.log('⚠️  No hay usuarios para notificar');
      return { success: true, notified: 0, skipped: 0 };
    }

    let notified = 0;
    let skipped = 0;

    const expoNotifs = []; // [{ userId, token }]
    const fcmNotifs = [];  // [{ userId, token, email, name, count }]

    // 2) Para cada usuario, contar ofertas disponibles según sus preferencias
    for (const user of users) {
      try {
        // Obtener preferencias del usuario
        const prefsResult = await query(
          `SELECT modalidades, distritos FROM user_preferences WHERE user_id = $1`,
          [user.id]
        );

        if (prefsResult.rows.length === 0) {
          skipped++;
          continue;
        }

        const prefs = prefsResult.rows[0];
        const modalidades = prefs.modalidades || [];
        const distritos = prefs.distritos || [];

        if (modalidades.length === 0 || distritos.length === 0) {
          skipped++;
          continue;
        }

        // Contar ofertas que coinciden con preferencias
        const offersResult = await query(
          `SELECT COUNT(*) AS count 
           FROM offers o
           WHERE o.is_active = true
             AND LOWER(o.modalidad) = ANY($1::text[])
             AND LOWER(o.distrito) = ANY($2::text[])`,
          [modalidades.map(m => m.toLowerCase()), distritos.map(d => d.toLowerCase())]
        );

        const offersCount = parseInt(offersResult.rows[0].count, 10) || 0;

        if (offersCount === 0) {
          skipped++;
          continue;
        }

        if (isExpoToken(user.device_token)) {
          expoNotifs.push({ userId: user.id, token: user.device_token });
        } else {
          fcmNotifs.push({
            userId: user.id,
            token: user.device_token,
            userEmail: user.email,
            userName: user.nombre,
            count: offersCount,
          });
        }
        notified++;
      } catch (err) {
        console.error(`   ❌ Error procesando user ${user.id}:`, err.message);
        skipped++;
      }
    }

    // 3) Enviar EXPO y limpiar tokens inválidos si los hay
    if (expoNotifs.length) {
      console.log(`\n📤 Expo: enviando ${expoNotifs.length} notificaciones…`);
      const r = await sendExpoBatch(
        expoNotifs,
        { title: 'APD Ofertas', body: `${CUTOFF_LABEL} — ¡Abrí APD Ofertas!` },
        { screen: 'Ofertas', cutoff: '20:45', badge: '1' }
      );
      console.log(`✅ Expo: Success=${r.success} Failure=${r.failure}`);
    }

    // 4) Enviar FCM; si hay tokens inválidos, limpiarlos
    if (fcmNotifs.length) {
      console.log(`\n📤 FCM: enviando ${fcmNotifs.length} notificaciones…`);

      if (fcmNotifs.length > 5) {
        const tokens = fcmNotifs.map(n => n.token);
        const result = await sendBatchNotifications(
          tokens,
          { title: 'APD Ofertas', body: `${CUTOFF_LABEL} — ¡Abrí APD Ofertas!` },
          { screen: 'Ofertas', cutoff: '20:45', badge: '1' }
        );
        console.log(`✅ FCM batch: Success=${result.success} Failure=${result.failure}`);

        // Limpieza por respuesta individual (si el servicio la expone)
        const responses = result.responses || [];
        for (let i = 0; i < responses.length; i++) {
          const resp = responses[i];
          const userId = fcmNotifs[i]?.userId;
          const code = resp?.error?.code || '';
          if (/registration-token-not-registered/i.test(code)) {
            try { await query(`UPDATE users SET device_token = NULL WHERE id = $1`, [userId]); }
            catch (e) { console.error(`   ⚠️  No se pudo limpiar token FCM de user ${userId}:`, e.message); }
          }
        }

        if ((result.success || 0) === 0) throw new Error('Todas las notificaciones FCM batch fallaron');
        // Marcar como notificados (a nivel user)
        for (const notif of fcmNotifs) {
          try { await query(`UPDATE user_offers SET notified_at = NOW() WHERE user_id = $1`, [notif.userId]); }
          catch (err) { console.error(`   ⚠️  Error marcando notificado user ${notif.userId}:`, err.message); }
        }
      } else {
        let successCount = 0;
        let failureCount = 0;
        for (const notif of fcmNotifs) {
          try {
            const ok = await sendPushNotification(
              notif.token,
              { title: 'APD Ofertas', body: `${CUTOFF_LABEL} — Tenés ${notif.count} oferta${notif.count > 1 ? 's' : ''}.` },
              { screen: 'Ofertas', cutoff: '20:45', badge: String(notif.count) }
            );
            if (ok) {
              successCount++;
              await query(`UPDATE user_offers SET notified_at = NOW() WHERE user_id = $1`, [notif.userId]);
            } else {
              failureCount++;
            }
          } catch (err) {
            failureCount++;
            const code = err?.errorInfo?.code || err?.message || '';
            if (/registration-token-not-registered/i.test(code)) {
              try { await query(`UPDATE users SET device_token = NULL WHERE id = $1`, [notif.userId]); }
              catch (e) { console.error(`   ⚠️  No se pudo limpiar token FCM de user ${notif.userId}:`, e.message); }
            } else {
              console.error(`   ❌ Error FCM a user ${notif.userId}:`, err.message);
            }
          }
        }
        console.log(`✅ FCM individuales: Success=${successCount} Failure=${failureCount}`);
        if (successCount === 0) throw new Error('Todas las notificaciones FCM individuales fallaron');
      }
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`\n✅ Notificaciones completadas en ${duration}s`);
    console.log(`   Usuarios con ofertas: ${notified}`);
    console.log(`   Sin ofertas: ${skipped}`);

    return {
      success: true,
      notified,
      skipped,
      expo: expoNotifs.length,
      fcm: fcmNotifs.length,
      duration: parseFloat(duration),
    };
  } catch (error) {
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.error(`❌ Error en sendDailyNotifications (${duration}s):`, error.message);
    console.error(error.stack);
    throw error;
  }
}

/** Test: envía a un usuario específico (Expo o FCM) y limpia si corresponde */
async function sendTestNotification(userId) {
  console.log(`🧪 Enviando notificación de prueba a usuario ${userId}...`);

  try { initializeFirebase(); } catch (e) {
    const msg = (e && e.message) || '';
    if (!/already exists|duplicate-app/i.test(msg)) throw e;
  }

  try {
    const userResult = await query(
      `SELECT id, email, nombre, device_token FROM users WHERE id = $1`,
      [userId]
    );
    if (userResult.rows.length === 0) throw new Error(`Usuario ${userId} no encontrado`);
    const user = userResult.rows[0];
    if (!user.device_token) throw new Error(`Usuario ${user.id} no tiene device_token`);

    if (isExpoToken(user.device_token)) {
      const r = await sendExpoBatch(
        [{ userId: user.id, token: user.device_token }],
        { title: '🧪 Test APD Ofertas', body: 'Push de prueba (Expo)' },
        { screen: 'Home', test: 'true' }
      );
      console.log(`✅ Expo test: Success=${r.success} Failure=${r.failure}`);
      return r.success > 0;
    } else {
      try {
        const ok = await sendPushNotification(
          user.device_token,
          { title: '🧪 Test APD Ofertas', body: `Hola ${user.nombre || 'docente'}, esta es una notificación de prueba (FCM)` },
          { screen: 'Home', test: 'true' }
        );
        if (ok) console.log(`✅ FCM test OK para ${user.email || user.id}`);
        return ok;
      } catch (err) {
        const code = err?.errorInfo?.code || err?.message || '';
        if (/registration-token-not-registered/i.test(code)) {
          try { await query(`UPDATE users SET device_token = NULL WHERE id = $1`, [user.id]); }
          catch (e) { console.error(`   ⚠️  No se pudo limpiar token FCM de user ${user.id}:`, e.message); }
        }
        console.error('❌ Error en sendTestNotification:', err.message);
        throw err;
      }
    }
  } catch (error) {
    console.error('❌ Error en sendTestNotification:', error.message);
    throw error;
  }
}

module.exports = {
  sendDailyNotifications,
  sendTestNotification,
};
