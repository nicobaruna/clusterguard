const functions = require('firebase-functions');
const admin = require('firebase-admin');

admin.initializeApp();
async function sendNotificationToTokens(tokens, title, body, tag = 'clusterguard-sos', url = '/') {
  const uniqueTokens = Array.from(new Set((tokens || []).filter(Boolean)));
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
        Urgency: 'high'
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
  return { success: true, response };
}
exports.sendSosNotification = functions.https.onRequest(async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ success: false, message: 'Method not allowed.' });
    return;
  }

  const { title, body, token, tag = 'clusterguard-sos', url = '/', tokens: extraTokens = [] } = req.body || {};
  const targetTokens = [token, ...extraTokens].filter(Boolean);

  if (!targetTokens.length) {
    const tokensSnap = await admin.firestore().collection('fcmTokens').get();
    targetTokens.push(...tokensSnap.docs.map((doc) => doc.data()?.token).filter(Boolean));
  }

  if (!targetTokens.length) {
    res.status(400).json({ success: false, message: 'No FCM token available.' });
    return;
  }

  try {
    const result = await sendNotificationToTokens(targetTokens, title, body, tag, url);
    res.status(200).json(result);
  } catch (error) {
    console.error('FCM send failed:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

exports.sendSosPush = functions.firestore.document('sos/{sosId}').onCreate(async (snap, context) => {
  const data = snap.data() || {};
  const title = `SOS ${data.jenis_sos || 'Darurat'}`;
  const body = `${data.nama_pelapor || 'Warga'} di ${data.no_rumah || '-'}`;

  const tokensSnap = await admin.firestore().collection('fcmTokens').get();
  const tokens = tokensSnap.docs.map((doc) => doc.data()?.token).filter(Boolean);
  if (!tokens.length) {
    return null;
  }

  return sendNotificationToTokens(tokens, title, body, `clusterguard-sos-${context.params.sosId}`, '/');
});
