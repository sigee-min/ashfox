'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { sha256 } = require('../shared');
const root = path.resolve(__dirname, '../..'),
  cli = path.join(root, 'apps/cli/dist/ashfox.cjs'),
  out = path.join(root, 'assets/docs');
fs.mkdirSync(out, { recursive: true });
const fox = 'showcase/assets/models/red_fox.ashfox',
  foxFur = 'showcase/assets/module/fox/fox_fur.ashfox',
  sword = 'showcase/assets/sprites/iron_sword.ashfox',
  sound = 'showcase/assets/sounds/claw_hit.ashfox';
const injectPreview = (source, body) =>
  source
    .replaceAll('"fox_fur/fur"', '"./fox_fur.ashfox"')
    .replace(/(\}\s*)$/, `  preview doc {\n${body}\n  }\n$1`);

const jobs = {
  'fox-front.png': { entry: fox, preview: 'camera = front; width = 480; height = 320;' },
  'fox-angle.png': {
    entry: fox,
    preview: 'azimuth = 45; elevation = 20; width = 480; height = 320;',
  },
  'sword.png': { entry: sword, preview: 'scale = 12; background = checker;' },
  'sword-shape.png': {
    entry: sword,
    preview: 'stage = silhouette; scale = 12; background = checker;',
  },
  'claw-wave.png': { entry: sound, preview: 'width = 480; height = 160;' },
  'fox-motion.gif': {
    entry: fox,
    preview: 'kind = gif; clip = "tail_wag"; width = 320; height = 240; fps = 6;',
  },
};

const files = [];
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ashfox-doc-media-'));
try {
  fs.copyFileSync(path.join(root, foxFur), path.join(temp, 'fox_fur.ashfox'));
  for (const [name, job] of Object.entries(jobs)) {
    const staged = path.join(temp, `${name}.ashfox`);
    const outPath = path.join(out, name);
    fs.rmSync(outPath, { force: true });
    fs.writeFileSync(
      staged,
      injectPreview(fs.readFileSync(path.join(root, job.entry), 'utf8'), `    ${job.preview}`),
    );
    execFileSync(process.execPath, [cli, 'render', staged, '--view', 'doc', '--output', outPath], {
      cwd: root,
      maxBuffer: 64 * 1024 * 1024,
      timeout: 150000,
    });
    const bytes = fs.readFileSync(outPath);
    files.push({ name, args: [job.entry, job.preview], sha256: sha256(bytes) });
  }
  const soundInput = path.join(temp, 'claw_hit.ashfox');
  fs.copyFileSync(path.join(root, sound), soundInput);
  const built = JSON.parse(
    execFileSync(process.execPath, [cli, 'build', soundInput, '--json'], {
      cwd: temp,
      encoding: 'utf8',
    }),
  ).result;
  const wav = fs.readFileSync(path.join(built.exports[0].directory, 'claw_hit/base.wav'));
  fs.writeFileSync(path.join(out, 'claw.wav'), wav);
  files.push({ name: 'claw.wav', args: ['build', sound], sha256: sha256(wav) });
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
fs.writeFileSync(
  path.join(out, 'receipt.json'),
  JSON.stringify(
    {
      format: 'ashfox-doc-media',
      version: 1,
      compiler: sha256(fs.readFileSync(cli)),
      sources: [fox, foxFur, sword, sound].map((file) => ({
        file,
        sha256: sha256(fs.readFileSync(path.join(root, file))),
      })),
      files,
    },
    null,
    2,
  ) + '\n',
);
process.stdout.write('Guide images, motion and sound generated from native sources\n');
