const http = require('http');
const fs = require('fs');
const path = require('path');

const port = process.env.PORT || 10000;
const root = __dirname;
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

function startServer() {
  const server = http.createServer((req, res) => {
    const requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    if (requestUrl.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ status: 'ok', service: 'clusterguard-pwa' }));
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
  const server = http.createServer((req, res) => {
    const requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    if (requestUrl.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ status: 'ok', service: 'clusterguard-pwa' }));
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

  server.listen(targetPort, () => {
    console.log(`Server running on port ${targetPort}`);
  });
}

startServer();

