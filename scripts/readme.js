'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const out = path.join(root, 'assets/readme');
fs.mkdirSync(out, { recursive: true });
const cli = path.join(root, 'apps/cli/dist/ashfox.cjs');
for (const [name, source] of [['sword', 'iron_sword'], ['amethyst', 'amethyst']]) {
  const input = path.join(root, `examples/items/src/${source}.ashfox`);
  fs.writeFileSync(path.join(out, `${name}.png`), execFileSync(process.execPath, [cli, 'export', input]));
  if (name === 'amethyst') fs.writeFileSync(path.join(out, 'amethyst-preview.png'), execFileSync(process.execPath,
    [cli, 'capture', input, '--scale', '12', '--background', 'checker'], { timeout: 120000 }));
}
