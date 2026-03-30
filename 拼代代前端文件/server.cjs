const http = require('http');
const fs = require('fs');
const path = require('path');
const { buildSecurityHeaders } = require('./securityHeaders.cjs');

const PORT = process.env.PORT || 3000;
const DIST = path.join(__dirname, 'dist');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.eot': 'application/vnd.ms-fontobject',
  '.map': 'application/json',
};

const server = http.createServer((req, res) => {
  const isSecureRequest = req.headers['x-forwarded-proto'] === 'https';
  let filePath = path.join(DIST, req.url === '/' ? 'index.html' : req.url);
  const ext = path.extname(filePath).toLowerCase();

  // Try to serve the file; if not found, serve index.html (SPA fallback)
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      // SPA fallback: serve index.html for all non-file routes
      filePath = path.join(DIST, 'index.html');
      res.writeHead(200, {
        ...buildSecurityHeaders({ isHtml: true, isSecureRequest }),
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-cache',
      });
      fs.createReadStream(filePath).pipe(res);
      return;
    }

    const mime = MIME_TYPES[ext] || 'application/octet-stream';
    const isAsset = req.url.startsWith('/assets/');
    res.writeHead(200, {
      ...buildSecurityHeaders({ isHtml: mime.startsWith('text/html'), isSecureRequest }),
      'Content-Type': mime,
      'Cache-Control': isAsset ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(PORT, () => {
  console.log(`Frontend server running on port ${PORT}`);
});
