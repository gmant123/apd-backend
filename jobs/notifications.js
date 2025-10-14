/**
 * Job de Notificaciones Diarias (21:00 AR, Dom–Vie)
 * Soporta tokens FCM y Expo (ExponentPushToken[...]).
 * - FCM: usa Firebase Admin (services/firebase.js)
 * - Expo: usa el Expo Push API
 */

const { query } = require('../src/config/database');
const {
  initializeFirebase,
  sendBatchNotifications,
  sendPushNotification,
} = require('../services/firebase');

// === Helpers Expo ============================================================
async function sendExpoBatch(tokens, notification, data) {
  // Expo: máx 100 por request; hacemos un único POST si son pocos
  const payloads = tokens.map((t) => ({
    to: t,
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
  // Respuesta típica: [{ status: 'ok', id: '…' }, { status: 'error', details: { error: 'DeviceNotRegistered' }, … }]
  const arr = Array.isArray(json) ? json : json?.data || [];
  let success = 0;
  let failure = 0;

  for (const r of arr) {
    if (r?.status === 'ok') success++;
    else failure++;
  }
  return { success, failure, raw: json };
}

function isExpoToken(token) {
  return typeof token === 'string' && /^ExponentPushToken\[/i.test(token);
}

const CUTOFF_LABEL = 'Ofertas de hoy (hasta 20:45)';
// ============================================================================

async function sendDailyNotifications() {
  console.log('🔔 Iniciando envío de notificaciones diarias...');
  const startTime = Date.now();

  // Firebase sólo si vamos a enviar FCM; igual lo inicializamos una vez
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

    const expoTokens = [];
    const fcmNotifs = []; // { token, userId, count, email, name }

    // 2) Para cada usuario, contar ofertas disponibles (criterio actual)
    for (const user of users) {
      try {
        const offersResult = await query(
          `SELECT COUNT(*) AS count FROM user_offers WHERE user_id = $1`,
          [user.id]
        );
        const offersCount = parseInt(offersResult.rows[0].count, 10) || 0;

        if (offersCount === 0) {
          console.log(`   ⏭️  ${user.id} (${user.email || 'sin-email'}): sin ofertas`);
          skipped++;
          continue;
        }

        if (isExpoToken(user.device_token)) {
          expoTokens.push(user.device_token);
        } else {
          fcmNotifs.push({
            token: user.device_token,
            userId: user.id,
            userEmail: user.email,
            userName: user.nombre,
            count: offersCount,
          });
        }

        console.log(
          `   ✅ ${user.id} (${user.email || 'sin-email'}): ${offersCount} oferta${offersCount > 1 ? 's' : ''}`
        );
        notified++;
      } catch (err) {
        console.error(`   ❌ Error procesando usuario ${user.id}:`, err.message);
        skipped++;
      }
    }

    // 3) Enviar EXPO (si hay)
    if (expoTokens.length) {
      console.log(`\n📤 Expo: enviando ${expoTokens.length} notificaciones…`);
      const r = await sendExpoBatch(
        expoTokens,
        { title: 'APD Ofertas', body: `${CUTOFF_LABEL} — ¡Abrí APD Ofertas!` },
        { screen: 'Ofertas', cutoff: '20:45', badge: '1' }
      );
      console.log(`✅ Expo: Success=${r.success} Failure=${r.failure}`);
      // Nota: marcamos como notificados a todos los usuarios con Expo token (no tenemos userId aquí; si querés, podemos mapearlo arriba)
      // Para mantener consistencia con FCM, no hacemos UPDATE user_offers aquí.
    }

    // 4) Enviar FCM (si hay)
    if (fcmNotifs.length) {
      console.log(`\n📤 FCM: enviando ${fcmNotifs.length} notificaciones…`);

      if (fcmNotifs.length > 5) {
        const tokens = fcmNotifs.map((n) => n.token);
        const result = await sendBatchNotifications(
          tokens,
          { title: 'APD Ofertas', body: `${CUTOFF_LABEL} — ¡Abrí APD Ofertas!` },
          { screen: 'Ofertas', cutoff: '20:45', badge: '1' }
        );
        console.log(`✅ FCM batch: Success=${result.success} Failure=${result.failure}`);
        if ((result.success || 0) === 0) throw new Error('Todas las notificaciones FCM batch fallaron');
        // Marcar como notificadas (a nivel user)
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
            console.error(`   ❌ Error FCM a user ${notif.userId}:`, err.message);
            failureCount++;
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

    return { success: true, notified, skipped, expo: expoTokens.length, fcm: fcmNotifs.length, duration: parseFloat(duration) };
  } catch (error) {
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.error(`❌ Error en sendDailyNotifications (${duration}s):`, error.message);
    console.error(error.stack);
    throw error;
  }
}

/** Test manual: enviar a un usuario específico (Expo o FCM) */
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

    const isExpo = isExpoToken(user.device_token);

    if (isExpo) {
      const r = await sendExpoBatch(
        [user.device_token],
        { title: '🧪 Test APD Ofertas', body: 'Push de prueba (Expo)' },
        { screen: 'Home', test: 'true' }
      );
      console.log(`✅ Expo test: Success=${r.success} Failure=${r.failure}`);
      return r.success > 0;
    } else {
      const ok = await sendPushNotification(
        user.device_token,
        { title: '🧪 Test APD Ofertas', body: `Hola ${user.nombre || 'docente'}, esta es una notificación de prueba (FCM)` },
        { screen: 'Home', test: 'true' }
      );
      if (ok) console.log(`✅ FCM test OK para ${user.email || user.id}`);
      else console.log(`❌ FCM test falló para ${user.email || user.id}`);
      return ok;
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
