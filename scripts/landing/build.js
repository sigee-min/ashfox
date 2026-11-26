'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { buildSync } = require('esbuild');
const root = path.resolve(__dirname, '../..');
const out = path.join(root, 'dist/landing');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
const cli = path.join(root, 'apps/cli/dist/ashfox.cjs');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ashfox-landing-'));
try {
  fs.cpSync(path.join(root, 'examples/griffin'), path.join(temp, 'griffin'), { recursive: true });
  fs.cpSync(path.join(root, 'examples/items'), path.join(temp, 'items'), { recursive: true });
  fs.cpSync(path.join(root, 'examples/sounds'), path.join(temp, 'sounds'), { recursive: true });
  const buildTarget = (rel) =>
    JSON.parse(
      execFileSync(process.execPath, [cli, 'build', path.join(temp, rel), '--json'], {
        cwd: temp,
        encoding: 'utf8',
        maxBuffer: 32 * 1024 * 1024,
      }),
    ).result;
  const griffinBuilt = buildTarget('griffin/workbench/main.ashfox');
  fs.copyFileSync(
    path.join(griffinBuilt.exports[0].directory, 'griffin.glb'),
    path.join(out, 'griffin.glb'),
  );
  const itemsBuilt = buildTarget('items/.ashfoxworkspace');
  const swordDir = itemsBuilt.exports.find((entry) => entry.id === 'iron_sword').directory;
  fs.copyFileSync(path.join(swordDir, 'iron_sword.png'), path.join(out, 'sword.png'));
  const amethystDir = itemsBuilt.exports.find((entry) => entry.id === 'amethyst').directory;
  fs.copyFileSync(path.join(amethystDir, 'amethyst.png'), path.join(out, 'amethyst.png'));
  const soundsBuilt = buildTarget('sounds/.ashfoxworkspace');
  const birdDir = soundsBuilt.exports.find((entry) => entry.id === 'bird_call').directory;
  for (const variant of ['base', 'alternate']) {
    fs.copyFileSync(
      path.join(birdDir, 'bird_call', `${variant}.wav`),
      path.join(out, `bird-${variant}.wav`),
    );
  }
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
buildSync({
  entryPoints: [path.join(root, 'scripts/landing/viewer.js')],
  outfile: path.join(out, 'hero.js'),
  bundle: true,
  minify: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
});

for (const variant of ['base', 'alternate']) {
  const wav = fs.readFileSync(path.join(out, `bird-${variant}.wav`));
  const count = (wav.length - 44) / 2;
  const peaks = Array.from({ length: 120 }, (_, i) => {
    let peak = 0;
    for (
      let sample = Math.floor((i * count) / 120);
      sample < Math.floor(((i + 1) * count) / 120);
      sample++
    )
      peak = Math.max(peak, Math.abs(wav.readInt16LE(44 + sample * 2)) / 32768);
    return peak;
  });
  // Normalize the display to reveal articulation without changing audio gain.
  const maximum = Math.max(...peaks, 1e-8);
  const bars = peaks
    .map((peak, i) => {
      const height = Math.max(2, (peak / maximum) * 128);
      return `<rect x="${i * 4}" y="${80 - height / 2}" width="2" height="${height}" fill="#ee9e5e"/>`;
    })
    .join('');
  fs.writeFileSync(
    path.join(out, `bird-${variant}.svg`),
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 160">${bars}</svg>`,
  );
}
