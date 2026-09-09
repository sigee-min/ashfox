import { encodeCanonicalPng } from '../../textures/textureRecipe/png';
import { rasterizeCanonicalTexture } from '../../textures/textureRecipe/raster';
import type { SpriteProduct } from './contract';
import type { TextureCanvasDetail } from '../../model/texture';

/** A deterministic contact sheet for reviewing generated pixels, never an item source. */
export const spriteSheetPng = (products: readonly SpriteProduct[]): Uint8Array => {
  if (products.length < 1 || products.length > 32) throw new RangeError('Sheet requires 1..32 sprites.');
  const columns = Math.min(5, products.length), rows = Math.ceil(products.length / columns);
  const details: TextureCanvasDetail[] = [];
  products.forEach((p, index) => {
    const ox = (index % columns) * 160, oy = Math.floor(index / columns) * 176;
    details.push({ id: `card${index}`, x: ox + 4, y: oy + 4, width: 152, height: 168, color: '#26323b', alpha: 255 });
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const offset = (y * 16 + x) * 4;
      if (p.raster.rgba.at(offset + 3) !== 255) continue;
      const color = '#' + [0, 1, 2].map(c => p.raster.rgba.at(offset + c)!.toString(16).padStart(2, '0')).join('');
      details.push({ id: `pixel${index}_${offset}`, x: ox + 16 + x * 8, y: oy + 12 + y * 8, width: 8, height: 8, color, alpha: 255 });
      details.push({ id: `native${index}_${offset}`, x: ox + 72 + x, y: oy + 148 + y, width: 1, height: 1, color, alpha: 255 });
    }
  });
  return encodeCanonicalPng(rasterizeCanonicalTexture(columns * 160, rows * 176,
    { background: '#151b20', backgroundAlpha: 255, canvasDetails: details, alphaMasks: [] }));
};
