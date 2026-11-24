import assert from 'node:assert/strict';

import { applyTextureOps, parseHexColor } from '../../src/domain/texturePaint';

const width = 4;
const height = 4;
const data = new Uint8ClampedArray(width * height * 4);
const result = applyTextureOps(
  data,
  width,
  height,
  [
    {
      op: 'fill_rect',
      x: 0,
      y: 0,
      width,
      height,
      color: '#7f9a56',
    },
  ],
  parseHexColor,
);

assert.equal(result.ok, true);
for (let index = 0; index < data.length; index += 4) {
  assert.deepEqual(
    [...data.slice(index, index + 4)],
    [127, 154, 86, 255],
    'fill_rect must preserve the explicit source color',
  );
}
