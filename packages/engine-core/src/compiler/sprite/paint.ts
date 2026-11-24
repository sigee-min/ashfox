import type { Item, ItemStudy, Layer, Patch } from '../../project/sprite/contract';
import { rasterizeCanonicalTexture } from '../../textures/textureRecipe/raster';
import type { SpritePixelEvidence } from './contract';
import { baseTone, finalTone, grainDelta, materialRamp } from './shade';

type Stage = 'silhouette' | 'shade' | 'grain' | 'final';
type RowLayer = Exclude<Layer, { readonly op: 'part' }>;
type PartLayer = Extract<Layer, { readonly op: 'part' }>;

const SILHOUETTE = '#ddd5c6';

/** Mutable 16x16 paint target shared by every layer of one item. */
interface Canvas {
  readonly study: ItemStudy;
  readonly item: Item;
  readonly stage: Stage;
  readonly cells: (string | null)[];
  readonly evidence: (SpritePixelEvidence | null)[];
}

const write = (
  canvas: Canvas,
  x: number,
  y: number,
  color: string | null,
  info: SpritePixelEvidence,
): void => {
  canvas.cells[y * 16 + x] = color;
  canvas.evidence[y * 16 + x] = info;
};

const layerEvidence = (layer: Layer, pointer: string): SpritePixelEvidence => ({
  layer: layer.id,
  pointer,
  material: null,
  baseTone: null,
  grainDelta: 0,
  protected: false,
  patch: null,
});

const rowCells = (
  rows: readonly string[],
  visit: (c: string, x: number, y: number, row: string) => void,
): void => rows.forEach((row, y) => [...row].forEach((c, x) => visit(c, x, y, row)));

const layerRows = (study: ItemStudy, layer: RowLayer): readonly string[] =>
  layer.op === 'stamp' ? study.stamps.find((s) => s.id === layer.stamp)!.rows : layer.rows;

const flipped = (layer: RowLayer, axis: 'x' | 'y', value: number, size: number): number =>
  layer.op === 'stamp' && layer.flip.includes(axis) ? size - 1 - value : value;

const rowColor = (canvas: Canvas, layer: RowLayer, c: string): string | null => {
  const color = layer.op === 'erase' ? null : canvas.item.palette[layer.colors[c]!]!;
  return canvas.stage === 'silhouette' && color ? SILHOUETTE : color;
};

const rowPointer = (study: ItemStudy, layer: RowLayer, base: string, x: number, y: number) =>
  layer.op === 'stamp'
    ? `/stamps/${study.stamps.findIndex((s) => s.id === layer.stamp)}/rows/${y}/${x}`
    : `${base}/rows/${y}/${x}`;

const paintRowLayer = (canvas: Canvas, layer: RowLayer, owner: SpritePixelEvidence): void => {
  const [ax, ay] = layer.at;
  const rows = layerRows(canvas.study, layer);
  rowCells(rows, (c, x, y, row) => {
    if (c === '.') return;
    const px = flipped(layer, 'x', x, row.length);
    const py = flipped(layer, 'y', y, rows.length);
    write(canvas, ax + px, ay + py, rowColor(canvas, layer, c), {
      ...owner,
      pointer: rowPointer(canvas.study, layer, owner.pointer, x, y),
    });
  });
};

const isProtected = (layer: PartLayer, x: number, y: number): boolean =>
  layer.patches.some(
    (p) =>
      x >= p.at[0] - p.protect &&
      y >= p.at[1] - p.protect &&
      x < p.at[0] + p.rows[0]!.length + p.protect &&
      y < p.at[1] + p.rows.length + p.protect,
  );

const paintPartMask = (canvas: Canvas, layer: PartLayer, owner: SpritePixelEvidence): void => {
  const [ax, ay] = layer.at;
  const mask = canvas.study.masks.find((m) => m.id === layer.mask)!.rows;
  const ramp = materialRamp(canvas.study.materials.find((m) => m.id === layer.material)!);
  rowCells(mask, (c, x, y, row) => {
    if (c !== '1') return;
    const protectedPixel = isProtected(layer, x, y);
    const base = baseTone(layer.shade, x, y, row.length, mask.length);
    const rawDelta =
      protectedPixel || layer.grain.amount === 0 ? 0 : grainDelta(x, y, layer.grain.seed);
    const delta = finalTone(base, rawDelta) - base;
    const tone = canvas.stage === 'shade' ? base : finalTone(base, delta);
    write(canvas, ax + x, ay + y, canvas.stage === 'silhouette' ? SILHOUETTE : ramp[tone]!, {
      ...owner,
      material: layer.material,
      baseTone: base,
      grainDelta: delta,
      protected: protectedPixel,
    });
  });
};

const paintPatch = (canvas: Canvas, layer: PartLayer, patch: Patch, pointer: string): void => {
  const [ax, ay] = layer.at;
  rowCells(patch.rows, (c, x, y) => {
    if (c === '.') return;
    const px = ax + patch.at[0] + x,
      py = ay + patch.at[1] + y;
    write(canvas, px, py, canvas.item.palette[patch.colors[c]!]!, {
      ...canvas.evidence[py * 16 + px]!,
      patch: patch.id,
      pointer: `${pointer}/rows/${y}/${x}`,
    });
  });
};

const paintPartLayer = (canvas: Canvas, layer: PartLayer, owner: SpritePixelEvidence): void => {
  paintPartMask(canvas, layer, owner);
  if (canvas.stage !== 'final') return;
  layer.patches.forEach((patch, k) =>
    paintPatch(canvas, layer, patch, `${owner.pointer}/patches/${k}`),
  );
};

const canvasRaster = (cells: readonly (string | null)[]) => {
  const details = cells.flatMap((color, index) =>
    color === null
      ? []
      : [
          {
            id: `p${index}`,
            x: index % 16,
            y: Math.floor(index / 16),
            width: 1,
            height: 1,
            color,
            alpha: 255 as const,
          },
        ],
  );
  return rasterizeCanonicalTexture(16, 16, {
    background: '#000000',
    backgroundAlpha: 0,
    canvasDetails: details,
    alphaMasks: [],
  });
};

export const paintItem = (study: ItemStudy, item: Item, itemIndex: number, stage: Stage) => {
  const canvas: Canvas = {
    study,
    item,
    stage,
    cells: Array(256).fill(null),
    evidence: Array(256).fill(null),
  };
  item.layers.forEach((layer, j) => {
    const owner = layerEvidence(layer, `/items/${itemIndex}/layers/${j}`);
    if (layer.op === 'part') paintPartLayer(canvas, layer, owner);
    else paintRowLayer(canvas, layer, owner);
  });
  const evidence = Object.freeze(canvas.evidence.map((e) => e && Object.freeze(e)));
  return { raster: canvasRaster(canvas.cells), evidence };
};
