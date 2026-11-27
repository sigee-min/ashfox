import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');
const chrome =
  process.env.ASHFOX_CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const harness = `<!doctype html><html data-missing="false"><meta charset="utf-8"><style>body{margin:0}iframe{border:0;width:100vw;height:100vh}</style><img src="/hold" hidden><iframe src="/"></iframe><pre id="status">running</pre><script>
const test = async () => {
  const w = document.querySelector('iframe').contentWindow, d = w.document;
  const q = selector => d.querySelector(selector);
  const copy = JSON.parse(d.body.dataset.siteCopy);
  const until = async (fn, message) => { for(let i=0;i<200;i++){if(fn())return;await new Promise(r=>setTimeout(r,50));}throw Error(message); };
  const check = (value, message) => { if(!value)throw Error(message); };
  await until(() => q('[data-live-model]')?.dataset.ready === 'true' || q('[data-model-status]')?.textContent === copy.modelFailed, 'No model or fallback');
  const setup = q('[data-copy-agent-instruction]');
  check(!q('.asset-rail') && !q('.hero-examples'), 'Retired example navigation must not appear');
  const feedback = q('[data-copy-feedback]');
  check(feedback.scrollWidth <= feedback.clientWidth, 'Agent instruction must fit its available width');
  check(feedback.getBoundingClientRect().height < 20, 'Agent instruction must remain one small line');
  const finale = q('.landing-finale .button');
  check(finale && d.querySelector(finale.hash) === setup.closest('#quick-start'), 'Final CTA must return to agent setup');
  check(q('.prompt-code')?.textContent.includes('https://ashfox.io/agent.md'), 'One-line setup prompt must be visible');
  check(!q('a[href="/skills/ashfox/files/SKILL.md"]'), 'Skill link must not appear as a separate page link on landing');
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
  check(!q('[data-model-pause]') && !q('[data-native-size]'), 'Retired preview controls must not appear');
  const ready = q('[data-live-model]').dataset.ready === 'true';
  check(ready === (document.documentElement.dataset.missing !== 'true'), 'Normal scenarios require a live renderer; only missing-model scenarios may fall back');
  if (ready) {
    q('[data-live-model]').scrollIntoView({behavior:'instant',block:'center'});
    const sample = () => new Promise(resolve => w.requestAnimationFrame(() => {
      const frame = d.createElement('canvas'); frame.width=64;frame.height=64;
      const context = frame.getContext('2d'); context.drawImage(q('[data-live-model] canvas'),0,0,64,64);
      resolve([...context.getImageData(0,0,64,64).data].join(','));
    }));
    for(let i=0;i<30;i++) await sample();
    let before = await sample();
    if(w.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      await new Promise(resolve=>setTimeout(resolve,150));
      check(await sample() === before, 'Reduced motion must start with a still model');
      q('.view-options summary').click();
      q('[data-model-view="4.71239"]').click();
      check(await sample() !== before, 'Camera alone must change a still model view');
      q('.view-options summary').click();
      before = await sample();
    }
    q('[data-model-motion="wing_display"]').click();
    let changed = false;
    for(let i=0;i<30;i++) { if(await sample() !== before) {changed=true;break;} }
    check(changed,'Selecting a motion must change rendered pixels');
    for(const button of d.querySelectorAll('[data-model-motion]')) { button.click(); check(button.getAttribute('aria-pressed')==='true', 'Motion selection failed'); }
    q('.view-options summary').click(); check(q('.view-options').open, 'Viewpoint controls must expand');
    for(const button of d.querySelectorAll('[data-model-view]')) { check(!button.disabled, 'Camera unavailable'); button.click(); }
  } else check(!q('[data-live-model] img').hidden && [...d.querySelectorAll('[data-model-motion]')].every(button => button.disabled), 'Fallback does not preserve poster');
  check(q('[data-live-model]').getBoundingClientRect().height >= 280, 'Hero 3D stage must remain prominent');
  const sourcePanel = q('.source-window');
  const codeArea = q('.source-code pre');
  check(!sourcePanel.querySelector('details') && codeArea.getBoundingClientRect().height > 0, 'Source must be visible without expanding');
  check(codeArea.tabIndex === 0, 'Code scrolling must be keyboard accessible');
  const sourceHeight = sourcePanel.getBoundingClientRect().height;
  q('[data-diff-domain="2d"]').click();
  await until(() => q('[data-diff-token="ruby_potion"]'), '2D diff tokens missing');
  q('[data-diff-token="ruby_potion"]').click();
  await until(() => q('[data-source-code]').textContent.includes('ruby_potion') && q('[data-diff-image]').src.endsWith('ruby-potion.png'), '2D live diff did not update');
  q('[data-diff-domain="sfx"]').click();
  await until(() => q('[data-diff-token="claw_alt"]'), 'SFX diff tokens missing');
  q('[data-diff-token="claw_alt"]').click();
  await until(() => q('[data-source-code]').textContent.includes('sound claw_hit') && q('[data-diff-wave]').src.endsWith('claw-alternate.svg'), 'SFX live diff did not update');
  check(Math.abs(sourcePanel.getBoundingClientRect().height - sourceHeight) < 2, 'Source tabs must preserve panel height');
  q('[data-diff-domain="3d"]').click();
  check(q('h1').textContent.includes('as Code.') && q('#workflow'), 'Assets as Code positioning is missing');
  check(d.querySelectorAll('.frontier-grid article').length===3, 'Advanced source examples are missing');
  check(q('.studio-handoff-card[href$="/assets/"]'), 'Asset Studio handoff card missing');
  q('#frontier').scrollIntoView({behavior:'instant',block:'start'});
  await until(() => q('#frontier [data-reveal]')?.dataset.revealed === 'true', 'Scroll reveal did not trigger');
  if (w.matchMedia('(prefers-reduced-motion: reduce)').matches) check(q('#frontier [data-reveal]').getAnimations().length === 0, 'Reduced motion must skip reveal animation');
  const replay = q('[data-replay-dialog]'), replayVideo = q('[data-replay-video]');
  check(!replay.open && !replayVideo.hasAttribute('src'), 'Replay must start closed without loading video');
  for (const [index, article] of [...d.querySelectorAll('.frontier-grid article')].entries()) {
    const trigger = article.querySelector('[data-replay]');
    const height = article.getBoundingClientRect().height;
    const width = article.getBoundingClientRect().width;
    trigger.focus(); trigger.click();
    check(replay.open && d.body.classList.contains('replay-open'), 'Replay must open a modal and lock background scrolling');
    check(replay.contains(d.activeElement), 'Focus must enter replay');
    check(q('[data-replay-title]').textContent === trigger.dataset.replayName, 'Wrong replay title');
    check(replayVideo.src === trigger.href && replayVideo.poster.endsWith(trigger.dataset.replayPoster), 'Wrong replay video or poster');
    check(replayVideo.controls && !replayVideo.autoplay && replayVideo.paused, 'Replay must use explicit playback');
    check(article.getBoundingClientRect().width === width, 'Replay must preserve card width when locking scroll');
    check(article.getBoundingClientRect().height === height && !article.querySelector('details'), 'Replay must not expand the card');
    check(q('[data-replay-file]').href === trigger.href, 'Direct replay fallback missing');
    await replayVideo.play();
    await until(() => !replayVideo.paused && replayVideo.readyState >= 2, 'Replay video did not play');
    if (index === 0) q('[data-replay-close]').click();
    else if (index === 1) replay.dispatchEvent(new w.Event('cancel', {cancelable:true}));
    else {
      replay.dispatchEvent(new w.PointerEvent('pointerdown', {clientX:0,clientY:0}));
      replay.dispatchEvent(new w.MouseEvent('click', {clientX:0,clientY:0}));
    }
    await until(() => !replay.open && !replayVideo.hasAttribute('src'), 'Closing must unload video');
    check(replayVideo.paused && !d.body.classList.contains('replay-open') && d.activeElement === trigger, 'Closing must stop replay, unlock scroll and restore focus');
  }
  const replayTrigger = q('[data-replay]');
  replayTrigger.click();
  replayVideo.src = '/missing-replay.mp4';
  void replayVideo.play().catch(() => {});
  await until(() => !q('[data-replay-error]').hidden, 'Video failure must explain the direct-file fallback');
  q('[data-replay-close]').click();
  await until(() => !replayVideo.hasAttribute('src'), 'Failed replay must still close');
  replayTrigger.click();
  check(q('[data-replay-error]').hidden && replayVideo.src === replayTrigger.href, 'Reopening must clear the error and restore the chosen video');
  q('[data-replay-close]').click();
  await until(() => !replayVideo.hasAttribute('src'), 'Reopened replay must close');
  check(d.documentElement.scrollWidth<=w.innerWidth+1, 'Horizontal overflow');
  document.documentElement.dataset.result='passed';document.querySelector('#status').textContent='passed: live model/fallback, motion, views, native PNG, source, sound, responsive layout';
};
document.querySelector('iframe').addEventListener('load',()=>test().catch(error=>{document.documentElement.dataset.result='failed';document.querySelector('#status').textContent=error.stack;}).finally(()=>fetch('/done')));
</script>`;
const studioHarness = `<!doctype html><meta charset="utf-8"><style>body{margin:0}iframe{border:0;width:100vw;height:100vh}</style><img src="/hold" hidden><iframe src="/assets/"></iframe><pre id="status">running</pre><script>
const test = async () => {
  const w = document.querySelector('iframe').contentWindow, d = w.document;
  const q = s => d.querySelector(s), qa = s => [...d.querySelectorAll(s)];
  const until = async (fn, m) => { for(let i=0;i<150;i++){if(fn())return;await new Promise(r=>setTimeout(r,50));}throw Error(m); };
  const check = (v, m) => { if(!v) throw Error(m); };
  await until(() => qa('[data-catalog-row]').length === 22, 'Catalog rows missing');
  await until(() => q('[data-inspector-3d]').dataset.ready === 'true' && q('[data-inspector-3d] canvas'), 'Studio 3D model did not mount');
  const countVisible = () => qa('[data-catalog-row]').filter(r => !r.hidden && w.getComputedStyle(r).display !== 'none').length;
  q('[data-domain-tab="sprite"]').click(); check(countVisible() === 2, 'Expected 2 sprites');
  await until(() => q('[data-inspector-sprite]').complete && q('[data-inspector-sprite]').naturalWidth === 32, 'Studio 32x32 PNG failed');
  q('[data-domain-tab="tile"]').click(); check(countVisible() === 1, 'Expected 1 tile');
  q('[data-domain-tab="sound"]').click(); check(countVisible() === 5, 'Expected 5 sounds');
  const audio = q('[data-studio-audio]'); check(audio.paused && audio.preload === 'none', 'Studio audio must not autoplay');
  q('[data-inspector-controls] .button-primary')?.click();
  await until(() => !audio.paused && audio.readyState >= 2, 'Studio audio playback failed');
  audio.pause();
  q('[data-domain-tab="model"]').click(); check(countVisible() === 14, 'Expected 14 models');
  q('[data-domain-tab="all"]').click(); check(countVisible() === 22, 'Expected 22 total assets');
  const search = q('[data-studio-search]'); search.value = 'oak'; search.dispatchEvent(new w.Event('input', {bubbles:true}));
  await until(() => countVisible() === 1 && !q('[data-inspector-tile]').hidden, 'Search/tile inspector failed');
  check(w.location.search.includes('asset=oak_planks'), 'Deep link did not sync');
  await until(() => q('[data-inspector-code]').textContent.includes('oak_planks'), 'Real .ashfox source failed to load');
  let copied = ''; Object.defineProperty(w.navigator, 'clipboard', {configurable:true, value:{writeText:async t => {copied=t;}}});
  q('[data-copy-asset-prompt]').click();
  await until(() => copied.includes('https://ashfox.io/agent.md') && copied.includes('oak_planks.ashfox'), 'Agent reference prompt copy failed');
  check(d.documentElement.scrollWidth <= w.innerWidth + 1, 'Studio horizontal overflow');
  document.documentElement.dataset.result = 'passed'; document.querySelector('#status').textContent = 'passed: studio 22 catalog + search + source + prompt';
};
document.querySelector('iframe').addEventListener('load', () => test().catch(e => { document.documentElement.dataset.result = 'failed'; document.querySelector('#status').textContent = e.stack; }).finally(() => fetch('/done')));
</script>`;
const docsHarness = `<!doctype html><meta charset="utf-8"><style>body{margin:0}iframe{border:0;width:100vw;height:100vh}</style><img src="/hold" hidden><iframe src="/ko/docs/guides/install/"></iframe><pre id="status">running</pre><script>
const test = async () => {
  const w = document.querySelector('iframe').contentWindow, d = w.document;
  const q = s => d.querySelector(s), qa = s => [...d.querySelectorAll(s)];
  const until = async (fn, m) => { for(let i=0;i<150;i++){if(fn())return;await new Promise(r=>setTimeout(r,50));}throw Error(m); };
  const check = (v, m) => { if(!v) throw Error(m); };
  q('[data-docs-search-open]').click();
  await until(() => q('[data-docs-search-dialog]').open && qa('[data-docs-search-results] a').length >= 1, 'Docs search dialog failed');
  const inp = q('[data-docs-search-input]'); inp.value = 'sound'; inp.dispatchEvent(new w.Event('input', {bubbles:true}));
  await until(() => qa('[data-docs-search-results] a').some(a => a.href.includes('sound')), 'Docs search filter failed');
  q('[data-docs-search-dialog]').close();
  check(qa('.doc-article pre .copy-code').length >= 1, 'Docs code copy buttons missing');
  check(d.documentElement.scrollWidth <= w.innerWidth + 1, 'Docs horizontal overflow');
  document.documentElement.dataset.result = 'passed'; document.querySelector('#status').textContent = 'passed: docs search + copy + toc';
};
document.querySelector('iframe').addEventListener('load', () => test().catch(e => { document.documentElement.dataset.result = 'failed'; document.querySelector('#status').textContent = e.stack; }).finally(() => fetch('/done')));
</script>`;
let testMode = 'landing';
let missingModel = false;
let localePath = '/';

