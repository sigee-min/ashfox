const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const publicRoot = path.resolve(__dirname, '..', 'dist', 'public');
const port = Number.parseInt(process.env.PORT ?? '4173', 10);
const host = '127.0.0.1';

const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mp4': 'video/mp4',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.wav': 'audio/wav',
  '.tgz': 'application/gzip',
  '.zip': 'application/zip',
  '.webp': 'image/webp'
};

const resolveFile = (pathname) => {
  const decoded = decodeURIComponent(pathname);
  const relative = decoded.replace(/^\/+/, '');
  const requested = path.resolve(publicRoot, relative);
  if (
    requested !== publicRoot &&
    !requested.startsWith(`${publicRoot}${path.sep}`)
  ) {
    return null;
  }
  const directoryIndex = path.join(requested, 'index.html');
  if (fs.statSync(directoryIndex, { throwIfNoEntry: false })?.isFile()) {
    return directoryIndex;
  }
  if (fs.statSync(requested, { throwIfNoEntry: false })?.isFile()) {
    return requested;
  }
  return path.join(publicRoot, 'index.html');
};

if (!fs.statSync(publicRoot, { throwIfNoEntry: false })?.isDirectory()) {
  throw new Error('Run npm run build:public before previewing.');
}

http.createServer((request, response) => {
  const url = new URL(request.url ?? '/', `http://${host}:${port}`);
  if (url.pathname === '/home' || url.pathname === '/home/') {
    response.writeHead(301, { Location: '/' });
    response.end();
    return;
  }
  if (
    url.pathname === '/workbench' ||
    url.pathname === '/docs'
  ) {
    response.writeHead(301, { Location: `${url.pathname}/` });
    response.end();
    return;
  }
  const file = resolveFile(url.pathname);
  if (!file) {
    response.writeHead(400);
    response.end('Bad request');
    return;
  }
  const contentType =
    contentTypes[path.extname(file).toLowerCase()] ??
    'application/octet-stream';
  const fileSize = fs.statSync(file).size;
  const range = request.headers.range?.match(/^bytes=(\d*)-(\d*)$/);
  let start = 0;
  let end = fileSize - 1;
  if (range) {
    const [, requestedStart, requestedEnd] = range;
    if (!requestedStart && requestedEnd) {
      start = Math.max(0, fileSize - Number.parseInt(requestedEnd, 10));
    } else {
      start = Number.parseInt(requestedStart || '0', 10);
      if (requestedEnd) end = Number.parseInt(requestedEnd, 10);
    }
    end = Math.min(end, fileSize - 1);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) {
      response.writeHead(416, {
        'Content-Range': `bytes */${fileSize}`
      });
      response.end();
      return;
    }
  }
  const headers = {
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-store',
    'Content-Length': String(end - start + 1),
    'Content-Type': contentType
  };
  if (range) headers['Content-Range'] = `bytes ${start}-${end}/${fileSize}`;
  response.writeHead(range ? 206 : 200, headers);
  if (request.method === 'HEAD') {
    response.end();
    return;
  }
  fs.createReadStream(file, { start, end }).pipe(response);
}).listen(port, host, () => {
  console.log(`ashfox preview: http://${host}:${port}/`);
});
