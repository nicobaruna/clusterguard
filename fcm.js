const admin = require('firebase-admin');

function ensureAdminApp() {
  if (admin.apps.length) {
    return admin.apps[0];
  }

  const serviceAccountJson = process.env.FCM_SERVICE_ACCOUNT_JSON || process.env.FIREBASE_SERVICE_ACCOUNT;
  if (serviceAccountJson) {
    const parsed = JSON.parse(serviceAccountJson);
    return admin.initializeApp({
      credential: admin.credential.cert(parsed),
      projectId: parsed.project_id
    });
  }

  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    return admin.initializeApp();
  }

  return null;
}

function buildFcmMessage({ token, title, body, data = {} }) {
  const tag = data.tag || data.sosId || 'clusterguard-sos';
  const link = data.url || '/';

  return {
    token,
    notification: {
      title,
      body
    },
    data: {
      type: data.type || 'sos_alert',
      sosId: data.sosId || '',
      ...data
    },
    webpush: {
      headers: {
        Urgency: 'high'
      },
      notification: {
        title,
        body,
        icon: '/icon-192.png',
        badge: '/icon-192.png',
        tag,
        renotify: true,
        requireInteraction: true
      },
      fcmOptions: {
        link
      }
    }
  };
}

async function sendFcmToTokens({ tokens, title, body, data = {} }) {
  if (!tokens || tokens.length === 0) {
    return { success: 0, failure: 0, responses: [] };
  }

  const app = ensureAdminApp();
  if (!app) {
    return {
      success: 0,
      failure: tokens.length,
      responses: [],
      error: 'FCM credentials are not configured. Set FCM_SERVICE_ACCOUNT_JSON or GOOGLE_APPLICATION_CREDENTIALS.'
    };
  }

  const messages = tokens.map((token) => buildFcmMessage({ token, title, body, data }));
  try {
    const response = await admin.messaging().sendEach(messages);
    return {
      success: response.successCount,
      failure: response.failureCount,
      responses: response.responses
    };
  } catch (error) {
    return {
      success: 0,
      failure: tokens.length,
      responses: [],
      error: error.message
    };
  }
}

module.exports = { buildFcmMessage, sendFcmToTokens };
