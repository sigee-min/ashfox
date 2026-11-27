import { encodeUtf8 } from '@ashfox/internal-contracts';
import { canonicalJsonString } from '../../canonicalJson';
import {
  SPRITE_POLICY,
  SpriteInputError,
  type SpriteDocument,
} from '../../project/sprite/contract';
import { readSpriteDocument } from '../../project/sprite/read';
import { sha256ByteDigest } from '../../provenance/digest';
import { assertTextureDimensions } from '../../textures/limits';
import { encodeCanonicalPng } from '../../textures/textureRecipe/png';
import {
  assertCanonicalTextureRaster,
  type CanonicalTextureRaster,
} from '../../textures/textureRecipe/raster';
import type { SpriteBuild, SpriteProduct } from './contract';
import { buildMaterialRamps } from './ramp';
import { paintSprite } from './paint';
import { createCanonicalRaster } from './raster';

const normalizeHexColors = (v: unknown): unknown => {
  if (typeof v === 'string' && /^#[0-9a-f]{6}$/iu.test(v)) return v.toUpperCase();
  if (Array.isArray(v)) return v.map(normalizeHexColors);
  if (v && typeof v === 'object') {
    return Object.fromEntries(
      Object.entries(v)
        .filter(([, value]) => value !== undefined)
        .map(([k, value]) => [k, normalizeHexColors(value)]),
    );
  }
  return v;
};

const digest = (v: unknown): string =>
  sha256ByteDigest(encodeUtf8(canonicalJsonString(normalizeHexColors(v))));

const coverage = (bytes: Uint8Array, total: number) => {
  const positions: number[] = [],
    colors = new Set<string>();
  for (let i = 0; i < total; i += 1) {
    if (bytes[i * 4 + 3]) {
      positions.push(i);
      colors.add(`${bytes[i * 4]},${bytes[i * 4 + 1]},${bytes[i * 4 + 2]}`);
    }
  }
  return { positions, colors };
};

const boundsOf = (
  positions: readonly number[],
  width: number,
): readonly [number, number, number, number] => {
  let minX = width;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = -1;
  let maxY = -1;
  for (let i = 0; i < positions.length; i += 1) {
    const pos = positions[i]!;
    const x = pos % width;
    const y = Math.floor(pos / width);
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return Object.freeze([minX, minY, maxX + 1, maxY + 1]);
};

const spriteProductHash = (width: number, height: number, bytes: Uint8Array): string =>
  sha256ByteDigest(
    encodeUtf8(`{"height":${height},"kind":"sprite","rgba":[${bytes.join(',')}],"width":${width}}`),
  );

export const compileSpriteDocument = (raw: unknown, file = 'sprite.ashfox'): SpriteBuild => {
  try {
    const doc: SpriteDocument = readSpriteDocument(raw, file);
    const [width, height] = doc.item.canvas;
    const sourceHash = digest(doc);
    const ramps = buildMaterialRamps(doc.materials);
    const final = paintSprite(doc, 'final', ramps);
    const bytes = final.raster.rgba.copy();
    const { positions, colors } = coverage(bytes, width * height);
    if (!positions.length) {
      throw new SpriteInputError({
        code: 'sprite.empty',
        file,
        pointer: '/item',
        expected: 'nonempty output',
        actual: 'transparent sprite',
      });
    }
    const png = encodeCanonicalPng(final.raster);
    const product: SpriteProduct = Object.freeze({
      id: doc.item.id,
      profile: doc.item.profile,
      ...(doc.item.slice ? { nineSlice: doc.item.slice } : {}),
      ...final,
      png,
      stages: Object.freeze({
        silhouette: paintSprite(doc, 'silhouette', ramps).raster,
        shade: paintSprite(doc, 'shade', ramps).raster,
        grain: paintSprite(doc, 'grain', ramps).raster,
      }),
      receipt: Object.freeze({
        id: doc.item.id,
        profile: doc.item.profile,
        sourceHash,
        closureHash: sourceHash,
        policy: SPRITE_POLICY,
        buildKey: digest({ closureHash: sourceHash, policy: SPRITE_POLICY }),
        productHash: spriteProductHash(width, height, bytes),
        pngHash: sha256ByteDigest(png),
        width,
        height,
        colors: colors.size,
        bounds: boundsOf(positions, width),
      }),
    });
    return Object.freeze({ ok: true, sourceHash, products: Object.freeze([product]) });
  } catch (error) {
    if (error instanceof SpriteInputError) return { ok: false, diagnostics: [error.diagnostic] };
    throw error;
  }
};

const fillPreviewPixel = (
  out: Uint8Array,
  outWidth: number,
  ox: number,
  oy: number,
  scale: number,
  r: number,
  g: number,
  b: number,
): void => {
  for (let dy = 0; dy < scale; dy += 1) {
    let rowOffset = ((oy + dy) * outWidth + ox) * 4;
    for (let dx = 0; dx < scale; dx += 1) {
      out[rowOffset] = r;
      out[rowOffset + 1] = g;
      out[rowOffset + 2] = b;
      out[rowOffset + 3] = 255;
      rowOffset += 4;
    }
  }
};

/** Presentation scaling only. Pixels are copied without interpolation. */
export const spritePreviewPng = (raster: CanonicalTextureRaster, scale = 16): Uint8Array => {
  if (!Number.isInteger(scale) || scale < 1 || scale > 32)
    throw new RangeError('Scale must be 1..32.');
  assertCanonicalTextureRaster(raster);
  const outWidth = raster.width * scale;
  const outHeight = raster.height * scale;
  assertTextureDimensions(outWidth, outHeight, 'Canonical texture');
  const src = raster.rgba.copy();
  const out = new Uint8Array(outWidth * outHeight * 4);
  for (let y = 0; y < raster.height; y += 1) {
    for (let x = 0; x < raster.width; x += 1) {
      const i = (y * raster.width + x) * 4;
      if (src[i + 3] !== 255) continue;
      fillPreviewPixel(
        out,
        outWidth,
        x * scale,
        y * scale,
        scale,
        src[i]!,
        src[i + 1]!,
        src[i + 2]!,
      );
    }
  }
  return encodeCanonicalPng(createCanonicalRaster(outWidth, outHeight, out));
};
