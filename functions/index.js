const functions = require('firebase-functions');
const admin = require('firebase-admin');

admin.initializeApp();

exports.sendSosNotification = functions.https.onCall(async (data, context) => {
  const { title, body, token, tag = 'clusterguard-sos', url = '/' } = data || {};

  if (!token) {
    throw new functions.https.HttpsError('invalid-argument', 'FCM token is required.');
  }

  const message = {
    token,
    notification: {
      title: title || 'SOS ClusterGuard',
      body: body || 'Ada laporan darurat baru.'
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
        data: {
          url
        }
      }
    },
    data: {
      title: title || 'SOS ClusterGuard',
      body: body || 'Ada laporan darurat baru.',
      tag,
      url
    }
  };

  try {
    const response = await admin.messaging().send(message);
    return { success: true, messageId: response };
  } catch (error) {
    console.error('FCM send failed:', error);
    throw new functions.https.HttpsError('internal', 'Failed to send notification.', error);
  }
});
