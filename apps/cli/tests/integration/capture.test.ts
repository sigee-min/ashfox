'use strict';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync, spawn } from 'node:child_process';
import { inflateSync } from 'node:zlib';

const root = path.resolve(__dirname, '../../../..'),
  cli = path.join(__dirname, '../../dist/ashfox.cjs');
const fox = path.join(root, 'examples/fox/creatures/fox.ashfox'),
  sword = path.join(root, 'examples/items/assets/sprites/iron_sword.ashfox'),
  marker = path.join(root, 'examples/minecraft/assets/models/marker.ashfox'),
  sound = path.join(root, 'examples/sounds/assets/sounds/claw_hit.ashfox'),
  cottage = path.join(root, 'examples/structure/assets/structures/medieval_cottage.ashfox');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ashfox-capture-test-'));

const run = (args: string[], options = {}) =>
  spawnSync(process.execPath, [cli, ...args], {
    cwd: temp,
    timeout: 150000,
    maxBuffer: 64 * 1024 * 1024,
    ...options,
  });

const success = (result: ReturnType<typeof run>) => {
  assert.equal(result.status, 0, result.stderr.toString());
  assert.equal(result.stderr.length, 0);
  return result.stdout;
};

const png = (bytes: Buffer, width: number, height: number) => {
  assert.equal(bytes.subarray(1, 4).toString(), 'PNG');
  assert.equal(bytes.readUInt32BE(16), width);
  assert.equal(bytes.readUInt32BE(20), height);
};

const withPreview = (
  entryPath: string,
  previewBody: string,
  extraFiles: Record<string, string>,
  name = path.basename(entryPath),
) => {
  const source = fs
    .readFileSync(entryPath, 'utf8')
    .replace(/(\}\s*)$/, `  preview v {\n${previewBody}\n  }\n$1`);
  return JSON.stringify({ source, name, files: extraFiles });
};

const dirModules = (dir: string, exclude: string): Record<string, string> =>
  Object.fromEntries(
    fs
      .readdirSync(dir)
      .filter((f) => f !== exclude && f.endsWith('.ashfox'))
      .map((f) => [f, fs.readFileSync(path.join(dir, f), 'utf8')]),
  );

const foxMods = dirModules(path.dirname(fox), 'fox.ashfox');
const cottageMods = {
  'module/furnishings.ashfox': fs.readFileSync(
    path.join(root, 'examples/structure/assets/module/furnishings.ashfox'),
    'utf8',
  ),
  'models/props/wall_lantern.ashfox': fs.readFileSync(
    path.join(root, 'examples/structure/assets/models/props/wall_lantern.ashfox'),
    'utf8',
  ),
  'models/props/rune_pillar.ashfox': fs.readFileSync(
    path.join(root, 'examples/structure/assets/models/props/rune_pillar.ashfox'),
    'utf8',
  ),
  'models/props/hanging_sign.ashfox': fs.readFileSync(
    path.join(root, 'examples/structure/assets/models/props/hanging_sign.ashfox'),
    'utf8',
  ),
};
const swordMods = {
  'module/shared.ashfox': fs.readFileSync(
    path.join(root, 'examples/items/assets/module/shared.ashfox'),
    'utf8',
  ),
};

const renderPreview = (
  entryPath: string,
  body: string,
  files: Record<string, string>,
  name = path.basename(entryPath),
) =>
  success(
    run(['render', '--input-json', '--view', 'v'], {
      input: withPreview(entryPath, body, files, name),
    }),
  );

const verifyStructureCutaway = () => {
  const name = 'structures/medieval_cottage.ashfox';
  const full = renderPreview(cottage, 'width = 160; height = 128;', cottageMods, name);
  png(full, 160, 128);
  const cut = renderPreview(cottage, 'cutaway = 4; width = 160; height = 128;', cottageMods, name);
  png(cut, 160, 128);
  assert.notDeepEqual(full, cut);

  const ext = renderPreview(
    cottage,
    'sheet = exterior; width = 240; height = 180;',
    cottageMods,
    name,
  );
  png(ext, 240, 180);
  const cutSheet = renderPreview(
    cottage,
    'sheet = cutaway; width = 240; height = 180;',
    cottageMods,
    name,
  );
  png(cutSheet, 240, 180);
  const interior = renderPreview(
    cottage,
    'sheet = interior; width = 240; height = 180;',
    cottageMods,
    name,
  );
  png(interior, 240, 180);
  assert.notDeepEqual(ext, cutSheet);
  assert.notDeepEqual(ext, interior);

  const gif = renderPreview(
    cottage,
    'kind = gif; mode = turntable; width = 128; height = 96; duration = 0.25; fps = 4;',
    cottageMods,
    name,
  );
  assert.equal(gif.subarray(0, 6).toString(), 'GIF89a');
};

