'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { zipSync } = require('fflate');
const { compareText } = require('../shared');
const root = path.resolve(__dirname, '../..'),
  out = path.join(root, 'dist/docs-delivery');
fs.mkdirSync(out, { recursive: true });
require('../release/package').packageCli(root, out);
const sources = (directory) => {
  const result = {};
  const visit = (dir, prefix = '') => {
    for (const e of fs
      .readdirSync(dir, { withFileTypes: true })
      .sort((a, b) => compareText(a.name, b.name))) {
      if (['dist', 'build', 'exports', 'node_modules', '.ashfox', '.ashfox-cache'].includes(e.name))
        continue;
      const key = prefix + e.name;
      if (e.isDirectory()) visit(path.join(dir, e.name), key + '/');
      else if (e.isFile()) result[key] = fs.readFileSync(path.join(dir, e.name));
    }
  };
  visit(path.join(root, directory));
  return result;
};
const zip = (name, files) =>
  fs.writeFileSync(path.join(out, name), zipSync(files, { level: 9, mtime: new Date(1980, 0, 1) }));
const starter = Object.fromEntries(
  Object.entries(require('../release/starter').starterFiles(root)).map(([name, text]) => [
    name,
    Buffer.from(text),
  ]),
);
starter['package.json'] = Buffer.from('{"name":"my-ashfox-assets","private":true}\n');
zip('starter.zip', starter);
const showcaseFiles = sources('showcase');
for (const name of ['showcase', 'items', 'game-assets', 'resource-pack']) {
  zip(`${name}.zip`, showcaseFiles);
}
const webGame = {
  ...sources('scripts/docs/web-game'),
  ...Object.fromEntries(
    Object.entries(showcaseFiles).map(([filePath, bytes]) => [`assets/${filePath}`, bytes]),
  ),
};
zip('web-game.zip', webGame);
process.stdout.write('User downloads ready: ' + out + '\n');
