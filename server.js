const http = require('http');
const fs = require('fs');
const path = require('path');
const { sendFcmToTokens } = require('./fcm');

const port = process.env.PORT || 10000;
const root = __dirname;
const allowedOrigins = ['http://127.0.0.1:8000', 'http://127.0.0.1:3100', 'http://localhost:3000', 'http://localhost:8000', 'https://clusterguard.web.app', 'https://*.vercel.app'];
const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

function setCorsHeaders(req, res) {
  const origin = req.headers.origin;
  const allowOrigin = allowedOrigins.includes(origin) ? origin : '*';
  res.setHeader('Access-Control-Allow-Origin', allowOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
}

function startServer() {
  const server = http.createServer(async (req, res) => {
    const requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    setCorsHeaders(req, res);

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (requestUrl.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ status: 'ok', service: 'clusterguard-pwa' }));
      return;
    }

    if (req.method === 'POST' && requestUrl.pathname === '/send-fcm') {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', async () => {
        try {
          const payload = JSON.parse(body || '{}');
          const tokens = Array.isArray(payload.tokens) ? payload.tokens : [];
          const result = await sendFcmToTokens({
            tokens,
            title: payload.title || 'SOS ClusterGuard',
            body: payload.body || 'Ada laporan darurat baru.',
            data: payload.data || {}
          });
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ success: true, ...result }));
        } catch (error) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ success: false, message: error.message }));
        }
      });
      return;
    }

    let requestedPath = requestUrl.pathname === '/' ? '/index.html' : requestUrl.pathname;
    requestedPath = requestedPath.split('?')[0];
    const filePath = path.join(root, requestedPath);

    fs.readFile(filePath, (error, content) => {
      if (error) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Not Found');
        return;
      }

      const ext = path.extname(filePath).toLowerCase();
      const contentType = mimeTypes[ext] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
    });
  });

  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      console.warn(`Port ${port} already in use, retrying on ${Number(port) + 1}`);
      server.close(() => {
        startServerWithPort(Number(port) + 1);
      });
      return;
    }
    throw error;
  });

  server.listen(port, () => {
    console.log(`Server running on port ${port}`);
  });
}

function startServerWithPort(targetPort) {
  const server = http.createServer(async (req, res) => {
    const requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    setCorsHeaders(req, res);

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (requestUrl.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ status: 'ok', service: 'clusterguard-pwa' }));
      return;
    }

    if (req.method === 'POST' && requestUrl.pathname === '/send-fcm') {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', async () => {
        try {
          const payload = JSON.parse(body || '{}');
          const tokens = Array.isArray(payload.tokens) ? payload.tokens : [];
          const result = await sendFcmToTokens({
            tokens,
            title: payload.title || 'SOS ClusterGuard',
            body: payload.body || 'Ada laporan darurat baru.',
            data: payload.data || {}
          });
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ success: true, ...result }));
        } catch (error) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ success: false, message: error.message }));
        }
      });
      return;
    }

    let requestedPath = requestUrl.pathname === '/' ? '/index.html' : requestUrl.pathname;
    requestedPath = requestedPath.split('?')[0];
    const filePath = path.join(root, requestedPath);

    fs.readFile(filePath, (error, content) => {
      if (error) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Not Found');
        return;
      }

      const ext = path.extname(filePath).toLowerCase();
      const contentType = mimeTypes[ext] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
    });
  });

  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      const nextPort = targetPort + 1;
      console.warn(`Port ${targetPort} already in use, retrying on ${nextPort}`);
      server.close(() => {
        startServerWithPort(nextPort);
      });
      return;
    }
    throw error;
  });

  server.listen(targetPort, () => {
    console.log(`Server running on port ${targetPort}`);
  });
}

startServer();

