import type {
  SpriteDocument,
  SpriteGrain,
  SpriteLayer,
  SpriteMask,
  SpritePatch,
  SpritePatternSpec,
  SpriteShade,
  SpriteStamp,
} from '../../project/sprite/contract';
import {
  blendCellHex,
  buildProtectedMask,
  computeFeatherMask,
  scaleHexAlpha,
  toCanonicalRaster,
} from './alpha';
import type { SpriteAuthoringTelemetry, SpritePixelEvidence } from './contract';
import { computeInnerRimCells, computeOutlineCells } from './outline';
import { computeShadedPixel, type PixelPaintContext } from './pixel';
import { buildMaterialRamps, type FiveToneRamp } from './ramp';
import { maskBounds, rasterizeShapeMask } from './shapes';

export type Stage = 'silhouette' | 'shade' | 'grain' | 'final';

const SILHOUETTE = '#ddd5c6';

interface Canvas {
  readonly doc: SpriteDocument;
  readonly width: number;
  readonly height: number;
  readonly wrap: boolean;
  readonly stage: Stage;
  readonly ramps: ReadonlyMap<string, FiveToneRamp>;
  readonly masks: ReadonlyMap<string, SpriteMask>;
  readonly stamps: ReadonlyMap<string, SpriteStamp>;
  readonly pixelCtx: PixelPaintContext;
  readonly cells: (string | null)[];
  readonly evidence: (SpritePixelEvidence | null)[];
  authoredPatternPixels: number;
  outlinePixels: number;
  hasRimHighlight: boolean;
  readonly materialsUsed: Set<string>;
}

const writeCell = (
  canvas: Canvas,
  x: number,
  y: number,
  color: string | null,
  info: SpritePixelEvidence,
  alphaFactor = 1,
): void => {
  if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) return;
  const idx = y * canvas.width + x;
  if (color === null) {
    canvas.cells[idx] = null;
    canvas.evidence[idx] = null;
    return;
  }
  const scaled = canvas.stage === 'silhouette' ? color : scaleHexAlpha(color, alphaFactor);
  if (scaled === null) return;
  const blended =
    canvas.stage === 'silhouette' ? scaled : blendCellHex(canvas.cells[idx] ?? null, scaled);
  canvas.cells[idx] = blended;
  canvas.evidence[idx] = blended === null ? null : info;
};

const baseInfo = (layer: SpriteLayer, pointer: string): SpritePixelEvidence => ({
  layer: layer.id,
  op: layer.op,
  pointer,
  material: null,
  baseTone: null,
  grainDelta: 0,
  protected: false,
  patch: null,
});

const mirrorCoord = (v: number, size: number, enabled: boolean): number =>
  enabled ? size - 1 - v : v;

const paintShadedPixel = (
  canvas: Canvas,
  x: number,
  y: number,
  sx: number,
  sy: number,
  lx: number,
  ly: number,
  bw: number,
  bh: number,
  materialId: string,
  shade: SpriteShade,
  grain: SpriteGrain,
  pattern: SpritePatternSpec | undefined,
  isProt: boolean,
  owner: SpritePixelEvidence,
  overlayOnly: boolean,
  alphaFactor: number,
): void => {
  const prev = canvas.evidence[y * canvas.width + x] ?? null;
  const out = computeShadedPixel(canvas.pixelCtx, {
    x,
    y,
    sx,
    sy,
    lx,
    ly,
    bw,
    bh,
    materialId,
    shade,
    grain,
    pattern,
    isProt,
    overlayOnly,
    prev,
    owner,
  });
  if (!out) return;
  if (out.usedPattern) canvas.authoredPatternPixels += 1;
  canvas.materialsUsed.add(out.material);
  writeCell(canvas, x, y, out.hex, out.evidence, alphaFactor);
};

const paintShadedRegion = (
  canvas: Canvas,
  mask: Uint8Array,
  ox: number,
  oy: number,
  w: number,
  h: number,
  materialId: string,
  shade: SpriteShade,
  grain: SpriteGrain,
  pattern: SpritePatternSpec | undefined,
  protectedMask: Uint8Array | null,
  owner: SpritePixelEvidence,
  overlayOnly = false,
  layerAlpha = 1,
  feather = 0,
): void => {
  const [bx, by, bw, bh] = maskBounds(mask, w, h) ?? [0, 0, w, h];
  const weights = feather > 0 ? computeFeatherMask(mask, w, h, feather) : null;
  for (let idx = 0; idx < w * h; idx += 1) {
    if (!mask[idx]) continue;
    const cellAlpha = layerAlpha * (weights?.[idx] ?? 1);
    if (cellAlpha <= 0) continue;
    const x = idx % w;
    const y = (idx / w) | 0;
    paintShadedPixel(
      canvas,
      ox + x,
      oy + y,
      x,
      y,
      x - bx,
      y - by,
      bw,
      bh,
      materialId,
      shade,
      grain,
      pattern,
      protectedMask?.[idx] === 1,
      owner,
      overlayOnly,
      cellAlpha,
    );
  }
};

