'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const out = path.join(root, 'assets/readme');
fs.mkdirSync(out, { recursive: true });
const cli = path.join(root, 'apps/cli/dist/ashfox.cjs');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ashfox-readme-'));
try {
  fs.cpSync(path.join(root, 'showcase'), path.join(temp, 'showcase'), { recursive: true });
  const built = JSON.parse(
    execFileSync(
      process.execPath,
      [cli, 'build', path.join(temp, 'showcase/.ashfoxworkspace'), '--json'],
      { cwd: temp, encoding: 'utf8' },
    ),
  ).result;
  for (const [name, source] of [
    ['sword', 'iron_sword'],
    ['ruby-potion', 'ruby_potion'],
  ]) {
    const input = path.join(temp, `showcase/assets/sprites/${source}.ashfox`);
    const exported = built.exports.find((entry) => entry.id === source);
    if (!exported) throw new Error(`Missing readme sprite export: ${source}`);
    fs.copyFileSync(path.join(exported.directory, `${source}.png`), path.join(out, `${name}.png`));
    if (name === 'ruby-potion') {
      const injected = fs
        .readFileSync(input, 'utf8')
        .replace(/(\}\s*)$/, '  preview readme { scale = 12; background = checker; }\n$1');
      const staged = path.join(temp, 'ruby_potion_readme.ashfox');
      fs.writeFileSync(staged, injected);
      execFileSync(
        process.execPath,
        [
          cli,
          'render',
          staged,
          '--view',
          'readme',
          '--output',
          path.join(out, 'ruby-potion-preview.png'),
        ],
        { cwd: root, timeout: 120000 },
      );
    }
  }
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
