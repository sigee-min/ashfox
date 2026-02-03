import assert from 'node:assert/strict';

import { collectPlanCreateConflicts } from '../../src/proxy/texturePipeline/planConflicts';

const planNames = new Set(['pot_tex', 'pot_tex_part2']);

{
  const conflicts = collectPlanCreateConflicts({
    planTextureNames: planNames,
    textures: [
      { name: 'pot_tex', width: 16, height: 16 },
      { name: 'other', width: 16, height: 16 }
    ],
    presets: [
      { preset: 'wood', name: 'pot_tex_part2', width: 16, height: 16 }
    ]
  });
  assert.deepEqual(conflicts.sort(), ['pot_tex', 'pot_tex_part2']);
}

{
  const conflicts = collectPlanCreateConflicts({
    planTextureNames: planNames,
    textures: [
      { mode: 'update', targetName: 'pot_tex', width: 16, height: 16 }
    ]
  });
  assert.deepEqual(conflicts, ['pot_tex']);
}
