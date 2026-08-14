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
  if (stripped && stripped !== trimmed) candidates.push(stripped);
  const normalized = stripped.replace(/\\n/g, '\n');
  if (normalized && normalized !== stripped) candidates.push(normalized);

  // Also try cleaning literal control characters (CR/LF) that may appear
  // when env var contains inline JSON with unescaped newlines in private_key.
  const cleanedControl = stripped.replace(/[\r\n]/g, (ch) => ch === '\r' ? '' : '\\n');
  if (cleanedControl && cleanedControl !== stripped) candidates.push(cleanedControl);

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object') return parsed;
    } catch (_error) {}
  }

  try {
    const decoded = Buffer.from(trimmed, 'base64').toString('utf8');
    if (decoded && decoded.includes('"type"') && decoded.includes('"service_account"')) {
      return JSON.parse(decoded);
    }
  } catch (_error) {}

  return null;
}

function ensureAdminApp() {
  if (admin.apps.length) {
    return admin.apps[0];
  }

  let raw = process.env.FCM_SERVICE_ACCOUNT_JSON || process.env.FIREBASE_SERVICE_ACCOUNT;

  // If raw contains a file path (e.g. "./service_account.json"), read the file.
  if (raw) {
    try {
      const fs = require('fs');
      const pathMod = require('path');
      const trimmedRaw = raw.trim().replace(/^['"]|['"]$/g, '');
      if (trimmedRaw.match(/\.(json|pem)$/i) || trimmedRaw.startsWith('./') || trimmedRaw.startsWith('/')) {
        const resolvedPath = pathMod.isAbsolute(trimmedRaw) ? trimmedRaw : pathMod.join(__dirname, trimmedRaw);
        if (fs.existsSync(resolvedPath)) {
          raw = fs.readFileSync(resolvedPath, 'utf8');
        }
      }
    } catch (_ignored) {}
  }

  // Fallback: read from .env file
  if (!raw) {
    try {
      const fs = require('fs');
      const pathMod = require('path');
      const envPath = pathMod.join(__dirname, '.env');
      if (fs.existsSync(envPath)) {
        const envRaw = fs.readFileSync(envPath, 'utf8');
        const match = envRaw.match(/FCM_SERVICE_ACCOUNT_JSON=(.+)/);
        if (match) {
          raw = match[1].trim().replace(/^['"]|['"]$/g, '');
          // If the .env value is a file path, resolve it relative to the .env location
          if (raw.match(/\.(json|pem)$/i) || raw.startsWith('./') || raw.startsWith('/')) {
            const resolvedPath = pathMod.isAbsolute(raw) ? raw : pathMod.join(pathMod.dirname(envPath), raw);
            if (fs.existsSync(resolvedPath)) {
              raw = fs.readFileSync(resolvedPath, 'utf8');
            }
          }
        }
      }
    } catch (_ignored) {}
  }

  let parsed = tryParseServiceAccount(raw);

  // Last resort: try reading service_account.json from project root
  if (!parsed) {
    try {
      const fs = require('fs');
      const pathMod = require('path');
      const saPath = pathMod.join(__dirname, 'service_account.json');
      if (fs.existsSync(saPath)) {
        parsed = tryParseServiceAccount(fs.readFileSync(saPath, 'utf8'));
      }
    } catch (_ignored) {}
  }

  if (parsed) {
    return admin.initializeApp({
      credential: admin.credential.cert(parsed),
      projectId: parsed.project_id || 'clusterg-1076f'
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
    // Data-only: tanpa blok notification agar `onMessageReceived` di Android
    // selalu dipanggil walau app di background (sirine custom tetap aktif).
    data: {
      type: data.type || 'sos_alert',
      sosId: data.sosId || '',
      title,
      body,
      ...data
    },
    android: {
      priority: 'high',
      // Tanpa android.notification: blok itu membuat FCM memperlakukan pesan sebagai
      // notification message sehingga saat app di background SDK menampilkannya sendiri
      // dan onMessageReceived tidak dipanggil. Data-only murni -> selalu onMessageReceived.
      ttl: 3600000
    }
  };
}

async function collectTokensFromFirestore() {
  const app = ensureAdminApp();
  if (!app) return [];

  try {
    const snapshot = await admin.firestore().collection('fcmTokens').get();
    const tokens = [];
    snapshot.forEach((docSnap) => {
      const token = docSnap.data() && docSnap.data().token;
      if (typeof token === 'string' && token.trim()) {
        tokens.push(token.trim());
      }
    });
    return Array.from(new Set(tokens));
  } catch (error) {
    console.error('Gagal membaca token FCM dari Firestore:', error);
    return [];
  }
}

async function sendFcmToTokens({ tokens, title, body, data = {} }) {
  // Verify credentials first so we can report a clear error.
  const app = ensureAdminApp();
  if (!app) {
    return {
      success: 0,
      failure: 0,
      responses: [],
      error: 'FCM credentials are not configured. Set FCM_SERVICE_ACCOUNT_JSON (inline JSON or file path to service_account.json) or GOOGLE_APPLICATION_CREDENTIALS.'
    };
  }

  let recipientTokens = Array.isArray(tokens) ? tokens : [];
  if (recipientTokens.length === 0) {
    // Broadcast server-side: ambil semua token dari Firestore via Admin SDK (bypass rules).
    recipientTokens = await collectTokensFromFirestore();
  }

  if (!recipientTokens || recipientTokens.length === 0) {
    return { success: 0, failure: 0, responses: [], error: 'Tidak ada token FCM penerima di Firestore.' };
  }

  const messages = recipientTokens.map((token) => buildFcmMessage({ token, title, body, data }));
  try {
    const response = await admin.messaging().sendEach(messages);
    return {
      success: response.successCount,
      failure: response.failureCount,
      tokenCount: recipientTokens.length,
      responses: response.responses
    };
  } catch (error) {
    return {
      success: 0,
      failure: recipientTokens.length,
      responses: [],
      error: error.message
    };
  }
}

module.exports = { buildFcmMessage, sendFcmToTokens };