let hold;
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://localhost');
    if (missingModel && /^\/static\/griffin-[a-f0-9]+\.glb$/.test(url.pathname)) {
      response.writeHead(404).end();
      return;
    }
    if (url.pathname === '/hold') {
      hold = response;
      return;
    }
    if (url.pathname === '/done') {
      hold?.end();
      hold = undefined;
      response.end('done');
      return;
    }
    if (url.pathname === '/test') {
      response.setHeader('Content-Type', 'text/html');
      const tpl =
        testMode === 'studio' ? studioHarness : testMode === 'docs' ? docsHarness : harness;
      response.end(
        tpl
          .replace('data-missing="false"', `data-missing="${missingModel}"`)
          .replace('iframe src="/"', `iframe src="${localePath}"`),
      );
      return;
    }
    const relative = url.pathname.endsWith('/') ? `${url.pathname}index.html` : url.pathname;
    const target = path.resolve(root, `.${relative}`);
    if (!target.startsWith(root + path.sep)) {
      response.writeHead(403).end();
      return;
    }
    const mime = {
      '.html': 'text/html',
      '.js': 'text/javascript',
      '.css': 'text/css',
      '.png': 'image/png',
      '.mp4': 'video/mp4',
      '.gif': 'image/gif',
      '.svg': 'image/svg+xml',
      '.glb': 'model/gltf-binary',
      '.wav': 'audio/wav',
      '.json': 'application/json',
      '.ashfox': 'text/plain; charset=utf-8',
    };
    response.setHeader('Content-Type', mime[path.extname(target)] || 'application/octet-stream');
    response.end(await readFile(target));
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
try {
  for (const [mode, width, reduced, missing, locale = '/'] of [
    ['landing', 1440, false, false],
    ['landing', 390, false, false],
    ['landing', 320, false, false],
    ['landing', 390, true, false],
    ['landing', 390, true, true],
    ['landing', 1440, false, false, '/ko/'],
    ['landing', 390, false, false, '/ko/'],
    ['landing', 320, true, true, '/ko/'],
    ['studio', 1440, false, false, '/assets/'],
    ['studio', 390, false, false, '/ko/assets/'],
    ['docs', 1440, false, false, '/ko/docs/guides/install/'],
    ['docs', 390, false, false, '/docs/guides/install/'],
  ]) {
    testMode = mode;
    localePath = locale;
    missingModel = missing;
    const profile = await mkdtemp(path.join(tmpdir(), 'ashfox-site-test-'));
    try {
      const html = await new Promise((resolve, reject) => {
        const browser = spawn(
          chrome,
          [
            '--headless=new',
            '--autoplay-policy=no-user-gesture-required',
            '--no-first-run',
            '--no-default-browser-check',
            '--disable-background-networking',
            `--user-data-dir=${profile}`,
            `--window-size=${width},1000`,
            ...(reduced ? ['--force-prefers-reduced-motion'] : []),
            '--dump-dom',
            `http://127.0.0.1:${server.address().port}/test`,
          ],
          { stdio: ['ignore', 'pipe', 'ignore'] },
        );
        let output = '';
        browser.stdout.on('data', (chunk) => {
          output += chunk;
        });
        const timeout = setTimeout(() => browser.kill('SIGTERM'), 30000);
        browser.on('error', reject);
        browser.on('close', () => {
          clearTimeout(timeout);
          resolve(output);
        });
      });
      await writeFile(path.join(tmpdir(), 'ashfox-landing-browser-last.html'), html);
      assert.ok(
        html.includes('data-result="passed"'),
        html.match(/<pre id="status">([\s\S]*?)<\/pre>/u)?.[1] || html.slice(-1000),
      );
      console.log(`Browser verified [${mode}]: ${locale} ${width}px, reduced motion ${reduced}`);
    } finally {
      await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    }
  }
} finally {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
