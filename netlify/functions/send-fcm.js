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

  const candidates = [];
  const trimmed = raw.trim();
  if (trimmed) {
    candidates.push(trimmed);
  }

  const stripped = stripWrappingQuotes(trimmed);
  if (stripped && stripped !== trimmed) {
    candidates.push(stripped);
  }

  const withNormalizedNewlines = stripped.replace(/\\n/g, '\n');
  if (withNormalizedNewlines && withNormalizedNewlines !== stripped) {
    candidates.push(withNormalizedNewlines);
  }

  // Clean literal control characters (CR/LF) that may appear in env var
  // inline JSON with unescaped newlines in private_key field.
  const cleanedControl = stripped.replace(/[\r\n]/g, (ch) => ch === '\r' ? '' : '\\n');
  if (cleanedControl && cleanedControl !== stripped) {
    candidates.push(cleanedControl);
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
    } catch (_ignored) {
      // Try next candidate.
    }
  }

  try {
    const decoded = Buffer.from(trimmed, 'base64').toString('utf8');
    if (decoded && decoded.includes('"type"') && decoded.includes('"service_account"')) {
      return JSON.parse(decoded);
    }
  } catch (_ignored) {
    // Ignore invalid base64.
  }

  return null;
}

function ensureAdminApp() {
  if (admin.apps.length) {
    return admin.apps[0];
  }

  let rawEnv = process.env.FCM_SERVICE_ACCOUNT_JSON || process.env.FIREBASE_SERVICE_ACCOUNT || process.env.GOOGLE_APPLICATION_CREDENTIALS || '';
  let parsedServiceAccount = tryParseServiceAccount(rawEnv);

  // If the env var contains a file path (e.g. "./service_account.json"), read the file.
  if (!parsedServiceAccount && rawEnv) {
    try {
      const fs = require('fs');
      const path = require('path');
      const trimmedRaw = rawEnv.trim().replace(/^['"]|['"]$/g, '');
      if (trimmedRaw.match(/\.(json|pem)$/i) || trimmedRaw.startsWith('./') || trimmedRaw.startsWith('/')) {
        const resolvedPath = path.isAbsolute(trimmedRaw) ? trimmedRaw : path.join(process.cwd(), trimmedRaw);
        if (fs.existsSync(resolvedPath)) {
          rawEnv = fs.readFileSync(resolvedPath, 'utf8');
          parsedServiceAccount = tryParseServiceAccount(rawEnv);
        }
      }
    } catch (_ignored) {}
  }

  // Fallback: read from .env file in project root
  if (!parsedServiceAccount) {
    try {
      const fs = require('fs');
      const path = require('path');
      const envPath = path.join(process.cwd(), '.env');
      if (fs.existsSync(envPath)) {
        const envRaw = fs.readFileSync(envPath, 'utf8');
        const match = envRaw.match(/FCM_SERVICE_ACCOUNT_JSON=(.+)/);
        if (match) {
          let envValue = match[1].trim().replace(/^['"]|['"]$/g, '');
          // If the .env value is itself a file path, resolve it
          if (envValue.match(/\.(json|pem)$/i) || envValue.startsWith('./') || envValue.startsWith('/')) {
            const resolvedPath = path.isAbsolute(envValue) ? envValue : path.join(path.dirname(envPath), envValue);
            if (fs.existsSync(resolvedPath)) {
              envValue = fs.readFileSync(resolvedPath, 'utf8');
            }
          }
          const parsedFromEnvFile = tryParseServiceAccount(envValue);
          if (parsedFromEnvFile) {
            return admin.initializeApp({
              credential: admin.credential.cert(parsedFromEnvFile),
              projectId: parsedFromEnvFile.project_id || 'clusterg-1076f'
            });
          }
        }
      }
    } catch (_ignored) {
      // Ignore and fall back to the original error.
    }
  }

  // Last resort: try reading service_account.json from project root
  if (!parsedServiceAccount) {
    try {
      const fs = require('fs');
      const path = require('path');
      const saPath = path.join(process.cwd(), 'service_account.json');
      if (fs.existsSync(saPath)) {
        parsedServiceAccount = tryParseServiceAccount(fs.readFileSync(saPath, 'utf8'));
      }
    } catch (_ignored) {}
  }

  if (!parsedServiceAccount) {
    return { error: 'FCM credentials are not configured in Netlify environment variables.' };
  }

  try {
    return admin.initializeApp({
      credential: admin.credential.cert(parsedServiceAccount),
      projectId: parsedServiceAccount.project_id || 'clusterg-1076f'
    });
  } catch (error) {
    return { error: error.message || 'Failed to initialize Firebase Admin SDK.' };
  }
}

function normalizeTokens(tokens) {
  return Array.from(
    new Set(
      (tokens || [])
        .map((token) => (typeof token === 'string' ? token.trim() : token))
        .filter(Boolean)
    )
  );
}

// Kumpulkan token penerima. Prioritas: token yang dikirim client. Jika kosong,
// baca semua token dari koleksi Firestore `fcmTokens` via Admin SDK (bypass rules),
// supaya broadcast tetap jalan walau pengirim tidak terautentikasi (warga).
async function collectRecipientTokens(payload = {}) {
  const provided = normalizeTokens(payload.tokens || []);
  if (provided.length > 0) {
    return provided;
  }

  try {
    const snapshot = await admin.firestore().collection('fcmTokens').get();
    const tokens = [];
    snapshot.forEach((docSnap) => {
      const token = docSnap.data() && docSnap.data().token;
      if (typeof token === 'string' && token.trim()) {
        tokens.push(token.trim());
      }
    });
    return normalizeTokens(tokens);
  } catch (error) {
    console.error('Gagal membaca token FCM dari Firestore:', error);
    return [];
  }
}

function buildMessage(token, payload = {}) {
  const title = payload.title || 'SOS ClusterGuard';
  const body = payload.body || 'Ada laporan darurat baru.';
  const data = payload.data || {};
  const tag = data.tag || data.sosId || `clusterguard-sos-${Date.now()}`;

  const normalizedData = {
    type: data.type || 'sos_alert',
    sosId: data.sosId || '',
    tag,
    title,
    body,
    sound: 'default',
    vibrate: '900,300,900,300,1200',
    content_available: 'true',
    ...data
  };

  return {
    token,
    // Tanpa blok notification (data-only) agar di Android `onMessageReceived`
    // selalu dipanggil, termasuk saat app di background/terkunci, sehingga
    // sirine custom + full-screen alarm bisa aktif. Web (sw.js) tetap
    // menampilkan notifikasi dari data.title/data.body.
    data: normalizedData,
    android: {
      priority: 'high',
      ttl: 3600000,
      direct_boot_ok: true
      // Tanpa android.notification: blok itu membuat FCM memperlakukan pesan sebagai
      // notification message sehingga saat app di background SDK menampilkannya sendiri
      // dan onMessageReceived tidak dipanggil. Data-only murni -> selalu onMessageReceived
      // dan SosAlarmService (sirine + full-screen) yang menampilkan notifikasi.
    }
  };
}

exports.handler = async function (event) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ success: false, message: 'Method not allowed' }) };
  }

  try {
    const app = ensureAdminApp();
    if (app && app.error) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ success: false, message: app.error })
      };
    }

    const payload = JSON.parse(event.body || '{}');
    console.log('FCM request payload:', JSON.stringify({ title: payload.title, dataKeys: Object.keys(payload.data || {}) }));
    const tokens = await collectRecipientTokens(payload);
    console.log('FCM tokens collected:', tokens.length);
    if (!tokens.length) {
      return { statusCode: 400, headers, body: JSON.stringify({ success: false, message: 'No FCM token found in Firestore. Pastikan minimal 1 device sudah login dan menerima notifikasi.' }) };
    }

    const messages = tokens.map((token) => buildMessage(token, payload));
    const sendResults = await Promise.all(
      messages.map(async (message) => {
        try {
          const messageId = await admin.messaging().send(message);
          return { success: true, messageId };
        } catch (error) {
          const message = error && error.message ? error.message : String(error);
          console.error('FCM send failed', message);
          return { success: false, error: message };
        }
      })
    );

    const successCount = sendResults.filter((result) => result.success).length;
    const failureCount = sendResults.length - successCount;

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: successCount,
        failure: failureCount,
        tokenCount: tokens.length,
        responses: sendResults
      })
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ success: false, message: error.message })
    };
  }
};
