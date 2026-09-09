import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
const root = process.cwd();
const types = { '.html':'text/html', '.js':'text/javascript', '.json':'application/json', '.glb':'model/gltf-binary', '.png':'image/png', '.wav':'audio/wav' };
http.createServer(async (req, res) => {
  try {
    const route = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const relative = route === '/' ? 'index.html' : route.startsWith('/game-assets/') ? 'public'+route : route.slice(1);
    const file = path.resolve(root, relative);
    if (!file.startsWith(root+path.sep)) throw new Error('Invalid path');
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type':types[path.extname(file)] ?? 'application/octet-stream' });res.end(data);
  } catch (error) { res.writeHead(404);res.end('Not found'); }
}).listen(Number(process.env.PORT ?? 4319), '127.0.0.1', () => process.stdout.write(`Open http://127.0.0.1:${process.env.PORT ?? 4319}\n`));
