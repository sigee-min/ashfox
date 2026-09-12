import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');
const chrome = process.env.ASHFOX_CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const harness = `<!doctype html><meta charset="utf-8"><style>body{margin:0}iframe{border:0;width:100vw;height:100vh}</style><img src="/hold" hidden><iframe src="/"></iframe><pre id="status">running</pre><script>
const test = async () => {
  const w = document.querySelector('iframe').contentWindow, d = w.document;
  const q = selector => d.querySelector(selector);
  const copy = JSON.parse(d.body.dataset.siteCopy);
  const until = async (fn, message) => { for(let i=0;i<200;i++){if(fn())return;await new Promise(r=>setTimeout(r,50));}throw Error(message); };
  const check = (value, message) => { if(!value)throw Error(message); };
  await until(() => q('[data-live-model]')?.dataset.ready === 'true' || q('[data-model-status]')?.textContent === copy.modelFailed, 'No model or fallback');
  const setup = q('[data-copy-agent-instruction]');
  check(!d.body.innerText.includes('https://ashfox.io/agent.md'), 'Setup prompt must not be displayed');
  check(setup.closest('.hero-copy'), 'Setup must be available in the hero');
  const centered = () => {
    const button = setup.getBoundingClientRect(), label = setup.querySelector('[data-copy-state]').getBoundingClientRect();
    return Math.abs((button.left + button.right - label.left - label.right) / 2) < 2;
  };
  check(centered(), 'Setup label must be horizontally centered');
  let copiedText = '';
  Object.defineProperty(w.navigator, 'clipboard', {configurable:true, value:{writeText:async text => {copiedText=text;}}});
  setup.click();
  await until(() => setup.dataset.copied === 'true', 'Setup copy did not succeed');
  check(centered(), 'Copied label must stay centered');
  check(copiedText === setup.dataset.instruction && copiedText.includes('https://ashfox.io/agent.md'), 'Wrong setup prompt copied');
  w.navigator.clipboard.writeText = async () => {throw Error('Clipboard denied');};
  setup.click();
  await until(() => q('[data-copy-feedback]').dataset.state === 'error', 'Clipboard failure not explained');
  check(!setup.disabled, 'Clipboard failure must allow retry');
  w.navigator.clipboard.writeText = async text => {copiedText=text;};
  setup.click();
  await until(() => setup.dataset.copied === 'true', 'Clipboard retry failed');
  const menu = q('[data-language-menu]');
  check(menu.closest('.header-actions') && !q('.docs-languages'), 'Language picker must only appear in header');
  check(!menu.open, 'Language list must start closed');
  menu.querySelector('summary').click();
  check(menu.open && menu.querySelectorAll('a').length >= 2, 'Language list did not open');
  menu.dispatchEvent(new w.KeyboardEvent('keydown', {key:'Escape',bubbles:true}));
  check(!menu.open && d.activeElement === menu.querySelector('summary'), 'Escape must close and restore focus');
  menu.querySelector('summary').click(); q('h1').click();
  check(!menu.open, 'Outside click must close language list');
  w.location.hash = 'frontier';
  await until(() => [...menu.querySelectorAll('a')].every(link => link.hash === '#frontier'), 'Language switch lost current section');
  if (d.documentElement.lang === 'ko') {
    check(q('.header-setup').getAttribute('href') === '/ko/#quick-start', 'Korean install link lost locale');
    check(q('.hero-subtitle').textContent === '복셀 게임의 에셋을 코드로.', 'Korean landing copy missing');
  }
  const ready = q('[data-live-model]').dataset.ready === 'true';
  if (ready) {
    check(q('[data-model-pause]').textContent === (w.matchMedia('(prefers-reduced-motion: reduce)').matches ? copy.play : copy.pause), 'Reduced motion not respected');
    for(const button of d.querySelectorAll('[data-model-motion]')) { button.click(); check(button.getAttribute('aria-pressed')==='true', 'Motion selection failed'); }
    q('[data-model-pause]').click(); check(q('[data-model-pause]').textContent===copy.play, 'Pause failed');
    q('.view-options summary').click(); check(q('.view-options').open, 'Viewpoint controls must expand');
    for(const button of d.querySelectorAll('[data-model-view]')) { check(!button.disabled, 'Camera unavailable'); button.click(); }
  } else check(!q('[data-live-model] img').hidden && q('[data-model-pause]').disabled, 'Fallback does not preserve poster');
  q('.world-items').scrollIntoView({behavior:'instant',block:'center'});
  await until(()=>q('.item-showcase').dataset.entered==='true', 'Scroll entrance did not run');
  if (w.matchMedia('(prefers-reduced-motion: reduce)').matches) check(q('.item-showcase').getAnimations().length===0, 'Reduced motion must skip entrance animation');
  q('[data-item="amethyst"]').click();
  await until(()=>q('[data-item-image]').complete && q('[data-item-image]').naturalWidth===16, 'Native PNG failed');
  check(q('[data-item-download]').getAttribute('href').endsWith('amethyst.png'), 'Wrong item download');
  q('[data-native-size]').click(); check(q('.item-art').classList.contains('native'), 'Native-size view failed');
  q('[data-source="sound"]').click();
  await until(()=>q('[data-source-code]').textContent.includes('sound claw_hit'), 'Actual source did not load');
  const audio=q('[data-landing-audio]'); check(audio.paused && audio.preload==='none', 'Audio must not autoplay');
  q('.world-sound').scrollIntoView({behavior:'instant',block:'center'});
  q('[data-sound-play]').click(); await until(()=>!audio.paused && audio.readyState>=2, 'Audio did not play');
  q('[data-sound-another]').click();
  await until(()=>audio.src.endsWith('claw-alternate.wav') && !audio.paused, 'Hear another must play a different sound');
  check(!d.body.innerText.includes('Alternate') && !d.body.innerText.includes('48 kHz'), 'Internal audio metadata leaked into the experience');
  check(q('h1').textContent.includes('as Code.') && q('#workflow'), 'Assets as Code positioning is missing');
  check(d.querySelectorAll('.frontier-grid article').length===3, 'Advanced source examples are missing');
  q('#frontier').scrollIntoView({behavior:'instant',block:'start'});
  for (const article of d.querySelectorAll('.frontier-grid article')) {
    article.querySelector('summary').click();
    check(article.querySelector('details').open, 'Build replay cannot be expanded');
    const video = article.querySelector('video');
    check(video.controls && !video.autoplay && video.poster && video.querySelector('source').src.endsWith('.mp4'), 'Replay must be explicit and source-backed');
  }
  check(d.documentElement.scrollWidth<=w.innerWidth+1, 'Horizontal overflow');
  document.documentElement.dataset.result='passed';document.querySelector('#status').textContent='passed: live model/fallback, motion, views, native PNG, source, sound, responsive layout';
};
document.querySelector('iframe').addEventListener('load',()=>test().catch(error=>{document.documentElement.dataset.result='failed';document.querySelector('#status').textContent=error.stack;}).finally(()=>fetch('/done')));
</script>`;
let missingModel = false;
let localePath = '/';

