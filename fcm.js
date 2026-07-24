const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

function stripWrappingQuotes(value) {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function tryParseJson(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const normalized = stripWrappingQuotes(raw);

  try {
    return JSON.parse(normalized);
  } catch (error) {
    // Handle env values accidentally double-encoded as JSON string.
    try {
      const decodedString = JSON.parse(normalized);
      if (typeof decodedString === 'string') {
        return JSON.parse(decodedString);
      }
    } catch (_error) {
      // continue to next strategy
    }

    // Handle base64-encoded JSON payload.
    try {
      const asUtf8 = Buffer.from(normalized, 'base64').toString('utf8');
      if (asUtf8 && asUtf8.includes('"type"') && asUtf8.includes('"service_account"')) {
        return JSON.parse(asUtf8);
      }
    } catch (_error) {
      // continue to next strategy
    }
  }

  return null;
}

function readServiceAccountFromEnv() {
  const raw = process.env.FCM_SERVICE_ACCOUNT_JSON || process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) {
    return null;
  }

  const trimmed = String(raw).trim();
  if (!trimmed) {
    return null;
  }

  try {
    const fromJson = tryParseJson(trimmed);
    if (fromJson) {
      return fromJson;
    }

    const resolvedPath = path.isAbsolute(trimmed) ? trimmed : path.resolve(process.cwd(), trimmed);
    if (!fs.existsSync(resolvedPath)) {
      return null;
    }

    const fileContent = fs.readFileSync(resolvedPath, 'utf8');
    return tryParseJson(fileContent);
  } catch (error) {
    console.warn('FCM service account env tidak valid:', error.message);
    return null;
  }
}

function readLocalServiceAccountFallback() {
  try {
    const fallbackPath = path.resolve(process.cwd(), 'serviceAccountKey.json');
    if (!fs.existsSync(fallbackPath)) {
      return null;
    }
    const fileContent = fs.readFileSync(fallbackPath, 'utf8');
    return tryParseJson(fileContent);
  } catch (error) {
    console.warn('Fallback serviceAccountKey.json tidak bisa dibaca:', error.message);
    return null;
  }
}

function ensureAdminApp() {
  if (admin.apps.length) {
    return admin.apps[0];
  }

  const parsed = readServiceAccountFromEnv() || readLocalServiceAccountFallback();
  if (parsed) {
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
  const normalizedTokens = Array.from(
    new Set(
      (tokens || [])
        .map((token) => (typeof token === 'string' ? token.trim() : token))
        .filter(Boolean)
    )
  );
  if (normalizedTokens.length === 0) {
    return { success: 0, failure: 0, responses: [] };
  }

  const app = ensureAdminApp();
  if (!app) {
    return {
      success: 0,
      failure: normalizedTokens.length,
      responses: [],
      error: 'FCM credentials are not configured. Set FCM_SERVICE_ACCOUNT_JSON or GOOGLE_APPLICATION_CREDENTIALS.'
    };
  }

  const messages = normalizedTokens.map((token) => buildFcmMessage({ token, title, body, data }));
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
      failure: normalizedTokens.length,
      responses: [],
      error: error.message
    };
  }
}

module.exports = { buildFcmMessage, sendFcmToTokens };
