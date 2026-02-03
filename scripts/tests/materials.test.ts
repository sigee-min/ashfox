import assert from 'node:assert/strict';

import { resolveMaterialPreset } from '../../src/domain/materials';

{
  const clay = resolveMaterialPreset('clay');
  assert.equal(clay.preset, 'ceramic');
}

{
  const terracotta = resolveMaterialPreset('terracotta');
  assert.equal(terracotta.preset, 'ceramic');
}

{
  const pottery = resolveMaterialPreset('pottery');
  assert.equal(pottery.preset, 'ceramic');
}
