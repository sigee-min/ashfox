'use strict';
// Regenerate social cards from the real model and versioned layout; no invented asset art.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync, spawn } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'ashfox-social-'));
const out = path.join(root, 'apps/site/public');
const chrome = process.env.ASHFOX_CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const data = (file, mime) => `data:${mime};base64,${fs.readFileSync(file).toString('base64')}`;
const screenshot = (args, target) => new Promise((resolve, reject) => {
  const child = spawn(chrome, args, { stdio: 'ignore' });
  let complete = false, failure, stopping;
  const ready = () => fs.existsSync(target) &&
    fs.readFileSync(target).subarray(-12).toString('hex') === '0000000049454e44ae426082';
  const poll = setInterval(() => {
    if (complete || !ready()) return;
    complete = true;
    child.kill('SIGTERM');
    stopping = setTimeout(() => child.kill('SIGKILL'), 2000);
  }, 100);
  const timeout = setTimeout(() => {
    failure = new Error('Social card capture timed out'); child.kill('SIGKILL');
  }, 30000);
  const clear = () => { clearInterval(poll); clearTimeout(timeout); clearTimeout(stopping); };
  child.once('error', error => { clear(); reject(error); });
  child.once('exit', () => { clear(); failure || !(complete || ready()) ? reject(failure || new Error('Incomplete social card')) : resolve(); });
});
const main = async () => {
try {
  execFileSync(process.execPath, [path.join(root, 'apps/cli/dist/ashfox.cjs'), 'capture',
    path.join(root, 'examples/griffin/workbench/main.ashfox'), '--width', '900', '--height', '900',
    '--background', 'transparent', '--output', path.join(stage, 'griffin.png')], { stdio: 'inherit' });
  const model = data(path.join(stage, 'griffin.png'), 'image/png');
  const logo = data(path.join(root, 'assets/brand/ashfox-mark.svg'), 'image/svg+xml');
  for (const kind of ['landing', 'docs']) {
    const docs = kind === 'docs';
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>
      *{box-sizing:border-box}html,body{margin:0;width:1200px;height:630px;overflow:hidden}
      body{background:#111518;color:#f4efdf;font-family:Arial,Helvetica,sans-serif}
      .brand{position:absolute;left:64px;top:48px;display:flex;align-items:center;gap:12px;font-weight:800;font-size:32px;letter-spacing:-1px}
      .brand img{width:40px;height:40px}.tag{position:absolute;right:64px;top:60px;color:#adb4b9;font-size:17px;letter-spacing:2px}
      h1{position:absolute;left:64px;top:152px;margin:0;font-size:104px;line-height:.98;letter-spacing:-6px;font-weight:800;z-index:2}
      h1 span{color:#e9a96a}.sub{position:absolute;left:68px;top:386px;font-size:25px;line-height:1.5;color:#bac2c7;z-index:2}
      .model{position:absolute;width:600px;height:600px;object-fit:contain;right:-25px;top:18px}
      .footer{position:absolute;left:68px;right:64px;bottom:44px;border-top:1px solid #394046;padding-top:22px;display:flex;justify-content:space-between;font-size:17px;color:#c1c6ca;letter-spacing:.3px}
      .code{position:absolute;right:64px;top:170px;width:420px;padding:32px;border:1px solid #3c464e;border-radius:16px;background:#192025;font:20px/1.7 monospace;color:#b9c3ca}
      .code b{color:#e9a96a;font-weight:400}.code small{display:block;font:14px Arial;color:#8f9ca5;padding-bottom:22px;letter-spacing:1px}
    </style></head><body>
      <div class="brand"><img src="${logo}">ashfox</div>
      <div class="tag">${docs ? 'DOCUMENTATION' : 'OPEN SOURCE'}</div>
      <h1>${docs ? 'Build with<br><span>Ashfox.</span>' : 'Assets<br><span>as Code.</span>'}</h1>
      <div class="sub">${docs ? 'From source to game.<br>The language. The workflow.' : 'Built for voxel games.'}</div>
      ${docs ? '<div class="code"><small>SOURCE → GAME ASSET</small><b>ashfox-model</b> 1<br><b>asset</b> griffin {<br>&nbsp; …<br>}<br><br><b>.ashfox</b> → GLB · PNG · WAV</div>' : `<img class="model" src="${model}">`}
      <div class="footer"><span>${docs ? 'DSL reference · Guides · Game integration' : 'Models · Textures · Sound'}</span><span>ashfox.io${docs ? '/docs' : ''}</span></div>
    </body></html>`;
    const file = path.join(stage, kind + '.html'); fs.writeFileSync(file, html);
    const target = path.join(stage, kind + '.png');
    await screenshot(['--headless=new', '--disable-gpu', '--disable-background-networking', '--disable-component-update', '--disable-extensions', '--no-first-run', '--no-default-browser-check',
      `--user-data-dir=${path.join(stage, 'profile-' + kind)}`, '--hide-scrollbars', '--force-device-scale-factor=1',
      '--window-size=1200,630', '--virtual-time-budget=1500', `--screenshot=${target}`,
      'file://' + file], target);
    fs.copyFileSync(target, path.join(out, docs ? 'og-docs.png' : 'og.png'));
  }
  console.log('Generated landing and documentation social cards (1200 × 630).');
} finally { fs.rmSync(stage, { recursive: true, force: true }); }

};
main().catch(error => { console.error(error.message); process.exitCode = 1; });
