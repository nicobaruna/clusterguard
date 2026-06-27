const http = require('http');
const webPush = require('web-push');

const port = process.env.PORT || 10000;
const vapidPublicKey = process.env.VAPID_PUBLIC_KEY || 'BBeM0UdoQLxG6N2U1L6mBR6tQhTdGUh2DzNNW_9xIA0T8HwSilKTXQTak1EW0bVtxPL6VleL8mTnhf_Pn5V2Kz0';
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY || 'hF2b3l2fKfWmP0WfCD5xSkBtfXbp6n6ri2qtozqfgE8';
const subscriptions = [];

webPush.setVapidDetails('mailto:admin@clusterguard.local', vapidPublicKey, vapidPrivateKey);

function sendJson(res, statusCode, payload, extraHeaders = {}) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS, GET',
    'Access-Control-Allow-Headers': 'Content-Type',
    ...extraHeaders
  });
  res.end(JSON.stringify(payload));
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    sendJson(res, 204, { success: true }, { 'Content-Length': '0' });
    return;
  }

  if (req.method === 'GET' && req.url === '/health') {
    sendJson(res, 200, { success: true, service: 'clusterguard-push', status: 'ok' });
    return;
  }

  if (req.method === 'POST' && req.url === '/subscribe') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try {
        const subscription = JSON.parse(body || '{}');
        subscriptions.push(subscription);
        sendJson(res, 200, { success: true, subscriptions: subscriptions.length });
      } catch (error) {
        sendJson(res, 400, { success: false, message: 'Invalid JSON' });
      }
    });
    return;
  }

  if (req.method !== 'POST' || req.url !== '/push') {
    sendJson(res, 404, { success: false, message: 'Not found' });
    return;
  }

  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', async () => {
    try {
      const payload = JSON.parse(body || '{}');
      const notificationPayload = {
        title: payload.title || 'SOS ClusterGuard',
        body: payload.body || 'Ada laporan darurat baru.',
        icon: payload.icon || '/icon-192.png',
        badge: payload.badge || '/icon-192.png',
        tag: payload.tag || 'clusterguard-sos',
        data: { url: payload.url || '/', sosId: payload.sosId || null }
      };

      const webPushPayload = JSON.stringify({
        title: notificationPayload.title,
        body: notificationPayload.body,
        icon: notificationPayload.icon,
        badge: notificationPayload.badge,
        tag: notificationPayload.tag,
        data: notificationPayload.data
      });

      const results = await Promise.allSettled(
        subscriptions.map((sub) => webPush.sendNotification(sub, webPushPayload))
      );

      const successful = results.filter((r) => r.status === 'fulfilled').length;
      sendJson(res, 200, { success: true, delivered: successful, total: subscriptions.length, payload: notificationPayload });
    } catch (error) {
      sendJson(res, 400, { success: false, message: 'Invalid JSON' });
    }
  });
});

server.listen(port, () => {
  console.log(`Push server listening on port ${port}`);
});