const resolveMaskGrid = (
  mask: SpriteMask,
  mirror: 'none' | 'x' | 'y' | 'xy',
): { readonly grid: Uint8Array; readonly w: number; readonly h: number } => {
  if (mask.kind === 'shape') {
    return {
      grid: rasterizeShapeMask(
        mask.shape,
        mask.width,
        mask.height,
        mirror === 'none' ? mask.mirror : mirror,
      ),
      w: mask.width,
      h: mask.height,
    };
  }
  const h = mask.rows.length,
    w = mask.rows[0]!.length;
  const grid = new Uint8Array(w * h);
  const mx = mirror === 'x' || mirror === 'xy';
  const my = mirror === 'y' || mirror === 'xy';
  for (let y = 0; y < h; y += 1) {
    const row = mask.rows[y]!;
    const ty = mirrorCoord(y, h, my) * w;
    for (let x = 0; x < w; x += 1) {
      if (row[x] === '1') grid[ty + mirrorCoord(x, w, mx)] = 1;
    }
  }
  return { grid, w, h };
};

const paintPatch = (
  canvas: Canvas,
  ox: number,
  oy: number,
  patch: SpritePatch,
  pointer: string,
): void => {
  for (let y = 0; y < patch.rows.length; y += 1) {
    const row = patch.rows[y]!;
    const py = oy + patch.at[1] + y;
    for (let x = 0; x < row.length; x += 1) {
      const ch = row[x]!;
      if (ch === '.') continue;
      const px = ox + patch.at[0] + x;
      const prev = canvas.evidence[py * canvas.width + px];
      writeCell(canvas, px, py, canvas.doc.item.palette[patch.colors[ch]!]!, {
        ...(prev ?? {
          layer: patch.id,
          op: 'patch',
          material: null,
          baseTone: null,
          grainDelta: 0,
          protected: true,
        }),
        patch: patch.id,
        pointer: `${pointer}/rows/${y}/${x}`,
      });
    }
  }
};

const paintRowGrid = (
  canvas: Canvas,
  rows: readonly string[],
  ox: number,
  oy: number,
  flip: 'none' | 'x' | 'y' | 'xy',
  colors: Readonly<Record<string, string>> | null,
  owner: SpritePixelEvidence,
  layerAlpha = 1,
): void => {
  const mx = flip === 'x' || flip === 'xy';
  const my = flip === 'y' || flip === 'xy';
  for (let y = 0; y < rows.length; y += 1) {
    const row = rows[y]!;
    const py = oy + mirrorCoord(y, rows.length, my);
    for (let x = 0; x < row.length; x += 1) {
      const ch = row[x]!;
      if (ch === '.') continue;
      const px = ox + mirrorCoord(x, row.length, mx);
      const color = colors === null ? null : canvas.doc.item.palette[colors[ch]!]!;
      writeCell(
        canvas,
        px,
        py,
        canvas.stage === 'silhouette' && color ? SILHOUETTE : color,
        {
          ...owner,
          pointer: `${owner.pointer}/rows/${y}/${x}`,
        },
        layerAlpha,
      );
    }
  }
};

const applyFillOrPattern = (
  canvas: Canvas,
  layer: Extract<SpriteLayer, { readonly op: 'fill' | 'pattern' }>,
  owner: SpritePixelEvidence,
): void => {
  const flatShade = { form: 'flat' as const, light: 'top_left' as const, contrast: 0, specular: 0 };
  const grain: SpriteGrain =
    layer.op === 'fill' ? layer.grain : { mode: 'none', amount: 0, seed: 0 };
  const mask = new Uint8Array(canvas.width * canvas.height);
  for (let i = 0; i < mask.length; i += 1) {
    mask[i] = layer.op === 'fill' || layer.clip === 'canvas' || canvas.cells[i] !== null ? 1 : 0;
  }
  paintShadedRegion(
    canvas,
    mask,
    0,
    0,
    canvas.width,
    canvas.height,
    layer.material,
    flatShade,
    grain,
    layer.pattern,
    null,
    owner,
    layer.op === 'pattern',
    layer.alpha ?? 1,
  );
};

const applyOutline = (
  canvas: Canvas,
  layer: Extract<SpriteLayer, { readonly op: 'outline' }>,
  owner: SpritePixelEvidence,
): void => {
  const outlineCells = computeOutlineCells(
    canvas.cells,
    canvas.width,
    canvas.height,
    layer,
    canvas.doc.item.palette,
  );
  const rimCells = layer.inner_rim
    ? computeInnerRimCells(canvas.cells, canvas.width, canvas.height)
    : [];
  for (const cell of outlineCells) {
    canvas.outlinePixels += 1;
    writeCell(
      canvas,
      cell.x,
      cell.y,
      canvas.stage === 'silhouette' ? SILHOUETTE : cell.color,
      owner,
    );
  }
  for (const cell of rimCells) {
    canvas.hasRimHighlight = true;
    if (canvas.stage === 'final') writeCell(canvas, cell.x, cell.y, cell.color, owner);
  }
};

