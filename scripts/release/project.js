'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { starterFiles } = require('./starter');
const projectFiles = (root) => {
  const files = {};
  const standaloneExtras = new Set([
    'assets/models/marker.ashfox',
    'assets/models/lantern.ashfox',
    'assets/models/rune_bricks.ashfox',
  ]);
  for (const [name, source] of Object.entries(starterFiles(root))) {
    if (standaloneExtras.has(name)) continue;
    files[name] = source;
  }
  for (const name of ['.ashfoxworkspace.mjs', 'assets.mjs', 'README.md', '.gitignore']) {
    files[name] = fs.readFileSync(path.join(root, 'scripts/release/project', name), 'utf8');
  }
  return files;
};
module.exports = { projectFiles };
