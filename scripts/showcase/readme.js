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
  fs.cpSync(path.join(root, 'examples/items'), path.join(temp, 'items'), { recursive: true });
  for (const [name, source] of [
    ['sword', 'iron_sword'],
    ['amethyst', 'amethyst'],
  ]) {
    const input = path.join(temp, `items/assets/sprites/${source}.ashfox`);
    const built = JSON.parse(
      execFileSync(process.execPath, [cli, 'build', input, '--json'], {
        cwd: temp,
        encoding: 'utf8',
      }),
    ).result;
    fs.copyFileSync(
      path.join(built.exports[0].directory, `${source}.png`),
      path.join(out, `${name}.png`),
    );
    if (name === 'amethyst') {
      const raw = fs.readFileSync(input, 'utf8');
      const injected = raw.replace(
        /(\}\s*)$/,
        '  preview readme { scale = 12; background = checker; }\n$1',
      );
      const payload = JSON.stringify({
        source: injected,
        name: `sprites/${source}.ashfox`,
        files: {
          'module/shared.ashfox': fs.readFileSync(
            path.join(temp, 'items/assets/module/shared.ashfox'),
            'utf8',
          ),
        },
      });
      fs.writeFileSync(
        path.join(out, 'amethyst-preview.png'),
        execFileSync(process.execPath, [cli, 'render', '--input-json', '--view', 'readme'], {
          input: payload,
          cwd: root,
          timeout: 120000,
        }),
      );
    }
  }
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
