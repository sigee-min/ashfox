import { readItemStudy } from '../../project/sprite/read';
import { SPRITE_POLICY, SpriteInputError, type Item, type ItemStudy } from '../../project/sprite/contract';
import { sha256ByteDigest } from '../../provenance/digest';
import { encodeCanonicalPng } from '../../textures/textureRecipe/png';
import { rasterizeCanonicalTexture } from '../../textures/textureRecipe/raster';
import type { CanonicalTextureRaster } from '../../textures/textureRecipe/raster';
import type { SpriteBuild, SpriteProduct } from './contract';
import { paintItem } from './paint';

const stable = (v: unknown): unknown => {
  if (typeof v === 'string' && /^#[0-9a-f]{6}$/iu.test(v)) return v.toUpperCase();
  if (Array.isArray(v)) return v.map(stable);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, value]) => [k, stable(value)]));
  return v;
};
const digest = (v: unknown): string => sha256ByteDigest(new TextEncoder().encode(JSON.stringify(stable(v))));
const sort = <T extends { readonly id: string }>(values: readonly T[]): readonly T[] => [...values].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const closure = (study: ItemStudy, item: Item): unknown => ({ item,
  masks: sort(study.masks.filter(m => item.layers.some(l => l.op === 'part' && l.mask === m.id))),
  materials: sort(study.materials.filter(m => item.layers.some(l => l.op === 'part' && l.material === m.id))),
  stamps: sort(study.stamps.filter(s => item.layers.some(l => l.op === 'stamp' && l.stamp === s.id))) });

export const compileItemStudy = (source: string, file = 'study.items.json'): SpriteBuild => {
  try {
    const study = readItemStudy(source, file);
    const sourceHash = digest({ ...study, items: sort(study.items), masks: sort(study.masks), materials: sort(study.materials), stamps: sort(study.stamps) });
    const products: SpriteProduct[] = [];
    for (const item of sort(study.items)) {
      const index = study.items.indexOf(item);
      const final = paintItem(study, item, index, 'final');
      const bytes = final.raster.rgba.copy();
      const positions: number[] = [], colors = new Set<string>();
      for (let i = 0; i < 256; i++) if (bytes[i * 4 + 3]) {
        positions.push(i); colors.add(`${bytes[i * 4]},${bytes[i * 4 + 1]},${bytes[i * 4 + 2]}`);
      }
      if (!positions.length) throw new SpriteInputError({ code: 'sprite.empty', file,
        pointer: `/items/${index}`, expected: 'nonempty output', actual: 'transparent item' });
      const xs = positions.map(i => i % 16), ys = positions.map(i => Math.floor(i / 16));
      const png = encodeCanonicalPng(final.raster), closureHash = digest(closure(study, item));
      products.push(Object.freeze({ id: item.id, ...final, png,
        stages: Object.freeze({ silhouette: paintItem(study, item, index, 'silhouette').raster,
          shade: paintItem(study, item, index, 'shade').raster, grain: paintItem(study, item, index, 'grain').raster }),
        receipt: Object.freeze({ id: item.id, sourceHash, closureHash, policy: SPRITE_POLICY,
          buildKey: digest({ closureHash, policy: SPRITE_POLICY }),
          productHash: digest({ kind: 'sprite', width: 16, height: 16, rgba: [...bytes] }),
          pngHash: sha256ByteDigest(png), width: 16, height: 16, colors: colors.size,
          bounds: Object.freeze([Math.min(...xs), Math.min(...ys), Math.max(...xs) + 1, Math.max(...ys) + 1]) as readonly [number, number, number, number] }) }));
    }
    return Object.freeze({ ok: true, sourceHash, products: Object.freeze(products) });
  } catch (error) {
    if (error instanceof SpriteInputError) return { ok: false, diagnostics: [error.diagnostic] };
    throw error;
  }
};
/** Presentation scaling only. Pixels are copied without interpolation. */
export const spritePreviewPng = (raster: CanonicalTextureRaster, scale = 16): Uint8Array => {
  if (!Number.isInteger(scale) || scale < 1 || scale > 32) throw new RangeError('Scale must be 1..32.');
  const details = [];
  for (let y = 0; y < raster.height; y++) for (let x = 0; x < raster.width; x++) {
    const i = (y * raster.width + x) * 4;
    if (raster.rgba.at(i + 3) !== 255) continue;
    const color = '#' + [0, 1, 2].map(c => raster.rgba.at(i + c)!.toString(16).padStart(2, '0')).join('');
    details.push({ id: `p${i}`, x: x * scale, y: y * scale, width: scale, height: scale, color, alpha: 255 as const });
  }
  return encodeCanonicalPng(rasterizeCanonicalTexture(raster.width * scale, raster.height * scale,
    { background: '#000000', backgroundAlpha: 0, canvasDetails: details, alphaMasks: [] }));
};
