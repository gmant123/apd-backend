/**
 * Firebase Cloud Messaging Service
 * Maneja envío de push notifications a usuarios
 */

const admin = require('firebase-admin');

let firebaseInitialized = false;

/**
 * Inicializar Firebase Admin SDK
 * Se ejecuta una sola vez al arrancar el servidor
 */
function initializeFirebase() {
  if (firebaseInitialized) {
    console.log('⚠️  Firebase ya estaba inicializado');
    return;
  }

  try {
    // Verificar que existan las variables de entorno
    const projectId = process.env.FIREBASE_PROJECT_ID;
    const privateKey = process.env.FIREBASE_PRIVATE_KEY;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;

    if (!projectId || !privateKey || !clientEmail) {
      console.error('❌ Faltan variables de entorno de Firebase:');
      console.error('   FIREBASE_PROJECT_ID:', projectId ? '✅' : '❌');
      console.error('   FIREBASE_PRIVATE_KEY:', privateKey ? '✅' : '❌');
      console.error('   FIREBASE_CLIENT_EMAIL:', clientEmail ? '✅' : '❌');
      throw new Error('Variables de Firebase no configuradas');
    }

    // Inicializar con credenciales de service account
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: projectId,
        privateKey: privateKey.replace(/\\n/g, '\n'), // Fix saltos de línea
        clientEmail: clientEmail,
      }),
    });

    firebaseInitialized = true;
    console.log('✅ Firebase Admin SDK inicializado correctamente');
    console.log(`   Project: ${projectId}`);

  } catch (error) {
    console.error('❌ Error inicializando Firebase:', error.message);
    throw error;
  }
}

/**
 * Enviar notificación push a un dispositivo
 * @param {string} deviceToken - Token del dispositivo (device_token en DB)
 * @param {object} notification - { title, body }
 * @param {object} data - Data adicional (opcional)
 * @returns {Promise<boolean>} - true si se envió exitosamente
 */
async function sendPushNotification(deviceToken, notification, data = {}) {
  if (!firebaseInitialized) {
    throw new Error('Firebase no está inicializado');
  }

  if (!deviceToken) {
    console.error('⚠️  No se proporcionó device token');
    return false;
  }

  try {
    const message = {
      token: deviceToken,
      notification: {
        title: notification.title,
        body: notification.body,
      },
      data: data,
      android: {
        priority: 'high',
        notification: {
          sound: 'default',
          channelId: 'default',
        },
      },
      apns: {
        payload: {
          aps: {
            badge: data.badge || 0,
            sound: 'default',
          },
        },
      },
    };

    const response = await admin.messaging().send(message);
    console.log(`✅ Notificación enviada exitosamente: ${response}`);
    return true;

  } catch (error) {
    if (error.code === 'messaging/invalid-registration-token' ||
        error.code === 'messaging/registration-token-not-registered') {
      console.warn(`⚠️  Token inválido o no registrado: ${deviceToken.substring(0, 20)}...`);
      return false;
    }
    
    console.error('❌ Error enviando push notification:', error.message);
    throw error;
  }
}

/**
 * Enviar notificación a múltiples dispositivos (batch)
 * @param {Array<string>} deviceTokens - Array de tokens
 * @param {object} notification - { title, body }
 * @param {object} data - Data adicional (opcional)
 * @returns {Promise<object>} - { success: number, failure: number }
 */
async function sendBatchNotifications(deviceTokens, notification, data = {}) {
  if (!firebaseInitialized) {
    throw new Error('Firebase no está inicializado');
  }

  if (!deviceTokens || deviceTokens.length === 0) {
    console.warn('⚠️  No hay tokens para enviar notificaciones');
    return { success: 0, failure: 0 };
  }

  // Filtrar tokens válidos (no null, no undefined, no vacíos)
  const validTokens = deviceTokens.filter(token => token && token.trim() !== '');

  if (validTokens.length === 0) {
    console.warn('⚠️  No hay tokens válidos después de filtrar');
    return { success: 0, failure: 0 };
  }

  try {
    const message = {
      notification: {
        title: notification.title,
        body: notification.body,
      },
      data: data,
      android: {
        priority: 'high',
        notification: {
          sound: 'default',
          channelId: 'default',
        },
      },
      apns: {
        payload: {
          aps: {
            badge: data.badge || 0,
            sound: 'default',
          },
        },
      },
    };

    // Firebase permite enviar hasta 500 tokens por batch
    const batchSize = 500;
    let totalSuccess = 0;
    let totalFailure = 0;

    for (let i = 0; i < validTokens.length; i += batchSize) {
      const batch = validTokens.slice(i, i + batchSize);

      const response = await admin.messaging().sendEachForMulticast({
        tokens: batch,
        ...message,
      });

      totalSuccess += response.successCount;
      totalFailure += response.failureCount;

      console.log(`   Batch ${Math.floor(i / batchSize) + 1}: ${response.successCount}/${batch.length} enviadas`);

      // Log errores específicos
      if (response.failureCount > 0) {
        response.responses.forEach((resp, idx) => {
          if (!resp.success) {
            console.warn(`   ⚠️  Token ${batch[idx].substring(0, 20)}... falló: ${resp.error?.code}`);
          }
        });
      }
    }

    console.log(`✅ Notificaciones batch completadas:`);
    console.log(`   Success: ${totalSuccess}/${validTokens.length}`);
    console.log(`   Failure: ${totalFailure}/${validTokens.length}`);

    return {
      success: totalSuccess,
      failure: totalFailure,
      total: validTokens.length,
    };

  } catch (error) {
    console.error('❌ Error enviando notificaciones batch:', error.message);
    throw error;
  }
}

module.exports = {
  initializeFirebase,
  sendPushNotification,
  sendBatchNotifications,
};