async function main() {
  const left = renderPreview(fox, 'camera = left; width = 160; height = 128;', foxMods);
  png(left, 160, 128);

  const isolated = path.join(temp, 'ashfox.cjs');
  fs.copyFileSync(cli, isolated);
  const cold = success(
    spawnSync(process.execPath, [isolated, 'render', '--input-json', '--view', 'v'], {
      cwd: temp,
      input: withPreview(fox, 'camera = left; width = 160; height = 128;', foxMods),
      timeout: 120000,
      maxBuffer: 64 * 1024 * 1024,
    }),
  );
  assert.deepEqual(
    cold,
    left,
    'The self-contained binary reproduces pixels in the same renderer profile',
  );
  fs.unlinkSync(isolated);

  const right = renderPreview(fox, 'camera = right; width = 160; height = 128;', foxMods);
  assert.notDeepEqual(left, right);

  const orbit = renderPreview(
    fox,
    'azimuth = 45; elevation = 20; background = transparent;',
    foxMods,
  );
  png(orbit, 640, 360);
  const idat = [];
  for (let offset = 8; offset < orbit.length;) {
    const length = orbit.readUInt32BE(offset);
    if (orbit.toString('ascii', offset + 4, offset + 8) === 'IDAT')
      idat.push(orbit.subarray(offset + 8, offset + 8 + length));
    offset += 12 + length;
  }
  assert.equal(orbit[25], 6);
  assert.equal(inflateSync(Buffer.concat(idat))[4], 0, 'Transparent corner retains alpha');

  const spritePayload = (body: string) =>
    JSON.stringify({
      source: fs.readFileSync(sword, 'utf8').replace(/(\}\s*)$/, `  preview v {\n${body}\n  }\n$1`),
      name: 'sprites/iron_sword.ashfox',
      files: swordMods,
    });
  const sprite = success(
    run(['render', '--input-json', '--view', 'v'], {
      input: spritePayload('scale = 16; background = checker;'),
    }),
  );
  png(sprite, 512, 512);
  const stage = success(
    run(['render', '--input-json', '--view', 'v'], {
      input: spritePayload('stage = silhouette; scale = 16; background = checker;'),
    }),
  );
  assert.notDeepEqual(sprite, stage);

  for (const retired of [
    ['render', fox, '--camera', 'left'],
    ['render', fox, '--gif'],
    ['render', sword, '--scale', '12'],
    ['render', cottage, '--cutaway', '4'],
    ['render', '--stdin', '--input-format', 'png'],
    ['render', 'fake.png'],
  ]) {
    assert.equal(run(retired).status, 2, `${retired.join(' ')} must exit 2`);
  }
  assert.equal(run(['render', fox, '--view', 'nonexistent']).status, 2);

  const gif = renderPreview(
    fox,
    'kind = gif; clip = "tail_wag"; duration = 0.5; fps = 4; width = 160; height = 128;',
    foxMods,
  );
  assert.equal(gif.subarray(0, 6).toString(), 'GIF89a');

  const build = renderPreview(marker, 'kind = gif; mode = build;', {});
  assert.equal(build.subarray(0, 6).toString(), 'GIF89a');

  const badClip = run(['render', '--input-json', '--view', 'v'], {
    input: withPreview(fox, 'clip = "nonexistent";', foxMods),
  });
  assert.notEqual(badClip.status, 0);
  assert.equal(badClip.stdout.length, 0);

  const noBrowser = run(['render', fox], {
    env: { ...process.env, ASHFOX_CHROME_PATH: '/not/a/browser' },
  });
  assert.notEqual(noBrowser.status, 0);
  assert.equal(noBrowser.stdout.length, 0);

  const wave = renderPreview(sound, 'width = 320; height = 128;', {});
  png(wave, 320, 128);

  const longRender = spawn(process.execPath, [cli, 'render', '--input-json', '--view', 'v'], {
    cwd: temp,
    stdio: ['pipe', 'ignore', 'pipe'],
  });
  longRender.stdin.end(
    withPreview(fox, 'kind = gif; clip = "idle"; duration = 10; fps = 30;', foxMods),
  );
  await new Promise((resolve) => setTimeout(resolve, 150));
  longRender.kill('SIGINT');
  const cancelCode = await new Promise<number | null>((resolve) =>
    longRender.once('exit', (code) => resolve(code)),
  );
  assert.notEqual(cancelCode, 0);

  const sheetTurnaround = renderPreview(
    fox,
    'sheet = turnaround; width = 320; height = 320;',
    foxMods,
  );
  png(sheetTurnaround, 320, 320);
  const sheetInspect = renderPreview(fox, 'sheet = inspect; width = 320; height = 320;', foxMods);
  png(sheetInspect, 320, 320);
  assert.notDeepEqual(sheetTurnaround, sheetInspect);

  verifyStructureCutaway();
  assert.deepEqual(fs.readdirSync(temp), [], 'No implicit asset files or workspace');
  fs.writeFileSync('/tmp/ashfox-observer-fox.png', orbit);
  fs.writeFileSync('/tmp/ashfox-observer-sword.png', sprite);
  fs.writeFileSync('/tmp/ashfox-observer-motion.gif', gif);
  fs.writeFileSync('/tmp/ashfox-observer-wave.png', wave);
  console.log(
    'Real headless renders: preview --view (still/gif/sheet/stage/cutaway/waveform), retired flags and cancellation passed',
  );
}
main()
  .finally(() => fs.rmSync(temp, { recursive: true, force: true }))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
