'use strict';

const childProcess = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SHOWCASE_ROOT = path.join(
  ROOT,
  'assets',
  'showcase',
  'shared-creatures'
);
const MEDIA = Object.freeze([
  ['griffin', 'gif', 'griffin-build-replay.gif'],
  ['griffin', 'png', 'griffin-poster.png'],
  ['fox', 'gif', 'fox-build-replay.gif'],
  ['fox', 'png', 'fox-poster.png'],
  ['goblin', 'gif', 'goblin-build-replay.gif'],
  ['goblin', 'png', 'goblin-poster.png']
]);
const MAX_DOM_BYTES = 96 * 1024 * 1024;
const CAPTURE_TIMEOUT_MS = 120_000;

const chromePath = () => {
  const explicit = process.env.ASHFOX_CHROME_PATH;
  const candidates = [
    explicit,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser'
  ].filter(Boolean);
  const found = candidates.find((candidate) => fs.statSync(
    candidate,
    { throwIfNoEntry: false }
  )?.isFile());
  if (!found) throw new Error(
    'Chrome or Chromium is required. Set ASHFOX_CHROME_PATH to its executable.'
  );
  return found;
};

const freePort = () => new Promise((resolve, reject) => {
  const server = net.createServer();
  server.unref();
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const address = server.address();
    if (address === null || typeof address === 'string') {
      server.close();
      reject(new Error('Could not allocate a local capture port.'));
      return;
    }
    const port = address.port;
    server.close((error) => error ? reject(error) : resolve(port));
  });
});

const waitForServer = async (url, server) => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (server.exitCode !== null) {
      throw new Error(`Workbench capture server exited with ${server.exitCode}.`);
    }
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The bounded retry loop owns startup races.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Workbench capture server did not become ready in 10 seconds.');
};

const htmlAttribute = (value) => value
  .replaceAll('&quot;', '"')
  .replaceAll('&amp;', '&')
  .replaceAll('&#39;', "'")
  .replaceAll('&lt;', '<')
  .replaceAll('&gt;', '>');

const mediaBytes = (html, entryName, kind) => {
  const expression = new RegExp(
    `<span[^>]*data-showcase-bytes="${entryName}-${kind}"` +
    `[^>]*data-part="([0-9]+)"[^>]*data-chunk="([^"]*)"[^>]*>`,
    'gu'
  );
  const chunks = [...html.matchAll(expression)].map((match) => ({
    part: Number(match[1]),
    value: htmlAttribute(match[2])
  })).sort((left, right) => left.part - right.part);
  if (chunks.length === 0 || chunks.some((chunk, index) => chunk.part !== index)) {
    throw new Error(`Capture output is incomplete for ${entryName}-${kind}.`);
  }
  const bytes = Buffer.from(chunks.map((chunk) => chunk.value).join(''), 'base64');
  const signature = kind !== 'png'
    ? bytes.subarray(0, 3).toString('ascii') === 'GIF'
    : bytes.subarray(1, 4).toString('ascii') === 'PNG';
  if (!signature) throw new Error(`Capture output is invalid for ${entryName}-${kind}.`);
  return bytes;
};

const captureDom = (browser, url, profile) => {
  const result = childProcess.spawnSync(browser, [
    '--headless=new',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-sync',
    '--disable-extensions',
    '--hide-scrollbars',
    '--mute-audio',
    `--user-data-dir=${profile}`,
    '--use-angle=swiftshader',
    '--use-gl=angle',
    '--enable-webgl',
    '--virtual-time-budget=600000',
    '--dump-dom',
    url
  ], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: MAX_DOM_BYTES,
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: CAPTURE_TIMEOUT_MS,
    killSignal: 'SIGTERM'
  });
  const html = result.stdout ?? '';
  if (!html.includes('data-showcase-capture="ready"')) {
    fs.writeFileSync(path.join(os.tmpdir(), 'ashfox-showcase-failure.html'), html);
    const reason = result.error?.code === 'ETIMEDOUT'
      ? 'timed out before all entries were ready'
      : `exited with ${result.status ?? 'no status'}`;
    throw new Error(`Browser capture ${reason}.`);
  }
  return html;
};

const main = async () => {
  const port = await freePort();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ashfox-showcase-'));
  let staged = null;
  const server = childProcess.spawn(
    process.execPath,
    [path.join(ROOT, 'apps', 'web', 'scripts', 'dev.js')],
    {
      cwd: ROOT,
      env: { ...process.env, ASHFOX_WEB_PORT: String(port) },
      stdio: ['ignore', 'ignore', 'pipe']
    }
  );
  try {
    const baseUrl = `http://127.0.0.1:${port}`;
    await waitForServer(`${baseUrl}/workbench/`, server);
    const html = captureDom(
      chromePath(),
      `${baseUrl}/workbench/?tool=showcase-capture&capture=all`,
      profile
    );
    staged = fs.mkdtempSync(path.join(os.tmpdir(), 'ashfox-media-'));
    for (const [entryName, kind, fileName] of MEDIA) {
      fs.writeFileSync(
        path.join(staged, fileName),
        mediaBytes(html, entryName, kind)
      );
    }
    const motionFiles = [];
    const fields = new Set([...html.matchAll(/data-showcase-bytes="([a-z]+)-motion-([a-z_]+)"/gu)].map((match) => `${match[1]}:${match[2]}`));
    for (const field of fields) {
      const [entry, clip] = field.split(':');
      const input = path.join(staged, `${entry}-${clip}.gif`);
      const output = `${entry}-${clip}.mp4`;
      fs.writeFileSync(input, mediaBytes(html, entry, `motion-${clip}`));
      childProcess.execFileSync(process.env.ASHFOX_FFMPEG_PATH || 'ffmpeg', [
        '-v', 'error', '-y', '-i', input, '-an', '-c:v', 'libx264',
        '-pix_fmt', 'yuv420p', '-crf', '18', '-movflags', '+faststart',
        path.join(staged, output)
      ]);
      motionFiles.push(output);
    }
    if (motionFiles.length !== 12) throw new Error('Expected twelve finished motion movies.');
    for (const [entry, kind, file] of MEDIA) {
      if (kind !== 'gif') continue;
      const output = `${entry}-build-replay.mp4`;
      childProcess.execFileSync(process.env.ASHFOX_FFMPEG_PATH || 'ffmpeg', [
        '-v', 'error', '-y', '-i', path.join(staged, file), '-an', '-c:v', 'libx264',
        '-pix_fmt', 'yuv420p', '-crf', '18', '-movflags', '+faststart', path.join(staged, output)
      ]);
      motionFiles.push(output);
    }
    fs.mkdirSync(SHOWCASE_ROOT, { recursive: true });
    for (const file of motionFiles) fs.renameSync(path.join(staged, file), path.join(SHOWCASE_ROOT, file));
    for (const [, , fileName] of MEDIA) {
      fs.renameSync(path.join(staged, fileName), path.join(SHOWCASE_ROOT, fileName));
    }
    childProcess.execFileSync(
      process.execPath,
      [path.join(ROOT, 'scripts', 'showcase.js'), '--write'],
      { cwd: ROOT, stdio: 'inherit' }
    );
    console.log('ashfox showcase captured: griffin + fox + goblin');
  } finally {
    server.kill('SIGTERM');
    if (staged !== null) fs.rmSync(staged, { recursive: true, force: true });
    fs.rmSync(profile, { recursive: true, force: true });
  }
};

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
