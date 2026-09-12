'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { starterFiles } = require('./starter');
const projectFiles = root => {
  const files = {};
  for (const [name, source] of Object.entries(starterFiles(root))) {
    if (name === 'marker.ashfox') continue;
    const group = ['sword.ashfox', 'shared.ashfox'].includes(name) ? 'items' : name === 'claw_hit.ashfox' ? 'sounds' : 'creatures/fox';
    files[`asset/${group}/${name}`] = source;
  }
  for (const name of ['.ashfoxworkspace.mjs', 'assets.mjs', 'README.md', '.gitignore']) {
    files[name] = fs.readFileSync(path.join(root, 'scripts/release/project', name), 'utf8');
  }
  return files;
};
module.exports = { projectFiles };
