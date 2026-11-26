import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import { encodeCanonicalPng, rasterizeCanonicalTexture } from '../../src';
import {
  encodeCanonicalPngSummary,
  encodeCanonicalPngWithDigest,
} from '../../src/textures/textureRecipe/png';

const crc = (bytes: Uint8Array): number => {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  }
  return (value ^ 0xffffffff) >>> 0;
};

const unfilterSub = (raw: Uint8Array, width: number, height: number, bpp: number): Uint8Array => {
  const rowBytes = width * bpp;
  const stride = rowBytes + 1;
  assert.equal(raw.length, stride * height);
  const pixels = new Uint8Array(rowBytes * height);
  for (let row = 0; row < height; row += 1) {
    const inBase = row * stride;
    const outBase = row * rowBytes;
    assert.equal(raw[inBase], 1, 'Canonical PNG scanlines must use Filter-1 Sub');
    for (let x = 0; x < rowBytes; x += 1) {
      const left = x >= bpp ? pixels[outBase + x - bpp]! : 0;
      pixels[outBase + x] = (raw[inBase + 1 + x]! + left) & 0xff;
    }
  }
  return pixels;
};

const decodeIndexedRgba = (
  indices: Uint8Array,
  plte: Uint8Array,
  trns: Uint8Array | undefined,
): Uint8Array => {
  const rgba = new Uint8Array(indices.length * 4);
  for (let p = 0; p < indices.length; p += 1) {
    const idx = indices[p]!;
    rgba[p * 4] = plte[idx * 3]!;
    rgba[p * 4 + 1] = plte[idx * 3 + 1]!;
    rgba[p * 4 + 2] = plte[idx * 3 + 2]!;
    rgba[p * 4 + 3] = trns && idx < trns.length ? trns[idx]! : 255;
  }
  return rgba;
};

const verifyPngRoundTrip = (
  width: number,
  height: number,
  raster: ReturnType<typeof rasterizeCanonicalTexture>,
  expectedColorType: 3 | 6,
): Uint8Array => {
  const png = encodeCanonicalPng(raster);
  assert.deepEqual(Array.from(png.subarray(0, 8)), [137, 80, 78, 71, 13, 10, 26, 10]);
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const types: string[] = [];
  let colorType = -1;
  let plte: Uint8Array | undefined;
  let trns: Uint8Array | undefined;
  let idat: Uint8Array | undefined;
  let offset = 8;
  while (offset < png.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(...png.subarray(offset + 4, offset + 8));
    const data = png.subarray(offset + 8, offset + 8 + length);
    types.push(type);
    assert.equal(
      view.getUint32(offset + 8 + length),
      crc(png.subarray(offset + 4, offset + 8 + length)),
    );
    if (type === 'IHDR') {
      assert.equal(view.getUint32(offset + 8), width);
      assert.equal(view.getUint32(offset + 12), height);
      colorType = data[9]!;
      assert.equal(colorType, expectedColorType);
    } else if (type === 'PLTE') plte = data;
    else if (type === 'tRNS') trns = data;
    else if (type === 'IDAT') idat = data;
    offset += length + 12;
  }
  assert.equal(offset, png.length);
  assert.equal(types[0], 'IHDR');
  assert.equal(types[types.length - 1], 'IEND');
  assert.ok(idat);
  const raw = inflateSync(idat);
  const pixels = unfilterSub(raw, width, height, colorType === 3 ? 1 : 4);
  const recovered = colorType === 3 ? decodeIndexedRgba(pixels, plte!, trns) : pixels;
  assert.deepEqual(recovered, raster.rgba.copy());
  return png;
};

const makeSpec = (width: number, height: number, seed: number) => ({
  background: '#81a5f9',
  backgroundAlpha: 255 as const,
  canvasDetails: [
    {
      id: 'stripe',
      x: 0,
      y: 0,
      width: Math.min(3, width),
      height,
      color: '#ff0011',
      alpha: 255 as const,
    },
    {
      id: 'band',
      x: 0,
      y: Math.floor(height / 2),
      width,
      height: Math.min(4, height - Math.floor(height / 2)),
      color: seed % 2 === 0 ? '#33aa55' : '#aa5533',
      alpha: 255 as const,
    },
    {
      id: 'corner',
      x: width - 1,
      y: height - 1,
      width: 1,
      height: 1,
      color: '#123456',
      alpha: 0 as const,
    },
  ],
  alphaMasks: [],
});

for (const [width, height] of [
  [1, 1],
  [16, 16],
  [32, 32],
  [64, 254],
  [64, 255],
  [64, 256],
  [255, 256],
  [256, 256],
  [512, 512],
] as const) {
  const rasterA = rasterizeCanonicalTexture(width, height, makeSpec(width, height, width));
  const rasterB = rasterizeCanonicalTexture(width, height, makeSpec(width, height, width));
  const expectedType = width * height >= 2048 ? 3 : 6;
  const pngA = verifyPngRoundTrip(width, height, rasterA, expectedType);
  const pngB = verifyPngRoundTrip(width, height, rasterB, expectedType);
  const hashA = createHash('sha256').update(pngA).digest('hex');
  const hashB = createHash('sha256').update(pngB).digest('hex');
  assert.equal(hashA, hashB, `PNG encoding for ${width}x${height} must be byte-deterministic`);
  const withDigest = encodeCanonicalPngWithDigest(rasterA);
  const summary = encodeCanonicalPngSummary(rasterA);
  assert.deepEqual(withDigest.bytes, pngA);
  assert.equal(withDigest.digest, summary.contentHash);
  assert.equal(summary.byteLength, pngA.length);
  if (width >= 64 && height >= 64) {
    const rawBytes = width * height * 4;
    const ratio = rawBytes / pngA.length;
    assert.ok(
      ratio >= 10,
      `Expected >= 10x compression on ${width}x${height} pixel-art, got ${ratio.toFixed(2)}x`,
    );
  }
}

// >256-color RGBA8 fallback test + high-entropy stress test
const richDetails = Array.from({ length: 300 }, (_, i) => ({
  id: `r_${i}`,
  x: (i % 20) * 6,
  y: Math.floor(i / 20) * 8,
  width: 6,
  height: 8,
  color: `#${((i * 19) & 0xff).toString(16).padStart(2, '0')}${((i * 47) & 0xff).toString(16).padStart(2, '0')}${((i * 83) & 0xff).toString(16).padStart(2, '0')}`,
  alpha: (i % 7 === 0 ? 0 : 255) as 0 | 255,
}));
const richRaster = rasterizeCanonicalTexture(128, 128, {
  background: '#223344',
  backgroundAlpha: 255,
  canvasDetails: richDetails,
  alphaMasks: [],
});
const richPng = verifyPngRoundTrip(128, 128, richRaster, 6);
assert.ok(
  (128 * 128 * 4) / richPng.length >= 8,
  'Expected >= 8x compression on >256-color pattern',
);

console.log(
  'canonical compressed PNG: Filter-1 Sub, PLTE+tRNS/RGBA8, LZ77 + Fixed Huffman, determinism & >=10x reduction pass',
);
