import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');
const chrome = process.env.ASHFOX_CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const harness = `<!doctype html><meta charset="utf-8"><style>body{margin:0}iframe{border:0;width:100vw;height:100vh}</style><img src="/hold" hidden><iframe src="/" allow="autoplay"></iframe><pre id="status">running</pre><script>
const test = async () => {
  const frame = document.querySelector('iframe');
  const w = frame.contentWindow, d = frame.contentDocument;
  const q = (s) => d.querySelector(s);
  const until = async (fn, message) => { for(let i=0;i<100;i++){if(fn())return;await new Promise(r=>setTimeout(r,50));}throw Error(message); };
  const check = (value, message) => { if(!value)throw Error(message); };
  await until(() => q('[data-motion-list]')?.children.length === 6, 'showroom script did not initialize');
  const entries = JSON.parse(q('[data-showroom-data]').textContent);
  const player = q('[data-character-player]');
  const reduced = w.matchMedia('(prefers-reduced-motion: reduce)').matches;
  q('.character-stage').scrollIntoView({block:'center',behavior:'instant'});
  if(reduced) { await new Promise(r=>setTimeout(r,300)); check(!player.getAttribute('src'), 'reduced motion loaded a movie'); check(!q('[data-character-poster]').hidden, 'reduced motion hid poster'); }
  else await until(() => !player.paused && player.readyState >= 2, 'visible model did not autoplay');
  check(!q('[data-build-player]').getAttribute('src'), 'build replay loaded eagerly');
  for(let index=0;index<entries.length;index++) {
    q('[data-character="'+index+'"]').click();
    check(q('[data-glb-download]').getAttribute('href')===entries[index].glbHref, 'wrong GLB');
    check(q('[data-workspace-download]').getAttribute('href')===entries[index].workspaceHref, 'wrong workspace');
    check(q('[data-character-name]').textContent===entries[index].label, 'wrong character label');
    const buttons = [...q('[data-motion-list]').children];
    check(buttons.length===entries[index].motions.length, 'missing motion buttons');
    for(let clip=0;clip<buttons.length;clip++) {
      buttons[clip].click();
      q('.character-stage').scrollIntoView({block:'center',behavior:'instant'});
      await until(() => player.getAttribute('src')===entries[index].motions[clip].src && !player.paused && player.readyState >= 2, 'selected motion failed: '+entries[index].motions[clip].name);
    }
  }
  for (const index of [0, 2, 1, 0, 2]) q('[data-character="'+index+'"]').click();
  q('[data-motion-list]').firstElementChild.click();
  await until(() => player.getAttribute('src') === entries[2].motions[0].src && !player.paused && player.readyState >= 2, 'rapid selection showed stale movie');
  q('[data-motion-toggle]').click();
  await until(() => player.paused, 'pause failed');
  q('[data-motion-toggle]').click();
  await until(() => !player.paused, 'resume failed');
  q('#outputs').scrollIntoView({behavior:'instant'});
  await until(() => player.paused, 'offscreen video did not pause');
  q('.character-stage').scrollIntoView({block:'center',behavior:'instant'});
  await until(() => !player.paused, 'return to stage did not resume');
  player.src = '/missing-preview.mp4';
  player.load();
  await until(() => !q('[data-motion-status]').hidden && !q('[data-character-poster]').hidden, 'failed movie has no visible fallback');
  q('[data-motion-toggle]').click();
  await until(() => !player.paused && player.readyState >= 2 && q('[data-motion-status]').hidden, 'failed movie cannot be retried');
  const build = q('[data-build-player]');
  q('[data-build-open]').click();
  check(q('[data-build-dialog]').open, 'build dialog did not open');
  check(build.getAttribute('src')===entries[2].replayVideoSrc,'wrong build video');
  await until(() => !build.paused && build.readyState >= 2, 'build video did not play');
  check(player.paused, 'character movie plays behind modal');
  check(build.controls && !build.loop, 'build video requires seek controls and a finite ending');
  build.pause();
  build.currentTime = build.duration / 2;
  await until(() => !build.seeking, 'build video cannot seek');
  q('[data-build-close]').click();
  await until(() => !build.getAttribute('src'), 'closed build video still loaded');
  check(d.activeElement===q('[data-build-open]'), 'dialog did not return focus');
  check(!d.documentElement.classList.contains('build-viewer-open'), 'dialog left scroll locked');
  check(d.documentElement.scrollWidth <= w.innerWidth + 1, 'horizontal overflow');
  check(q('[data-current-year]').textContent, 'shared site script failed');
  document.documentElement.dataset.result = 'passed';
  document.querySelector('#status').textContent='passed: twelve clips, selection, downloads, pause, offscreen, replay, layout; reduced='+reduced;
};
document.querySelector('iframe').addEventListener('load',()=>test().catch(error=>{document.documentElement.dataset.result='failed';document.querySelector('#status').textContent=error.stack;}).finally(()=>fetch('/done')));
</script>`;
let hold;
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://localhost');
    if (url.pathname === '/hold') { hold = response; return; }
    if (url.pathname === '/done') { hold?.end(); hold = undefined; response.end('done'); return; }
    if (url.pathname === '/test') { response.setHeader('Content-Type', 'text/html'); response.end(harness); return; }
    const relative = url.pathname.endsWith('/') ? `${url.pathname}index.html` : url.pathname;
    const target = path.resolve(root, `.${relative}`);
    if (!target.startsWith(root + path.sep)) { response.writeHead(403).end(); return; }
    const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.mp4': 'video/mp4', '.gif': 'image/gif', '.svg': 'image/svg+xml' };
    response.setHeader('Content-Type', mime[path.extname(target)] || 'application/octet-stream');
    response.end(await readFile(target));
  } catch { response.writeHead(404).end(); }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
try {
  for (const [width, reduced] of [[1440, false], [390, false], [390, true]]) {
    const profile = await mkdtemp(path.join(tmpdir(), 'ashfox-site-test-'));
    try {
      const html = await new Promise((resolve, reject) => {
        const browser = spawn(chrome, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', `--user-data-dir=${profile}`, `--window-size=${width},1000`, ...(reduced ? ['--force-prefers-reduced-motion'] : []), '--dump-dom', `http://127.0.0.1:${server.address().port}/test`], { stdio: ['ignore', 'pipe', 'ignore'] });
        let output = '';
        browser.stdout.on('data', (chunk) => { output += chunk; });
        const timeout = setTimeout(() => browser.kill('SIGTERM'), 30000);
        browser.on('error', reject);
        browser.on('close', () => { clearTimeout(timeout); resolve(output); });
      });
      await writeFile(path.join(tmpdir(), 'ashfox-showroom-browser-last.html'), html);
      assert.ok(html.includes('data-result="passed"'), html.match(/<pre id="status">([\s\S]*?)<\/pre>/u)?.[1] || html.slice(-1000));
      console.log(`Showroom browser verified: ${width}px, reduced motion ${reduced}`);
    } finally { await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); }
  }
} finally { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
