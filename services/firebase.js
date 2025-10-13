// src/services/firebase.js
const admin = require('firebase-admin');

let _appInited = false;

function initializeFirebase() {
  if (_appInited && admin.apps.length) return admin.app();

  // Opción A: TODO el JSON en Base64 (recomendado)
  const svcB64 = process.env.FIREBASE_SERVICE_ACCOUNT_B64;

  if (svcB64) {
    const json = Buffer.from(svcB64, 'base64').toString('utf8');
    const serviceAccount = JSON.parse(json);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
    _appInited = true;
    console.log('✅ Firebase Admin SDK inicializado (B64 JSON)');
    return admin.app();
  }

  // Opción B: 3 variables sueltas (PROJECT_ID, CLIENT_EMAIL, PRIVATE_KEY)
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  let privateKey = process.env.FIREBASE_PRIVATE_KEY;

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error('Faltan variables de Firebase (usa FIREBASE_SERVICE_ACCOUNT_B64 o las 3 sueltas)');
  }

  // Normalizar clave: quitar comillas accidentales y convertir \n en saltos reales
  privateKey = privateKey
    .replace(/^"+|"+$/g, '')      // quita comillas dobles al inicio/fin si las hay
    .replace(/\\n/g, '\n')        // convierte secuencias \n en saltos reales
    .replace(/\r/g, '');          // limpia \r por si vienen de Windows

  admin.initializeApp({
    credential: admin.credential.cert({
      projectId,
      clientEmail,
      privateKey,
    }),
  });
  _appInited = true;
  console.log('✅ Firebase Admin SDK inicializado (vars sueltas)');
  return admin.app();
}

async function sendPushNotification(token, notification, data) {
  initializeFirebase();
  const message = {
    token,
    notification,
    data: data || {},
    android: { priority: 'high', notification: { sound: 'default' } },
  };
  try {
    const res = await admin.messaging().send(message);
    return !!res;
  } catch (e) {
    console.error('❌ Error enviando push notification:', e.message);
    throw e;
  }
}

async function sendBatchNotifications(tokens, notification, data) {
  initializeFirebase();
  const message = {
    tokens,
    notification,
    data: data || {},
    android: { priority: 'high', notification: { sound: 'default' } },
  };
  try {
    const res = await admin.messaging().sendEachForMulticast(message);
    return { success: res.successCount, failure: res.failureCount, responses: res.responses };
  } catch (e) {
    console.error('❌ Error en batch notifications:', e.message);
    throw e;
  }
}

module.exports = { initializeFirebase, sendPushNotification, sendBatchNotifications };
