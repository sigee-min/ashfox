import {
  SPRITE_POLICY,
  SpriteInputError,
  type SpriteDocument,
} from '../../project/sprite/contract';
import { readSpriteDocument } from '../../project/sprite/read';
import { sha256ByteDigest } from '../../provenance/digest';
import { encodeCanonicalPng } from '../../textures/textureRecipe/png';
import {
  rasterizeCanonicalTexture,
  type CanonicalTextureRaster,
} from '../../textures/textureRecipe/raster';
import type { SpriteBuild, SpriteProduct } from './contract';
import { paintSprite } from './paint';

const stable = (v: unknown): unknown => {
  if (typeof v === 'string' && /^#[0-9a-f]{6}$/iu.test(v)) return v.toUpperCase();
  if (Array.isArray(v)) return v.map(stable);
  if (v && typeof v === 'object')
    return Object.fromEntries(
      Object.entries(v)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, value]) => [k, stable(value)]),
    );
  return v;
};

const digest = (v: unknown): string =>
  sha256ByteDigest(new TextEncoder().encode(JSON.stringify(stable(v))));

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
  const xs = positions.map((i) => i % width),
    ys = positions.map((i) => Math.floor(i / width));
  return Object.freeze([
    Math.min(...xs),
    Math.min(...ys),
    Math.max(...xs) + 1,
    Math.max(...ys) + 1,
  ]);
};

const opaqueHexAt = (rgba: CanonicalTextureRaster['rgba'], offset: number): string | null => {
  if (rgba.at(offset + 3) !== 255) return null;
  return (
    '#' +
    [0, 1, 2]
      .map((c) =>
        rgba
          .at(offset + c)!
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
  );
};

export const compileSpriteDocument = (raw: unknown, file = 'sprite.ashfox'): SpriteBuild => {
  try {
    const doc: SpriteDocument = readSpriteDocument(raw, file);
    const [width, height] = doc.item.canvas;
    const sourceHash = digest(doc);
    const final = paintSprite(doc, 'final');
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
      ...final,
      png,
      stages: Object.freeze({
        silhouette: paintSprite(doc, 'silhouette').raster,
        shade: paintSprite(doc, 'shade').raster,
        grain: paintSprite(doc, 'grain').raster,
      }),
      receipt: Object.freeze({
        id: doc.item.id,
        profile: doc.item.profile,
        sourceHash,
        closureHash: sourceHash,
        policy: SPRITE_POLICY,
        buildKey: digest({ closureHash: sourceHash, policy: SPRITE_POLICY }),
        productHash: digest({ kind: 'sprite', width, height, rgba: [...bytes] }),
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

/** Presentation scaling only. Pixels are copied without interpolation. */
export const spritePreviewPng = (raster: CanonicalTextureRaster, scale = 16): Uint8Array => {
  if (!Number.isInteger(scale) || scale < 1 || scale > 32)
    throw new RangeError('Scale must be 1..32.');
  const details = [];
  for (let y = 0; y < raster.height; y += 1) {
    for (let x = 0; x < raster.width; x += 1) {
      const i = (y * raster.width + x) * 4;
      const color = opaqueHexAt(raster.rgba, i);
      if (color === null) continue;
      details.push({
        id: `p${i}`,
        x: x * scale,
        y: y * scale,
        width: scale,
        height: scale,
        color,
        alpha: 255 as const,
      });
    }
  }
  return encodeCanonicalPng(
    rasterizeCanonicalTexture(raster.width * scale, raster.height * scale, {
      background: '#000000',
      backgroundAlpha: 0,
      canvasDetails: details,
      alphaMasks: [],
    }),
  );
};
