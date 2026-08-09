const http = require('http');
const fs = require('fs');
const path = require('path');

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

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ status: 'ok', service: 'clusterguard-pwa' }));
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
});

server.listen(initialPort);
