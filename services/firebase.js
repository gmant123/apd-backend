// src/services/firebase.js
const admin = require('firebase-admin');

let _appInited = false;

// [change] Normalizador seguro para la private key (evita \n rotos / comillas)
function normalizePrivateKey(pk) {
  return String(pk)
    .replace(/^"+|"+$/g, '') // quita comillas dobles al inicio/fin si las hay
    .replace(/\\n/g, '\n')   // convierte secuencias \n en saltos reales
    .replace(/\r/g, '');     // limpia \r (Windows)
}

function initializeFirebase() {
  if (_appInited && admin.apps.length) return admin.app();

  // Opción A: TODO el JSON en Base64 (recomendada)
  const svcB64 = process.env.FIREBASE_SERVICE_ACCOUNT_B64;

  if (svcB64) {
    // [change] Validación robusta del B64/JSON y de campos mínimos
    let serviceAccount;
    try {
      const json = Buffer.from(svcB64, 'base64').toString('utf8');
      serviceAccount = JSON.parse(json);
    } catch (e) {
      throw new Error('[Firebase] FIREBASE_SERVICE_ACCOUNT_B64 inválido: no es JSON válido');
    }

    const required = ['project_id', 'client_email', 'private_key'];
    const missing = required.filter((k) => !serviceAccount[k]);
    if (missing.length) {
      throw new Error(`[Firebase] JSON B64 incompleto. Faltan: ${missing.join(', ')}`);
    }

    serviceAccount.private_key = normalizePrivateKey(serviceAccount.private_key);

    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
    _appInited = true;
    console.log('✓ Firebase Admin inicializado (B64)');
    return admin.app();
  }

  // Opción B: 3 variables sueltas (PROJECT_ID, CLIENT_EMAIL, PRIVATE_KEY)
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  let privateKey = process.env.FIREBASE_PRIVATE_KEY;

  // [change] Mensaje explícito listando exactamente qué falta
  const missingVars = [];
  if (!projectId) missingVars.push('FIREBASE_PROJECT_ID');
  if (!clientEmail) missingVars.push('FIREBASE_CLIENT_EMAIL');
  if (!privateKey) missingVars.push('FIREBASE_PRIVATE_KEY');

  if (missingVars.length) {
    throw new Error(
      `[Firebase] Faltan credenciales en variables de entorno. ` +
      `Definí FIREBASE_SERVICE_ACCOUNT_B64 o ${missingVars.join(', ')}`
    );
  }

  privateKey = normalizePrivateKey(privateKey);

  admin.initializeApp({
    credential: admin.credential.cert({
      projectId,
      clientEmail,
      privateKey,
    }),
  });
  _appInited = true;
  console.log('✓ Firebase Admin inicializado (vars sueltas)');
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
