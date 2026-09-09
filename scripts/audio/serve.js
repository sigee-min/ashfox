'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { execute, viewerCatalog } = require('./harness');
const root = process.env.ASHFOX_AUDIO_STORE || path.resolve(__dirname, '../../.ashfox/audio-native');
const jobs = new Map();
const startServer = (port = 3134) => {
  const json = (res, status, value) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); };
  const start = (request) => {
    if ([...jobs.values()].some((j) => j.state === 'running')) throw new Error('Build already running');
    if (jobs.size >= 64) jobs.delete(jobs.keys().next().value);
    const id = randomUUID(), job = { id, state: 'running', result: null };
    const child = spawn(process.execPath, ['--max-old-space-size=256', path.join(__dirname, 'cli.js')], { env: { ...process.env, ASHFOX_AUDIO_STORE: root }, stdio: ['pipe', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
    let output = '', stderr = '';
    const kill = () => { try { if (process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL'); else child.kill('SIGKILL'); } catch { /* Already exited. */ } };
    job.cancel = () => { if (job.state === 'running') { job.state = 'cancelled'; kill(); } };
    const timer = setTimeout(() => { if (job.state === 'running') { job.state = 'failed'; job.result = { error: 'Build timed out' }; kill(); } }, 120000);
    child.stdout.on('data', (c) => { output += c; if (output.length > 2 * 1024 * 1024) job.cancel(); });
    child.stderr.on('data', (c) => { stderr = (stderr + c).slice(-4000); });
    child.on('error', (e) => { clearTimeout(timer); job.state = 'failed'; job.result = { error: e.message }; });
    child.on('close', () => {
      clearTimeout(timer);
      for (const name of fs.existsSync(root) ? fs.readdirSync(root) : []) if (name.startsWith(`.build-${child.pid}-`)) fs.rmSync(path.join(root, name), { recursive: true, force: true });
      if (job.state !== 'running') return;
      try { const response = JSON.parse(output); job.state = response.ok ? 'succeeded' : 'failed'; job.result = response; }
      catch { job.state = 'failed'; job.result = { error: stderr || 'Worker exited without a result' }; }
    });
    child.stdin.on('error', () => {}); child.stdin.end(JSON.stringify(request));
    jobs.set(id, job); return { id, state: job.state };
  };
  const server = http.createServer(async (req, res) => {
    try {
      const host = `127.0.0.1:${server.address().port}`;
      if (req.headers.host !== host) return json(res, 403, { error: 'Invalid host' });
      if (req.headers.origin && req.headers.origin !== `http://${host}`) return json(res, 403, { error: 'Cross-origin request rejected' });
      const url = new URL(req.url, `http://${host}`);
      if (req.method === 'POST') {
        if (req.headers['content-type'] !== 'application/json') return json(res, 415, { error: 'Expected application/json' });
        let body = '';
        for await (const chunk of req) { body += chunk; if (Buffer.byteLength(body) > 10 * 1024 * 1024) return json(res, 413, { error: 'Request too large' }); }
        const cancel = /^\/jobs\/([a-f0-9-]+)\/cancel$/u.exec(url.pathname);
        if (cancel) { const job = jobs.get(cancel[1]); if (!job) return json(res, 404, { error: 'Unknown job' }); job.cancel(); return json(res, 200, job); }
        if (url.pathname !== '/api') return json(res, 404, { error: 'Not found' });
        const request = JSON.parse(body);
        if (request.op === 'build') return json(res, 202, { ok: true, job: start(request) });
        return json(res, 200, { ok: true, result: execute(root, request) });
      }
      if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' });
      if (url.pathname === '/catalog') return json(res, 200, viewerCatalog(root));
      if (url.pathname === '/state') return json(res, 200, execute(root, { op: 'inspect' }));
      if (url.pathname === '/capabilities') return json(res, 200, execute(root, { op: 'capabilities' }));
      const job = /^\/jobs\/([a-f0-9-]+)$/u.exec(url.pathname);
      if (job) return json(res, jobs.has(job[1]) ? 200 : 404, jobs.get(job[1]) || { error: 'Unknown job' });
      const artifact = /^\/builds\/([a-f0-9]{64})\/(receipt\.json|[a-z][a-z0-9_-]{0,63}\/[a-z][a-z0-9_]{0,31}\.(?:wav|ogg))$/u.exec(url.pathname);
      const file = artifact ? path.join(root, 'builds', artifact[1], artifact[2]) :
        ({ '/': 'index.html', '/review.js': 'review.js', '/player.js': 'player.js', '/review.css': 'review.css' })[url.pathname];
      if (!file) return json(res, 404, { error: 'Not found' });
      const actual = artifact ? file : path.join(__dirname, file);
      const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wav': 'audio/wav', '.ogg': 'audio/ogg' };
      res.writeHead(200, { 'Content-Type': types[path.extname(actual)], 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      res.end(fs.readFileSync(actual));
    } catch (e) { json(res, 400, { ok: false, error: { code: e.code || 'request.failed', pointer: e.pointer || '/', message: e.message } }); }
  });
  server.on('close', () => { for (const job of jobs.values()) job.cancel(); });
  return server.listen(port, '127.0.0.1', () => console.log(`Audio harness: http://127.0.0.1:${server.address().port}/`));
};
if (require.main === module) startServer(Number(process.env.ASHFOX_AUDIO_PORT || 3134));
module.exports = { startServer };
