const http = require('http');
const fs = require('fs');
const path = require('path');
const { sendFcmToTokens } = require('./fcm.js');

const root = process.cwd();
const requestedPort = Number(process.env.PORT || 3000);
const initialPort = Number.isFinite(requestedPort) && requestedPort > 0 ? requestedPort : 3000;
let port = initialPort;

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return {};
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (_error) {
    return {};
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ status: 'ok', service: 'clusterguard-pwa' }));
    return;
  }

  if (url.pathname === '/send-fcm') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, message: 'Method not allowed' }));
      return;
    }

    const payload = await readJsonBody(req);
    const tokens = Array.isArray(payload.tokens) ? payload.tokens : [];
    const result = await sendFcmToTokens({
      tokens,
      title: payload.title || 'SOS ClusterGuard',
      body: payload.body || 'Ada laporan darurat baru.',
      data: payload.data || {}
    });

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ success: result.success > 0, ...result, tokenCount: tokens.length }));
    return;
  }

  let filePath = path.join(root, url.pathname === '/' ? 'index.html' : url.pathname);
  if (!path.extname(filePath)) {
    filePath = path.join(filePath, 'index.html');
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Not found' }));
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = mimeTypes[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
});

server.on('error', (error) => {
  if (error && error.code === 'EADDRINUSE') {
    port += 1;
    console.log(`Port ${port - 1} already in use, trying ${port}`);
    server.listen(port);
    return;
  }

  console.error(error);
});

server.on('listening', () => {
  const address = server.address();
  const actualPort = typeof address === 'object' && address ? address.port : port;
  console.log(`Server running at http://localhost:${actualPort}`);
  console.log(`Server listening on all interfaces at http://0.0.0.0:${actualPort}`);
});

server.listen(initialPort, '0.0.0.0');
