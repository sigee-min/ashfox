'use strict';

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const output = path.join(root, 'assets/showcase/shared-creatures');
const cli = path.join(root, 'apps/cli/dist/ashfox.cjs');
const sources = {
  griffin: 'examples/griffin/workbench/main.ashfox',
  fox: 'examples/fox/creatures/fox.ashfox',
  goblin: 'examples/goblin/creatures/goblin.ashfox'
};
const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'ashfox-showcase-'));
const run = args => execFileSync(process.execPath, [cli, ...args], {
  cwd: root, maxBuffer: 32 * 1024 * 1024, timeout: 120_000
});
const movie = name => execFileSync(process.env.ASHFOX_FFMPEG_PATH || 'ffmpeg', [
  '-v', 'error', '-y', '-i', path.join(stage, `${name}.gif`), '-an',
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-movflags', '+faststart',
  path.join(stage, `${name}.mp4`)
], { timeout: 120_000 });
try {
  const published = [];
  for (const [name, source] of Object.entries(sources)) {
    const view = ['--width', '640', '--height', '360', '--environment', 'studio'];
    run(['capture', source, ...view, '--output', path.join(stage, `${name}-poster.png`)]);
    run(['replay', source, ...view, '--mode', 'build', '--output', path.join(stage, `${name}-build-replay.gif`)]);
    movie(`${name}-build-replay`);
    published.push(`${name}-poster.png`, `${name}-build-replay.gif`, `${name}-build-replay.mp4`);
    const asset = JSON.parse(run(['inspect', source]).toString());
    for (const clip of asset.animations) {
      const file = `${name}-${clip.name}`;
      run(['replay', source, ...view, '--clip', clip.name, '--duration', String(clip.durationSeconds),
        '--fps', '10', '--output', path.join(stage, `${file}.gif`)]);
      movie(file);
      published.push(`${file}.mp4`);
    }
    console.log(`CLI showcase rendered: ${name}`);
  }
  fs.mkdirSync(output, { recursive: true });
  for (const file of published) fs.copyFileSync(path.join(stage, file), path.join(output, file));
  execFileSync(process.execPath, [path.join(__dirname, 'verify.js'), '--write'], { cwd: root, stdio: 'inherit' });
} finally {
  fs.rmSync(stage, { recursive: true, force: true });
}
