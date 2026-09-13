import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import { encodeCanonicalPng, rasterizeCanonicalTexture } from '../../src';

// Captured from the original canonical encoder before changing its allocation strategy.
const cases: readonly (readonly [number, number, string])[] = [
  [1, 1, 'e8ed50a9afe463ea54a0e709c0a7e3e32f09d16cce7272f2b4ce4a6f027b6cfa'],
  [64, 254, 'da08fe84838f92eaf0715ef90b313889a8bd04a2ad41d6d1a45b45d344646844'],
  [64, 255, 'a8ee29702206027fcd310033511d1c293f3673d79e9c3886f13ddf8143f4eb3c'],
  [64, 256, 'a1f29b0e7a953223c62b0c951c1ac6838325bdd5afc395026bc00ded2b0d9f3f'],
  [255, 256, 'd9b789d9dae0cd8310f2020bf7673203d81bd62fcfca9a9d1eb244dde239be6a'],
  [256, 256, '6f7d8a3b0cf4a5cc885cfba32ceaf602cfa31a1093b104989a10a63f7e0c772f'],
  [512, 512, '4722cd7ab984e73d8837442036e6e76d720caee7c6d02f062fb06fe7daae8246'],
];
const crc = (bytes: Uint8Array): number => {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  }
  return (value ^ 0xffffffff) >>> 0;
};
for (const [width, height, expectedHash] of cases) {
  const raster = rasterizeCanonicalTexture(width, height, {
    background: '#81a5f9', backgroundAlpha: 255,
    canvasDetails: [
      { id: 'stripe', x: 0, y: 0, width: Math.min(3, width), height, color: '#ff0011', alpha: 255 },
      { id: 'corner', x: width - 1, y: height - 1, width: 1, height: 1, color: '#123456', alpha: 0 }
    ], alphaMasks: []
  });
  const png = encodeCanonicalPng(raster);
  assert.equal(createHash('sha256').update(png).digest('hex'), expectedHash);
  assert.deepEqual(Array.from(png.subarray(0, 8)), [137, 80, 78, 71, 13, 10, 26, 10]);
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const types: string[] = [];
  let offset = 8;
  while (offset < png.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(...png.subarray(offset + 4, offset + 8));
    const data = png.subarray(offset + 8, offset + 8 + length);
    types.push(type);
    assert.equal(view.getUint32(offset + 8 + length), crc(png.subarray(offset + 4, offset + 8 + length)));
    if (type === 'IHDR') {
      assert.equal(view.getUint32(offset + 8), width);
      assert.equal(view.getUint32(offset + 12), height);
    }
    if (type === 'IDAT') {
      const raw = inflateSync(data); // Independently checks DEFLATE framing and Adler-32.
      const stride = width * 4 + 1, rgba = raster.rgba.copy();
      assert.equal(raw.length, stride * height);
      for (let row = 0; row < height; row++) {
        assert.equal(raw[row * stride], 0);
        assert.deepEqual(new Uint8Array(raw.subarray(row * stride + 1, (row + 1) * stride)),
          rgba.subarray(row * width * 4, (row + 1) * width * 4));
      }
      let block = 2, written = 0;
      while (block < data.length - 4) {
        const final = data[block]!, length = data[block + 1]! | (data[block + 2]! << 8);
        const complement = data[block + 3]! | (data[block + 4]! << 8);
        assert.equal(length ^ complement, 65535);
        written += length;
        assert.equal(final, written === raw.length ? 1 : 0);
        if (!final) assert.equal(length, 65535);
        block += length + 5;
      }
      assert.equal(block, data.length - 4);
      assert.equal(written, raw.length);
    }
    offset += length + 12;
  }
  assert.equal(offset, png.length);
  assert.deepEqual(types, ['IHDR', 'IDAT', 'IEND']);
}
console.log('canonical PNG: original bytes, independent inflate/CRC, row and stored-block boundaries pass');
