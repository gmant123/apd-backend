/**
 * Job de Notificaciones Diarias
 * Se ejecuta a las 21:00 hs (configurado en scheduler.js)
 * Envía push notification a usuarios con ofertas nuevas
 */

const { query } = require('../src/config/database');
const { sendBatchNotifications, sendPushNotification } = require('../services/firebase');

/**
 * Enviar notificaciones diarias a las 21:00
 * - Obtiene usuarios activos con notif_diaria = true
 * - Cuenta ofertas nuevas para cada usuario
 * - Envía push notification si hay ofertas nuevas
 */
async function sendDailyNotifications() {
  console.log('🔔 Iniciando envío de notificaciones diarias...');
  const startTime = Date.now();

  try {
    // 1. Obtener usuarios activos con notificaciones habilitadas
    const usersResult = await query(`
      SELECT 
        u.id,
        u.dni,
        u.nombre,
        u.device_token,
        up.notif_diaria
      FROM users u
      LEFT JOIN user_preferences up ON u.id = up.user_id
      WHERE 
        u.is_active = true 
        AND u.device_token IS NOT NULL 
        AND u.device_token != ''
        AND (up.notif_diaria IS NULL OR up.notif_diaria = true)
    `);

    const users = usersResult.rows;
    console.log(`👥 Usuarios con notificaciones activas: ${users.length}`);

    if (users.length === 0) {
      console.log('⚠️  No hay usuarios para notificar');
      return { success: true, notified: 0, skipped: 0 };
    }

    let notified = 0;
    let skipped = 0;
    const notifications = []; // Para batch notifications

    // 2. Para cada usuario, contar ofertas nuevas
    for (const user of users) {
      try {
        const offersResult = await query(`
          SELECT COUNT(*) as count
          FROM user_offers
          WHERE user_id = $1 AND is_new = true
        `, [user.id]);

        const newOffersCount = parseInt(offersResult.rows[0].count) || 0;

        if (newOffersCount === 0) {
          console.log(`   ⏭️  Usuario ${user.dni} (${user.nombre}): sin ofertas nuevas`);
          skipped++;
          continue;
        }

        // Agregar a lista de notificaciones
        notifications.push({
          token: user.device_token,
          userId: user.id,
          userName: user.nombre,
          count: newOffersCount,
        });

        console.log(`   ✅ Usuario ${user.dni} (${user.nombre}): ${newOffersCount} oferta${newOffersCount > 1 ? 's' : ''} nueva${newOffersCount > 1 ? 's' : ''}`);
        notified++;

      } catch (error) {
        console.error(`   ❌ Error procesando usuario ${user.dni}:`, error.message);
        skipped++;
      }
    }

    // 3. Enviar notificaciones
    if (notifications.length === 0) {
      console.log('⚠️  No hay notificaciones para enviar');
      return { success: true, notified: 0, skipped: users.length };
    }

    console.log(`\n📤 Enviando ${notifications.length} notificaciones...`);

    // Opción 1: Batch (más eficiente para muchos usuarios)
    if (notifications.length > 5) {
      const tokens = notifications.map(n => n.token);
      
      // Título y body genérico (Firebase no permite personalizar por token en batch)
      const result = await sendBatchNotifications(
        tokens,
        {
          title: 'Nuevas ofertas APD',
          body: 'Tenés ofertas nuevas disponibles. ¡Revisalas ahora!',
        },
        {
          screen: 'Ofertas',
          badge: '1', // String porque data solo acepta strings
        }
      );

      console.log(`✅ Notificaciones batch enviadas:`);
      console.log(`   Success: ${result.success}`);
      console.log(`   Failure: ${result.failure}`);

      // Marcar como notificadas
      for (const notif of notifications) {
        try {
          await query(`
            UPDATE user_offers
            SET notified_at = NOW()
            WHERE user_id = $1 AND is_new = true
          `, [notif.userId]);
        } catch (error) {
          console.error(`   ⚠️  Error marcando como notificado usuario ${notif.userId}`);
        }
      }

    } else {
      // Opción 2: Individual (mejor para pocos usuarios, mensaje personalizado)
      let successCount = 0;
      let failureCount = 0;

      for (const notif of notifications) {
        try {
          const success = await sendPushNotification(
            notif.token,
            {
              title: 'Nuevas ofertas APD',
              body: `Tenés ${notif.count} oferta${notif.count > 1 ? 's' : ''} nueva${notif.count > 1 ? 's' : ''}`,
            },
            {
              screen: 'Ofertas',
              badge: String(notif.count),
            }
          );

          if (success) {
            successCount++;
            
            // Marcar como notificadas
            await query(`
              UPDATE user_offers
              SET notified_at = NOW()
              WHERE user_id = $1 AND is_new = true
            `, [notif.userId]);
          } else {
            failureCount++;
          }

        } catch (error) {
          console.error(`   ❌ Error enviando a usuario ${notif.userId}:`, error.message);
          failureCount++;
        }
      }

      console.log(`✅ Notificaciones individuales completadas:`);
      console.log(`   Success: ${successCount}`);
      console.log(`   Failure: ${failureCount}`);
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`\n✅ Notificaciones completadas en ${duration}s`);
    console.log(`   Notificados: ${notified}`);
    console.log(`   Sin ofertas: ${skipped}`);

    return {
      success: true,
      notified: notified,
      skipped: skipped,
      total: users.length,
      duration: parseFloat(duration),
    };

  } catch (error) {
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.error(`❌ Error en sendDailyNotifications (${duration}s):`, error.message);
    console.error(error.stack);
    
    return {
      success: false,
      error: error.message,
      duration: parseFloat(duration),
    };
  }
}

/**
 * Test function - enviar notificación de prueba a un usuario específico
 * Útil para testing manual
 */
async function sendTestNotification(userId) {
  console.log(`🧪 Enviando notificación de prueba a usuario ${userId}...`);

  try {
    const userResult = await query(`
      SELECT id, dni, nombre, device_token
      FROM users
      WHERE id = $1
    `, [userId]);

    if (userResult.rows.length === 0) {
      throw new Error(`Usuario ${userId} no encontrado`);
    }

    const user = userResult.rows[0];

    if (!user.device_token) {
      throw new Error(`Usuario ${user.dni} no tiene device_token registrado`);
    }

    const success = await sendPushNotification(
      user.device_token,
      {
        title: '🧪 Test APD Ofertas',
        body: `Hola ${user.nombre}, esta es una notificación de prueba`,
      },
      {
        screen: 'Home',
        test: 'true',
      }
    );

    if (success) {
      console.log(`✅ Notificación de prueba enviada a ${user.nombre} (${user.dni})`);
    } else {
      console.log(`❌ No se pudo enviar notificación a ${user.nombre}`);
    }

    return success;

  } catch (error) {
    console.error('❌ Error en sendTestNotification:', error.message);
    throw error;
  }
}

module.exports = {
  sendDailyNotifications,
  sendTestNotification,
};
