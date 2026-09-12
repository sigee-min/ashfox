'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { buildSync } = require('esbuild');
const root = path.resolve(__dirname, '../..');
const out = path.join(root, 'dist/landing');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
const cli = path.join(root, 'apps/cli/dist/ashfox.cjs');
for (const [name, source, args] of [
  ['griffin.glb', 'examples/griffin/workbench/main.ashfox', []],
  ['sword.png', 'examples/items/src/iron_sword.ashfox', []],
  ['amethyst.png', 'examples/items/src/amethyst.ashfox', []],
  ['bird-base.wav', 'examples/sounds/src/bird_call.ashfox', ['--variant', 'base']],
  ['bird-alternate.wav', 'examples/sounds/src/bird_call.ashfox', ['--variant', 'alternate']]
]) fs.writeFileSync(path.join(out, name), execFileSync(process.execPath, [cli, 'export', source, ...args], { cwd: root, maxBuffer: 32 * 1024 * 1024 }));
buildSync({ entryPoints: [path.join(root, 'scripts/landing/viewer.js')], outfile: path.join(out, 'hero.js'), bundle: true, minify: true, format: 'iife', platform: 'browser', target: 'es2022' });

for (const variant of ['base', 'alternate']) {
  const wav = fs.readFileSync(path.join(out, `bird-${variant}.wav`));
  const count = (wav.length - 44) / 2;
  const peaks = Array.from({ length: 120 }, (_, i) => {
    let peak = 0;
    for (let sample = Math.floor(i * count / 120); sample < Math.floor((i + 1) * count / 120); sample++) peak = Math.max(peak, Math.abs(wav.readInt16LE(44 + sample * 2)) / 32768);
    return peak;
  });
  // Normalize the display to reveal articulation without changing audio gain.
  const maximum = Math.max(...peaks, 1e-8);
  const bars = peaks.map((peak, i) => {
    const height = Math.max(2, peak / maximum * 128);
    return `<rect x="${i * 4}" y="${80 - height / 2}" width="2" height="${height}" fill="#ee9e5e"/>`;
  }).join('');
  fs.writeFileSync(path.join(out, `bird-${variant}.svg`), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 160">${bars}</svg>`);
}
