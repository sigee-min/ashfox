'use strict';
const fs = require('node:fs');
const path = require('node:path');
const starterFiles = (root) => {
  const files = {};
  const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
  for (const [name, source] of Object.entries({
    'assets/models/red_fox.ashfox': 'showcase/assets/models/red_fox.ashfox',
    'assets/module/fox/fox_fur.ashfox': 'showcase/assets/module/fox/fox_fur.ashfox',
    'assets/models/wall_lantern.ashfox': 'showcase/assets/models/wall_lantern.ashfox',
    'assets/models/rune_bricks.ashfox': 'showcase/assets/models/rune_bricks.ashfox',
    'assets/sprites/iron_sword.ashfox': 'showcase/assets/sprites/iron_sword.ashfox',
    'assets/sounds/claw_hit.ashfox': 'showcase/assets/sounds/claw_hit.ashfox',
    'assets/structures/blacksmith.ashfox': 'showcase/assets/structures/blacksmith.ashfox',
  })) {
    files[name] = read(source);
  }
  return files;
};
module.exports = { starterFiles };
