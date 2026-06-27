const http = require('http');

const port = process.env.PORT || 10000;

function sendJson(res, statusCode, payload, extraHeaders = {}) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    ...extraHeaders
  });
  res.end(JSON.stringify(payload));
}

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    sendJson(res, 204, { success: true }, { 'Content-Length': '0' });
    return;
  }

  if (req.method === 'GET' && req.url === '/health') {
    sendJson(res, 200, { success: true, service: 'clusterguard-push', status: 'ok' });
    return;
  }

  if (req.method !== 'POST' || req.url !== '/push') {
    sendJson(res, 404, { success: false, message: 'Not found' });
    return;
  }

  let body = '';
  req.on('data', (chunk) => {
    body += chunk;
  });
  req.on('end', () => {
    try {
      const payload = JSON.parse(body || '{}');
      console.log('Push request received', payload);
      sendJson(res, 200, { success: true, received: true, payload });
    } catch (error) {
      sendJson(res, 400, { success: false, message: 'Invalid JSON' });
    }
  });
});

server.listen(port, () => {
  console.log(`Push server listening on port ${port}`);
});