let hold;
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://localhost');
    if (missingModel && url.pathname === '/media/landing/griffin.glb') { response.writeHead(404).end(); return; }
    if (url.pathname === '/hold') { hold = response; return; }
    if (url.pathname === '/done') { hold?.end(); hold = undefined; response.end('done'); return; }
    if (url.pathname === '/test') { response.setHeader('Content-Type', 'text/html'); response.end(harness.replace('iframe src="/"', `iframe src="${localePath}"`)); return; }
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
  for (const [width, reduced, missing, locale = '/'] of [[1440, false, false], [390, false, false], [320, false, false], [390, true, false], [390, true, true], [1440, false, false, '/ko/'], [390, false, false, '/ko/'], [320, true, true, '/ko/']]) {
    localePath = locale;
    missingModel = missing;
    const profile = await mkdtemp(path.join(tmpdir(), 'ashfox-site-test-'));
    try {
      const html = await new Promise((resolve, reject) => {
        const browser = spawn(chrome, ['--headless=new', '--autoplay-policy=no-user-gesture-required', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', `--user-data-dir=${profile}`, `--window-size=${width},1000`, ...(reduced ? ['--force-prefers-reduced-motion'] : []), '--dump-dom', `http://127.0.0.1:${server.address().port}/test`], { stdio: ['ignore', 'pipe', 'ignore'] });
        let output = '';
        browser.stdout.on('data', (chunk) => { output += chunk; });
        const timeout = setTimeout(() => browser.kill('SIGTERM'), 30000);
        browser.on('error', reject);
        browser.on('close', () => { clearTimeout(timeout); resolve(output); });
      });
      await writeFile(path.join(tmpdir(), 'ashfox-landing-browser-last.html'), html);
      assert.ok(html.includes('data-result="passed"'), html.match(/<pre id="status">([\s\S]*?)<\/pre>/u)?.[1] || html.slice(-1000));
      console.log(`Landing browser verified: ${locale} ${width}px, reduced motion ${reduced}`);
    } finally { await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); }
  }
} finally { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
