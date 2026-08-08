const admin = require('firebase-admin');

function stripWrappingQuotes(value) {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function tryParseServiceAccount(raw) {
  if (!raw || typeof raw !== 'string') return null;

  const trimmed = raw.trim();
  const candidates = [trimmed];
  const stripped = stripWrappingQuotes(trimmed);
  if (stripped && stripped !== trimmed) {
    candidates.push(stripped);
  }

  const normalized = stripped.replace(/\\n/g, '\n');
  if (normalized && normalized !== stripped) {
    candidates.push(normalized);
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object') {
        return parsed;
      }
      if (typeof parsed === 'string') {
        const nested = tryParseServiceAccount(parsed);
        if (nested) {
          return nested;
        }
      }
    } catch (_error) {
      // ignore and try next candidate
    }
  }

  try {
    const decoded = Buffer.from(trimmed, 'base64').toString('utf8');
    if (decoded && decoded.includes('"type"') && decoded.includes('"service_account"')) {
      return JSON.parse(decoded);
    }
  } catch (_error) {
    // ignore and fall back
  }

  return null;
}

function ensureAdminApp() {
  if (admin.apps.length) {
    return admin.apps[0];
  }

  const serviceAccountJson = process.env.FCM_SERVICE_ACCOUNT_JSON || process.env.FIREBASE_SERVICE_ACCOUNT;
  const parsed = tryParseServiceAccount(serviceAccountJson);
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
