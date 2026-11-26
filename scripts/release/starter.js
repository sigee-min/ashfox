'use strict';
const fs = require('node:fs');
const path = require('node:path');
const starterFiles = (root) => {
  const files = {};
  const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
  const foxDir = path.join(root, 'examples/fox/creatures');
  for (const name of fs.readdirSync(foxDir).sort()) {
    if (name.endsWith('.ashfox'))
      files[`assets/models/fox/${name}`] = read(`examples/fox/creatures/${name}`);
  }
  for (const [name, source] of Object.entries({
    'assets/sprites/sword.ashfox': 'examples/items/assets/sprites/iron_sword.ashfox',
    'assets/module/shared.ashfox': 'examples/items/assets/module/shared.ashfox',
    'assets/sounds/claw_hit.ashfox': 'examples/sounds/assets/sounds/claw_hit.ashfox',
    'assets/models/marker.ashfox': 'examples/minecraft/assets/models/marker.ashfox',
    'assets/models/rune_bricks.ashfox': 'examples/block/rune_bricks.ashfox',
    'assets/models/lantern.ashfox': 'examples/prop/lantern.ashfox',
    'assets/module/furnishings.ashfox': 'examples/structure/furnishings.ashfox',
    'assets/models/props/wall_lantern.ashfox': 'examples/structure/props/wall_lantern.ashfox',
    'assets/models/props/rune_pillar.ashfox': 'examples/structure/props/rune_pillar.ashfox',
  })) {
    files[name] = read(source);
  }
  files['assets/structures/watchtower.ashfox'] = read('examples/structure/watchtower.ashfox')
    .replace('./furnishings.ashfox', '../module/furnishings.ashfox')
    .replaceAll('./props/', '../models/props/');
  return files;
};
module.exports = { starterFiles };
