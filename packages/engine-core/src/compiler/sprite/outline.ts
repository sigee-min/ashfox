import type { SpriteLayer } from '../../project/sprite/contract';
import { hexToOklch, oklchToHex, relativeLuminance, shiftHueToward } from '../../textures/oklch';

type OutlineLayer = Extract<SpriteLayer, { readonly op: 'outline' }>;

export interface OutlineCell {
  readonly x: number;
  readonly y: number;
  readonly color: string;
}

const outlineTargetHue = (h: number): readonly [number, number] => {
  if (h >= 40 && h < 115) return [46, 0.22];
  if (h >= 115 && h < 185) return [195, 0.2];
  if (h < 40 || h >= 330) return [350, 0.2];
  return [265, 0.18];
};

const selOutColor = (neighborHex: string, strength: number, lightBias: number): string => {
  const c = hexToOklch(neighborHex);
  const anchorL = Math.min(0.68, c.l);
  const drop = lightBias > 0 ? 0.18 + strength * 0.05 : 0.25 + strength * 0.06;
  const [target, pull] = outlineTargetHue(c.h);
  const hue = c.c < 0.02 ? 260 : shiftHueToward(c.h, target, pull);
  const chroma = c.c < 0.02 ? 0.02 : Math.min(0.15, c.c * (lightBias > 0 ? 0.78 : 0.68));
  let l = Math.max(0.26, anchorL - drop);
  let hex = oklchToHex({ l, c: chroma, h: hue });
  for (let i = 0; i < 8 && relativeLuminance(hex) < 0.145; i += 1) {
    l = Math.min(0.45, l + 0.02);
    hex = oklchToHex({ l, c: chroma, h: hue });
  }
  return hex;
};

const darkOutlineColor = (strength: number): string =>
  strength === 1 ? '#3a3544' : strength === 2 ? '#322e3c' : '#2c2936';

const NEIGHBORS: readonly (readonly [number, number])[] = [
  [0, -1],
  [-1, 0],
  [1, 0],
  [0, 1],
];

const neighborAt = (
  cells: readonly (string | null)[],
  w: number,
  h: number,
  x: number,
  y: number,
): string | null => (x >= 0 && y >= 0 && x < w && y < h ? (cells[y * w + x] ?? null) : null);

const computeLightBias = (litCount: number, shadowCount: number): number => {
  if (litCount > 0 && shadowCount === 0) return 1;
  if (shadowCount > 0 && litCount === 0) return -1;
  return 0;
};

const inspectOpaqueNeighbors = (
  cells: readonly (string | null)[],
  w: number,
  h: number,
  x: number,
  y: number,
): { readonly hex: string; readonly lightBias: number } | null => {
  let first: string | null = null;
  let litCount = 0;
  let shadowCount = 0;
  for (const [dx, dy] of NEIGHBORS) {
    const c = neighborAt(cells, w, h, x + dx, y + dy);
    if (!c) continue;
    first ??= c;
    litCount += dx > 0 || dy > 0 ? 1 : 0;
    shadowCount += dx < 0 || dy < 0 ? 1 : 0;
  }
  return first === null ? null : { hex: first, lightBias: computeLightBias(litCount, shadowCount) };
};

/** Compute automatic sel-out / dark / colored outline cells around opaque sprite pixels. */
export const computeOutlineCells = (
  cells: readonly (string | null)[],
  w: number,
  h: number,
  layer: OutlineLayer,
  palette: Readonly<Record<string, string>>,
): readonly OutlineCell[] => {
  const out: OutlineCell[] = [];
  const fixedHex = layer.mode === 'colored' && layer.color ? palette[layer.color]! : null;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (cells[y * w + x] !== null) continue;
      const hit = inspectOpaqueNeighbors(cells, w, h, x, y);
      if (!hit) continue;
      const color =
        fixedHex ??
        (layer.mode === 'dark'
          ? darkOutlineColor(layer.strength)
          : selOutColor(hit.hex, layer.strength, hit.lightBias));
      out.push({ x, y, color });
    }
  }
  return out;
};

const innerRimCell = (
  cells: readonly (string | null)[],
  w: number,
  x: number,
  y: number,
): OutlineCell | null => {
  const hex = cells[y * w + x];
  if (!hex) return null;
  const topEmpty = cells[(y - 1) * w + x] === null;
  const leftEmpty = cells[y * w + (x - 1)] === null;
  if (!topEmpty && !leftEmpty) return null;
  const hasInner = cells[(y + 1) * w + x] !== null && cells[y * w + (x + 1)] !== null;
  if (!hasInner) return null;
  const c = hexToOklch(hex);
  const limit = topEmpty && leftEmpty ? 0.76 : 0.66;
  if (c.l >= limit) return null;
  const color = oklchToHex({
    l: Math.min(0.9, c.l + 0.07),
    c: c.c * 0.9,
    h: shiftHueToward(c.h, 80, 0.12),
  });
  return { x, y, color };
};

/** Compute optional 1px top-left inner rim catchlight cells inside opaque silhouette edges. */
export const computeInnerRimCells = (
  cells: readonly (string | null)[],
  w: number,
  h: number,
): readonly OutlineCell[] => {
  const out: OutlineCell[] = [];
  for (let y = 1; y < h - 1; y += 1) {
    for (let x = 1; x < w - 1; x += 1) {
      const cell = innerRimCell(cells, w, x, y);
      if (cell) out.push(cell);
    }
  }
  return out;
};
