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
  const normalized = stripWrappingQuotes(raw);

  try {
    return JSON.parse(normalized);
  } catch (error) {
    try {
      const maybeString = JSON.parse(normalized);
      if (typeof maybeString === 'string') {
        return JSON.parse(maybeString);
      }
    } catch (_ignored) {
      // Continue to base64 decode.
    }

    try {
      const decoded = Buffer.from(normalized, 'base64').toString('utf8');
      if (decoded && decoded.includes('"type"') && decoded.includes('"service_account"')) {
        return JSON.parse(decoded);
      }
    } catch (_ignored) {
      // Ignore invalid base64.
    }
  }

  return null;
}

function ensureAdminApp() {
  if (admin.apps.length) {
    return admin.apps[0];
  }

  const rawEnv = process.env.FCM_SERVICE_ACCOUNT_JSON || process.env.FIREBASE_SERVICE_ACCOUNT;
  const parsedServiceAccount = tryParseServiceAccount(rawEnv);

  if (!parsedServiceAccount) {
    return null;
  }

  return admin.initializeApp({
    credential: admin.credential.cert(parsedServiceAccount),
    projectId: parsedServiceAccount.project_id
  });
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

function buildMessage(token, payload = {}) {
  const title = payload.title || 'SOS ClusterGuard';
  const body = payload.body || 'Ada laporan darurat baru.';
  const data = payload.data || {};
  const tag = data.tag || data.sosId || `clusterguard-sos-${Date.now()}`;
  const vibratePattern = [900, 300, 900, 300, 1200];

  return {
    token,
    // Top-level notification sengaja dihilangkan supaya Android memproses ini sebagai data message,
    // lalu native service sendiri yang menampilkan notifikasi + memutar alarm loop sampai user klik.
    data: {
      type: data.type || 'sos_alert',
      sosId: data.sosId || '',
      tag,
      sound: 'default',
      vibrate: JSON.stringify(vibratePattern),
      ...data
    },
    webpush: {
      headers: {
        Urgency: 'high',
        TTL: '86400' //simpan untuk 24jam
      },
      notification: {
        title,
        body,
        icon: '/icon-192.png',
        badge: '/icon-192.png',
        tag,
        silent: false,
        vibrate: vibratePattern,
        timestamp: Date.now(),
        renotify: true,
        requireInteraction: true,
        data: { url: data.url || '/' }
      }
    },
    android: {
      // Hybrid Android message: notifikasi sistem tetap diposting saat app idle/Doze,
      // sementara data payload tetap ada untuk logic native saat service aktif.
      priority: 'high',
      ttl: 86400 * 1000,
      notification: {
        title,
        body,
        channelId: 'sos_alerts_v2',
        sound: 'alarm_sos',
        tag,
        visibility: 'public',
        notificationPriority: 'PRIORITY_MAX',
        defaultVibrateTimings: true
      }
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
    if (!app) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ success: false, message: 'FCM credentials are not configured in Netlify environment variables.' })
      };
    }

    const payload = JSON.parse(event.body || '{}');
    const tokens = normalizeTokens(payload.tokens || []);
    if (!tokens.length) {
      return { statusCode: 400, headers, body: JSON.stringify({ success: false, message: 'No FCM token provided.' }) };
    }

    const messages = tokens.map((token) => buildMessage(token, payload));
    const response = await admin.messaging().sendEach(messages);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: response.successCount,
        failure: response.failureCount,
        responses: response.responses
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
