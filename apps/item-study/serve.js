'use strict';
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { buildWorkspace } = require('./native');
const root = path.resolve(__dirname, '../..');
const result = buildWorkspace(process.argv[2] || path.join(root, 'examples/items/.ashfoxworkspace'));
if (!result.ok) { console.error(result); process.exit(1); }
const types = { '.png': 'image/png', '.json': 'application/json', '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
const server = http.createServer((req, res) => {
  let name;
  try { name = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).slice(1); }
  catch (error) { res.writeHead(400).end(error.message); return; }
  if (req.method !== 'GET' || name.includes('/') || name.includes('\\') || name.includes('..')) { res.writeHead(404).end(); return; }
  const file = ['studio.css','studio.js'].includes(name) ? path.join(__dirname, name) : name ? path.join(result.directory, name) : path.join(__dirname, 'index.html');
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'text/plain', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  fs.createReadStream(file).pipe(res);
});
server.listen(Number(process.env.ASHFOX_ITEMS_PORT || 4318), '127.0.0.1', () => console.log(`Item studio: http://127.0.0.1:${server.address().port}`));
