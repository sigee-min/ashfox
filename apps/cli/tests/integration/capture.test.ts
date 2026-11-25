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
  sword = path.join(root, 'examples/items/src/iron_sword.ashfox');
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
async function main() {
  const left = success(
    run(['render', fox, '--camera', 'left', '--width', '160', '--height', '128']),
  );
  png(left, 160, 128);
  const isolated = path.join(temp, 'ashfox.cjs');
  fs.copyFileSync(cli, isolated);
  const cold = success(
    spawnSync(
      process.execPath,
      [isolated, 'render', fox, '--camera', 'left', '--width', '160', '--height', '128'],
      { cwd: temp, timeout: 120000, maxBuffer: 64 * 1024 * 1024 },
    ),
  );
  assert.deepEqual(
    cold,
    left,
    'The self-contained binary reproduces pixels in the same renderer profile',
  );
  fs.unlinkSync(isolated);
  const right = success(
    run(['render', fox, '--camera', 'right', '--width', '160', '--height', '128']),
  );
  assert.notDeepEqual(left, right);
  const orbit = success(
    run(['render', fox, '--azimuth', '45', '--elevation', '20', '--background', 'transparent']),
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
  const sprite = success(run(['render', sword, '--scale', '16', '--background', 'checker']));
  png(sprite, 256, 256);
  const stage = success(
    run(['render', sword, '--stage', 'silhouette', '--scale', '16', '--background', 'checker']),
  );
  assert.notDeepEqual(sprite, stage);
  const raw = success(run(['export', sword]));
  const fromStdin = success(
    run(['render', '--stdin', '--input-format', 'png', '--scale', '2'], { input: raw }),
  );
  png(fromStdin, 32, 32);
  const gif = success(
    run([
      'render',
      fox,
      '--gif',
      '--clip',
      'tail_wag',
      '--duration',
      '0.5',
      '--fps',
      '4',
      '--width',
      '160',
      '--height',
      '128',
    ]),
  );
  assert.equal(gif.subarray(0, 6).toString(), 'GIF89a');
  const build = success(
    run([
      'render',
      path.join(root, 'examples/minecraft/marker.ashfox'),
      '--gif',
      '--mode',
      'build',
    ]),
  );
  assert.equal(build.subarray(0, 6).toString(), 'GIF89a');
  const badSheetGif = run(['render', fox, '--gif', '--sheet', 'turnaround']);
  assert.notEqual(badSheetGif.status, 0);
  const bad = run(['render', fox, '--clip', 'nonexistent']);
  assert.notEqual(bad.status, 0);
  assert.equal(bad.stdout.length, 0);
  const noBrowser = run(['render', fox], {
    env: { ...process.env, ASHFOX_CHROME_PATH: '/not/a/browser' },
  });
  // Explicit invalid executable must fail, without searching another installation.
  assert.notEqual(noBrowser.status, 0);
  assert.equal(noBrowser.stdout.length, 0);
  const sound = path.join(root, 'examples/sounds/src/claw_hit.ashfox');
  const wave = success(run(['render', sound, '--width', '320', '--height', '128']));
  png(wave, 320, 128);
  const longRender = spawn(
    process.execPath,
    [cli, 'render', fox, '--gif', '--clip', 'idle', '--duration', '10', '--fps', '30'],
    { cwd: temp, stdio: ['ignore', 'ignore', 'pipe'] },
  );
  await new Promise((resolve) => setTimeout(resolve, 150));
  longRender.kill('SIGINT');
  const cancelCode = await new Promise<number | null>((resolve) =>
    longRender.once('exit', (code) => resolve(code)),
  );
  assert.notEqual(cancelCode, 0);
  const sheetTurnaround = success(
    run(['render', fox, '--sheet', 'turnaround', '--width', '320', '--height', '320']),
  );
  png(sheetTurnaround, 320, 320);
  const sheetInspect = success(
    run(['render', fox, '--sheet', 'inspect', '--width', '320', '--height', '320']),
  );
  png(sheetInspect, 320, 320);
  assert.notDeepEqual(sheetTurnaround, sheetInspect);
  assert.deepEqual(fs.readdirSync(temp), [], 'No implicit asset files or workspace');
  fs.writeFileSync('/tmp/ashfox-observer-fox.png', orbit);
  fs.writeFileSync('/tmp/ashfox-observer-sword.png', sprite);
  fs.writeFileSync('/tmp/ashfox-observer-motion.gif', gif);
  fs.writeFileSync('/tmp/ashfox-observer-wave.png', wave);
  console.log(
    'Real headless renders: camera/alpha, sprite stages, PNG stdin, motion/build GIF, waveform and cancellation passed',
  );
}
main()
  .finally(() => fs.rmSync(temp, { recursive: true, force: true }))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