const applyErase = (
  canvas: Canvas,
  layer: Extract<SpriteLayer, { readonly op: 'erase' }>,
  owner: SpritePixelEvidence,
): void => {
  if (layer.shape) {
    const mask = rasterizeShapeMask(layer.shape, canvas.width, canvas.height, 'none');
    for (let y = 0; y < canvas.height; y += 1) {
      for (let x = 0; x < canvas.width; x += 1) {
        if (mask[y * canvas.width + x]) writeCell(canvas, x, y, null, owner);
      }
    }
    return;
  }
  paintRowGrid(canvas, layer.rows!, layer.at![0], layer.at![1], 'none', null, owner);
};

const applyShapeOrPartLayer = (
  canvas: Canvas,
  layer: Extract<SpriteLayer, { readonly op: 'shape' | 'part' }>,
  owner: SpritePixelEvidence,
): void => {
  if (layer.op === 'shape') {
    const mask = rasterizeShapeMask(layer.shape, canvas.width, canvas.height, layer.mirror);
    if (layer.clip === 'occupied') {
      for (let i = 0; i < mask.length; i += 1) if (canvas.cells[i] === null) mask[i] = 0;
    }
    paintShadedRegion(
      canvas,
      mask,
      0,
      0,
      canvas.width,
      canvas.height,
      layer.material,
      layer.shade,
      layer.grain,
      layer.pattern,
      null,
      owner,
      false,
      layer.alpha ?? 1,
      layer.feather ?? 0,
    );
    return;
  }
  const maskDef = canvas.masks.get(layer.mask)!;
  const { grid, w, h } = resolveMaskGrid(maskDef, layer.mirror);
  const prot = buildProtectedMask(layer.patches, w, h);
  paintShadedRegion(
    canvas,
    grid,
    layer.at[0],
    layer.at[1],
    w,
    h,
    layer.material,
    layer.shade,
    layer.grain,
    layer.pattern,
    prot,
    owner,
    false,
    layer.alpha ?? 1,
    layer.feather ?? 0,
  );
  if (canvas.stage === 'final') {
    layer.patches.forEach((p, k) =>
      paintPatch(canvas, layer.at[0], layer.at[1], p, `${owner.pointer}/patches/${k}`),
    );
  }
};

const applyLayer = (canvas: Canvas, layer: SpriteLayer, index: number): void => {
  const owner = baseInfo(layer, `/item/layers/${index}`);
  if (layer.op === 'fill' || layer.op === 'pattern')
    return applyFillOrPattern(canvas, layer, owner);
  if (layer.op === 'outline') return applyOutline(canvas, layer, owner);
  if (layer.op === 'erase') return applyErase(canvas, layer, owner);
  if (layer.op === 'paint') {
    return paintRowGrid(
      canvas,
      layer.rows,
      layer.at[0],
      layer.at[1],
      'none',
      layer.colors,
      owner,
      layer.alpha ?? 1,
    );
  }
  if (layer.op === 'stamp') {
    const stamp = canvas.stamps.get(layer.stamp)!;
    return paintRowGrid(
      canvas,
      stamp.rows,
      layer.at[0],
      layer.at[1],
      layer.flip,
      layer.colors,
      owner,
      layer.alpha ?? 1,
    );
  }
  applyShapeOrPartLayer(canvas, layer, owner);
};

export const paintSprite = (
  doc: SpriteDocument,
  stage: Stage,
  prebuiltRamps?: ReadonlyMap<string, FiveToneRamp>,
) => {
  const [width, height] = doc.item.canvas;
  const ramps = prebuiltRamps ?? buildMaterialRamps(doc.materials);
  const wrap = doc.item.profile === 'tile';
  const canvas: Canvas = {
    doc,
    width,
    height,
    wrap,
    stage,
    ramps,
    masks: new Map(doc.masks.map((m) => [m.id, m])),
    stamps: new Map(doc.stamps.map((s) => [s.id, s])),
    pixelCtx: {
      width,
      height,
      wrap,
      shadeOnly: stage === 'shade',
      silhouetteHex: stage === 'silhouette' ? SILHOUETTE : null,
      ramps,
    },
    cells: Array(width * height).fill(null),
    evidence: Array(width * height).fill(null),
    authoredPatternPixels: 0,
    outlinePixels: 0,
    hasRimHighlight: false,
    materialsUsed: new Set(),
  };
  doc.item.layers.forEach((layer, idx) => applyLayer(canvas, layer, idx));
  const opaquePixels = canvas.cells.reduce((n, c) => n + (c === null ? 0 : 1), 0);
  const telemetry: SpriteAuthoringTelemetry = Object.freeze({
    width,
    height,
    profile: doc.item.profile,
    opaquePixels,
    layerCount: doc.item.layers.length,
    authoredPatternPixels: canvas.authoredPatternPixels,
    outlinePixels: canvas.outlinePixels,
    materialCount: canvas.materialsUsed.size,
    hasRimHighlight: canvas.hasRimHighlight,
  });
  return {
    raster: toCanonicalRaster(canvas.cells, width, height),
    evidence: Object.freeze(canvas.evidence.map((e) => e && Object.freeze(e))),
    telemetry,
  };
};
