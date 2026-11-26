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
const fox = 'examples/fox/creatures/fox.ashfox',
  sword = 'examples/items/assets/sprites/iron_sword.ashfox',
  shared = 'examples/items/assets/module/shared.ashfox',
  sound = 'examples/sounds/assets/sounds/claw_hit.ashfox';
const injectPreview = (source, body) =>
  source.replace(/(\}\s*)$/, `  preview doc {\n${body}\n  }\n$1`);
const foxFiles = {
  'rig.ashfox': fs.readFileSync(path.join(root, 'examples/fox/creatures/rig.ashfox'), 'utf8'),
  'surface.ashfox': fs.readFileSync(
    path.join(root, 'examples/fox/creatures/surface.ashfox'),
    'utf8',
  ),
  'body.ashfox': fs.readFileSync(path.join(root, 'examples/fox/creatures/body.ashfox'), 'utf8'),
};
const spriteFiles = {
  'module/shared.ashfox': fs.readFileSync(path.join(root, shared), 'utf8'),
};
const jobs = {
  'fox-front.png': {
    entry: fox,
    name: 'fox.ashfox',
    files: foxFiles,
    preview: 'camera = front; width = 480; height = 320;',
  },
  'fox-angle.png': {
    entry: fox,
    name: 'fox.ashfox',
    files: foxFiles,
    preview: 'azimuth = 45; elevation = 20; width = 480; height = 320;',
  },
  'sword.png': {
    entry: sword,
    name: 'sprites/iron_sword.ashfox',
    files: spriteFiles,
    preview: 'scale = 12; background = checker;',
  },
  'sword-shape.png': {
    entry: sword,
    name: 'sprites/iron_sword.ashfox',
    files: spriteFiles,
    preview: 'stage = silhouette; scale = 12; background = checker;',
  },
  'claw-wave.png': {
    entry: sound,
    name: 'claw_hit.ashfox',
    files: {},
    preview: 'width = 480; height = 160;',
  },
  'fox-motion.gif': {
    entry: fox,
    name: 'fox.ashfox',
    files: foxFiles,
    preview: 'kind = gif; clip = "tail_wag"; width = 320; height = 240; fps = 6;',
  },
};
const files = [];
for (const [name, job] of Object.entries(jobs)) {
  const payload = JSON.stringify({
    source: injectPreview(
      fs.readFileSync(path.join(root, job.entry), 'utf8'),
      `    ${job.preview}`,
    ),
    name: job.name,
    files: job.files,
  });
  const args = ['render', '--input-json', '--view', 'doc'];
  const bytes = execFileSync(process.execPath, [cli, ...args], {
    input: payload,
    cwd: root,
    maxBuffer: 64 * 1024 * 1024,
    timeout: 150000,
  });
  fs.writeFileSync(path.join(out, name), bytes);
  files.push({ name, args: [job.entry, job.preview], sha256: sha256(bytes) });
}
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ashfox-doc-sound-'));
try {
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
      sources: [
        fox,
        'examples/fox/creatures/rig.ashfox',
        'examples/fox/creatures/surface.ashfox',
        'examples/fox/creatures/body.ashfox',
        sword,
        sound,
        shared,
      ].map((file) => ({ file, sha256: sha256(fs.readFileSync(path.join(root, file))) })),
      files,
    },
    null,
    2,
  ) + '\n',
);
process.stdout.write('Guide images, motion and sound generated from native sources\n');
