'use strict';
const fs = require('node:fs');
const path = require('node:path');
const starterFiles = root => {
  const files = {};
  const directory = path.join(root, 'examples/fox/creatures');
  for (const name of fs.readdirSync(directory).sort()) {
    if (name.endsWith('.ashfox')) files[name] = fs.readFileSync(path.join(directory, name), 'utf8');
  }
  for (const [name, source] of Object.entries({
    'sword.ashfox': 'examples/items/src/iron_sword.ashfox',
    'shared.ashfox': 'examples/items/src/shared.ashfox',
    'claw_hit.ashfox': 'examples/sounds/src/claw_hit.ashfox',
    'marker.ashfox': 'examples/minecraft/marker.ashfox'
  })) files[name] = fs.readFileSync(path.join(root, source), 'utf8');
  return files;
};
module.exports = { starterFiles };
