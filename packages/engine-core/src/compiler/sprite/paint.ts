import type { Item, ItemStudy, Layer } from '../../project/sprite/contract';
import { rasterizeCanonicalTexture } from '../../textures/textureRecipe/raster';
import type { SpritePixelEvidence } from './contract';
import { baseTone, finalTone, grainDelta, materialRamp } from './shade';

type Stage = 'silhouette' | 'shade' | 'grain' | 'final';
export const paintItem = (study: ItemStudy, item: Item, itemIndex: number, stage: Stage) => {
  const cells: (string | null)[] = Array(256).fill(null);
  const evidence: (SpritePixelEvidence | null)[] = Array(256).fill(null);
  const write = (x: number, y: number, color: string | null, info: SpritePixelEvidence): void => {
    cells[y * 16 + x] = color; evidence[y * 16 + x] = info;
  };
  const info = (layer: Layer, j: number): SpritePixelEvidence => ({ layer: layer.id,
    pointer: `/items/${itemIndex}/layers/${j}`, material: null, baseTone: null,
    grainDelta: 0, protected: false, patch: null });
  item.layers.forEach((layer, j) => {
    const owner = info(layer, j);
    const [ax, ay] = layer.at;
    if (layer.op !== 'part') {
      const rows = layer.op === 'stamp' ? study.stamps.find(s => s.id === layer.stamp)!.rows : layer.rows;
      rows.forEach((row, y) => [...row].forEach((c, x) => {
        if (c === '.') return;
        const px = layer.op === 'stamp' && layer.flip.includes('x') ? row.length - 1 - x : x;
        const py = layer.op === 'stamp' && layer.flip.includes('y') ? rows.length - 1 - y : y;
        const color = layer.op === 'erase' ? null : item.palette[layer.colors[c]!]!;
        write(ax + px, ay + py, stage === 'silhouette' && color ? '#ddd5c6' : color,
          { ...owner, pointer: layer.op === 'stamp' ? `/stamps/${study.stamps.findIndex(s => s.id === layer.stamp)}/rows/${y}/${x}` : `${owner.pointer}/rows/${y}/${x}` });
      }));
      return;
    }
    const mask = study.masks.find(m => m.id === layer.mask)!.rows;
    const ramp = materialRamp(study.materials.find(m => m.id === layer.material)!);
    mask.forEach((row, y) => [...row].forEach((c, x) => {
      if (c !== '1') return;
      const protectedPixel = layer.patches.some(p => x >= p.at[0] - p.protect && y >= p.at[1] - p.protect &&
        x < p.at[0] + p.rows[0]!.length + p.protect && y < p.at[1] + p.rows.length + p.protect);
      const base = baseTone(layer.shade, x, y, row.length, mask.length);
      const rawDelta = protectedPixel || layer.grain.amount === 0 ? 0 : grainDelta(x, y, layer.grain.seed);
      const delta = finalTone(base, rawDelta) - base;
      const tone = stage === 'shade' ? base : finalTone(base, delta);
      write(ax + x, ay + y, stage === 'silhouette' ? '#ddd5c6' : ramp[tone]!,
        { ...owner, material: layer.material, baseTone: base, grainDelta: delta, protected: protectedPixel });
    }));
    if (stage !== 'final') return;
    layer.patches.forEach((p, k) => p.rows.forEach((row, y) => [...row].forEach((c, x) => {
      if (c === '.') return;
      const px = ax + p.at[0] + x, py = ay + p.at[1] + y;
      write(px, py, item.palette[p.colors[c]!]!, { ...evidence[py * 16 + px]!, patch: p.id,
        pointer: `${owner.pointer}/patches/${k}/rows/${y}/${x}` });
    })));
  });
  const details = cells.flatMap((color, index) => color === null ? [] : [{
    id: `p${index}`, x: index % 16, y: Math.floor(index / 16), width: 1, height: 1, color, alpha: 255 as const
  }]);
  const raster = rasterizeCanonicalTexture(16, 16, { background: '#000000', backgroundAlpha: 0, canvasDetails: details, alphaMasks: [] });
  return { raster, evidence: Object.freeze(evidence.map(e => e && Object.freeze(e))) };
};
