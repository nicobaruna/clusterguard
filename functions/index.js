const functions = require('firebase-functions');
const admin = require('firebase-admin');

admin.initializeApp();

function normalizeTokenEntries(entries = []) {
  const tokenMap = new Map();
  (entries || []).forEach((entry) => {
    const token = typeof entry?.token === 'string' ? entry.token.trim() : '';
    if (!token) return;
    const existing = tokenMap.get(token);
    if (existing) {
      if (entry.docId) {
        existing.docIds.push(entry.docId);
      }
      return;
    }
    tokenMap.set(token, {
      token,
      docIds: entry?.docId ? [entry.docId] : []
    });
  });
  return [...tokenMap.values()];
}

async function sendNotificationToTokenEntries(entries, title, body, tag = 'clusterguard-sos', url = '/') {
  const uniqueEntries = normalizeTokenEntries(entries);
  const uniqueTokens = uniqueEntries.map((entry) => entry.token);
  if (!uniqueTokens.length) {
    return { success: false, message: 'No FCM token available.' };
  }

  const message = {
    notification: {
      title: title || 'SOS ClusterGuard',
      body: body || 'Ada laporan darurat baru.'
    },
    data: {
      type: 'sos_alert',
      title: title || 'SOS ClusterGuard',
      body: body || 'Ada laporan darurat baru.',
      tag,
      url
    },
    webpush: {
      headers: {
        Urgency: 'high',
        TTL: '60'
      },
      notification: {
        title: title || 'SOS ClusterGuard',
        body: body || 'Ada laporan darurat baru.',
        icon: '/icon-192.png',
        badge: '/icon-192.png',
        tag,
        renotify: true,
        requireInteraction: true,
        data: { url }
      }
    },
    tokens: uniqueTokens
  };

  const response = await admin.messaging().sendEachForMulticast(message);

  const invalidDocIds = [];
  response.responses.forEach((item, index) => {
    if (item.success) return;
    const code = item?.error?.code || '';
    if (code === 'messaging/invalid-registration-token' || code === 'messaging/registration-token-not-registered') {
      invalidDocIds.push(...(uniqueEntries[index]?.docIds || []));
    }
  });

  if (invalidDocIds.length) {
    const uniqueDocIds = Array.from(new Set(invalidDocIds));
    await Promise.all(uniqueDocIds.map((docId) => admin.firestore().collection('fcmTokens').doc(docId).delete().catch(() => null)));
  }

  return {
    success: true,
    response,
    tokenStats: {
      requested: uniqueTokens.length,
      removedInvalid: invalidDocIds.length
    }
  };
}

async function loadTokenEntriesFromFirestore() {
  const tokensSnap = await admin.firestore().collection('fcmTokens').get();
  return tokensSnap.docs.map((docSnap) => ({
    docId: docSnap.id,
    token: docSnap.data()?.token
  }));
}

exports.sendSosNotification = functions.https.onRequest(async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ success: false, message: 'Method not allowed.' });
    return;
  }

  const { title, body, token, tag = 'clusterguard-sos', url = '/', tokens: extraTokens = [] } = req.body || {};
  const explicitEntries = [token, ...extraTokens]
    .filter(Boolean)
    .map((raw, index) => ({ token: raw, docId: `request_${index}` }));
  const targetEntries = [...explicitEntries];

  if (!targetEntries.length) {
    const storedEntries = await loadTokenEntriesFromFirestore();
    targetEntries.push(...storedEntries);
  }

  if (!targetEntries.length) {
    res.status(400).json({ success: false, message: 'No FCM token available.' });
    return;
  }

  try {
    const result = await sendNotificationToTokenEntries(targetEntries, title, body, tag, url);
    res.status(200).json(result);
  } catch (error) {
    console.error('FCM send failed:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

exports.sendSosPush = functions.firestore.document('sos/{sosId}').onCreate(async (snap, context) => {
  const data = snap.data() || {};
  if (data.status && data.status !== 'Mencari Bantuan') {
    return null;
  }

  const title = `SOS ${data.jenis_sos || 'Darurat'}`;
  const body = `${data.nama_pelapor || 'Warga'} di ${data.no_rumah || '-'}`;

  const tokenEntries = await loadTokenEntriesFromFirestore();
  if (!tokenEntries.length) {
    return null;
  }

  return sendNotificationToTokenEntries(tokenEntries, title, body, `clusterguard-sos-${context.params.sosId}`, '/');
});
