/**
 * Job de Notificaciones Diarias
 * Se ejecuta a las 21:00 hs (configurado en server.js)
 * Envía push notification a usuarios con ofertas disponibles
 */

const { query } = require('../src/config/database');
const {
  initializeFirebase,
  sendBatchNotifications,
  sendPushNotification,
} = require('../services/firebase');

/**
 * Enviar notificaciones diarias a las 21:00
 * - Obtiene usuarios activos con notificaciones habilitadas
 * - Cuenta ofertas disponibles para cada usuario
 * - Envía push notification si hay ofertas
 */
async function sendDailyNotifications() {
  console.log('🔔 Iniciando envío de notificaciones diarias...');
  const startTime = Date.now();

  // Asegurar Firebase inicializado (el job corre sin arrancar el server)
  try {
    initializeFirebase();
  } catch (e) {
    // Ignorar si ya estaba inicializado
    const msg = (e && e.message) || '';
    if (!/already exists|duplicate-app/i.test(msg)) {
      throw e;
    }
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
    const notifications = [];

    // 2) Para cada usuario, contar ofertas disponibles (criterio actual)
    for (const user of users) {
      try {
        const offersResult = await query(
          `SELECT COUNT(*) AS count FROM user_offers WHERE user_id = $1`,
          [user.id]
        );

        const offersCount = parseInt(offersResult.rows[0].count, 10) || 0;

        if (offersCount === 0) {
          console.log(`   ⏭️  Usuario ${user.id} (${user.email || 'sin-email'}): sin ofertas`);
          skipped++;
          continue;
        }

        notifications.push({
          token: user.device_token,
          userId: user.id,
          userEmail: user.email,
          userName: user.nombre,
          count: offersCount,
        });

        console.log(
          `   ✅ Usuario ${user.id} (${user.email || 'sin-email'}): ${offersCount} oferta${offersCount > 1 ? 's' : ''}`
        );
        notified++;
      } catch (err) {
        console.error(`   ❌ Error procesando usuario ${user.id}:`, err.message);
        skipped++;
      }
    }

    // 3) Enviar notificaciones
    if (notifications.length === 0) {
      console.log('⚠️  No hay notificaciones para enviar');
      return { success: true, notified: 0, skipped: users.length };
    }

    console.log(`\n📤 Enviando ${notifications.length} notificaciones...`);

    if (notifications.length > 5) {
      // Batch: mismo título/body para todos
      const tokens = notifications.map((n) => n.token);

      const result = await sendBatchNotifications(
        tokens,
        {
          title: 'APD Ofertas',
          body: 'Hay ofertas disponibles para vos el dia de hoy - ¡Abrí APD Ofertas!',
        },
        {
          screen: 'Ofertas',
          badge: '1', // data siempre string
        }
      );

      console.log(`✅ Notificaciones batch enviadas:`);
      console.log(`   Success: ${result.success}`);
      console.log(`   Failure: ${result.failure}`);

      // Si absolutamente todas fallaron, falla el job (útil para shell)
      if ((result.success || 0) === 0) {
        throw new Error('Todas las notificaciones batch fallaron');
      }

      // Marcar como notificadas para cada user
      for (const notif of notifications) {
        try {
          await query(
            `UPDATE user_offers SET notified_at = NOW() WHERE user_id = $1`,
            [notif.userId]
          );
        } catch (err) {
          console.error(`   ⚠️  Error marcando notificado user ${notif.userId}:`, err.message);
        }
      }
    } else {
      // Individual: permite personalizar el body con el count
      let successCount = 0;
      let failureCount = 0;

      for (const notif of notifications) {
        try {
          const ok = await sendPushNotification(
            notif.token,
            {
              title: 'APD Ofertas',
              body: `Hay ${notif.count} oferta${notif.count > 1 ? 's' : ''} para vos el dia de hoy - ¡Abrí APD Ofertas!`,
            },
            {
              screen: 'Ofertas',
              badge: String(notif.count), // en data siempre string
            }
          );

          if (ok) {
            successCount++;
            await query(
              `UPDATE user_offers SET notified_at = NOW() WHERE user_id = $1`,
              [notif.userId]
            );
          } else {
            failureCount++;
          }
        } catch (err) {
          console.error(`   ❌ Error enviando a user ${notif.userId}:`, err.message);
          failureCount++;
        }
      }

      console.log(`✅ Notificaciones individuales completadas:`);
      console.log(`   Success: ${successCount}`);
      console.log(`   Failure: ${failureCount}`);

      if (successCount === 0) {
        throw new Error('Todas las notificaciones individuales fallaron');
      }
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`\n✅ Notificaciones completadas en ${duration}s`);
    console.log(`   Notificados: ${notified}`);
    console.log(`   Sin ofertas: ${skipped}`);

    return {
      success: true,
      notified,
      skipped,
      total: users.length,
      duration: parseFloat(duration),
    };
  } catch (error) {
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.error(`❌ Error en sendDailyNotifications (${duration}s):`, error.message);
    console.error(error.stack);
    // Importante: relanzar para que el proceso salga con código de error
    throw error;
  }
}

/**
 * Test function - enviar notificación de prueba a un usuario específico
 * Útil para testing manual
 */
async function sendTestNotification(userId) {
  console.log(`🧪 Enviando notificación de prueba a usuario ${userId}...`);

  // Asegurar Firebase inicializado
  try {
    initializeFirebase();
  } catch (e) {
    const msg = (e && e.message) || '';
    if (!/already exists|duplicate-app/i.test(msg)) {
      throw e;
    }
  }

  try {
    const userResult = await query(
      `SELECT id, email, nombre, device_token FROM users WHERE id = $1`,
      [userId]
    );

    if (userResult.rows.length === 0) {
      throw new Error(`Usuario ${userId} no encontrado`);
    }

    const user = userResult.rows[0];

    if (!user.device_token) {
      throw new Error(`Usuario ${user.id} no tiene device_token registrado`);
    }

    const ok = await sendPushNotification(
      user.device_token,
      {
        title: '🧪 Test APD Ofertas',
        body: `Hola ${user.nombre || 'docente'}, esta es una notificación de prueba`,
      },
      {
        screen: 'Home',
        test: 'true',
      }
    );

    if (ok) {
      console.log(`✅ Notificación de prueba enviada a ${user.email || user.id}`);
    } else {
      console.log(`❌ No se pudo enviar notificación a ${user.email || user.id}`);
    }

    return ok;
  } catch (error) {
    console.error('❌ Error en sendTestNotification:', error.message);
    throw error;
  }
}

module.exports = {
  sendDailyNotifications,
  sendTestNotification,
};
