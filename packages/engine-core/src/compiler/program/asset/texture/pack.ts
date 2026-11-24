import { compareText } from '../../../../stableOrder';

export interface PackRectInput {
  readonly id: string;
  readonly width: number;
  readonly height: number;
}

export interface PackedAtlasResult {
  readonly atlas: readonly [number, number];
  readonly origins: ReadonlyMap<string, readonly [number, number]>;
}

const MAX_ATLAS_DIM = 4096;
const MIN_ATLAS_DIM = 16;

const nextPow2 = (value: number): number => {
  let size = MIN_ATLAS_DIM;
  while (size < value && size < MAX_ATLAS_DIM) size *= 2;
  return size;
};

const sortedItems = (items: readonly PackRectInput[]): readonly PackRectInput[] =>
  [...items].sort(
    (left, right) =>
      right.height - left.height || right.width - left.width || compareText(left.id, right.id),
  );

const packShelf = (
  items: readonly PackRectInput[],
  maxWidth: number,
  maxHeight: number,
): Readonly<{
  readonly usedHeight: number;
  readonly origins: Map<string, readonly [number, number]>;
}> | null => {
  const origins = new Map<string, readonly [number, number]>();
  let cursorX = 0;
  let cursorY = 0;
  let shelfHeight = 0;
  for (const item of items) {
    if (item.width > maxWidth) return null;
    if (cursorX > 0 && cursorX + item.width > maxWidth) {
      cursorY += shelfHeight;
      cursorX = 0;
      shelfHeight = 0;
    }
    if (cursorY + item.height > maxHeight) return null;
    origins.set(item.id, Object.freeze([cursorX, cursorY] as const));
    cursorX += item.width;
    if (item.height > shelfHeight) shelfHeight = item.height;
  }
  return { usedHeight: cursorY + shelfHeight, origins };
};

const tryAutoCandidate = (
  sorted: readonly PackRectInput[],
  width: number,
): PackedAtlasResult | null => {
  if (width > MAX_ATLAS_DIM) return null;
  const packed = packShelf(sorted, width, MAX_ATLAS_DIM);
  if (packed === null) return null;
  const height = nextPow2(Math.max(MIN_ATLAS_DIM, packed.usedHeight));
  if (height > MAX_ATLAS_DIM || packed.usedHeight > height) return null;
  return Object.freeze({
    atlas: Object.freeze([width, height] as const),
    origins: packed.origins,
  });
};

const initialWidthFor = (items: readonly PackRectInput[]): number => {
  let area = 0;
  let maxWidth = MIN_ATLAS_DIM;
  for (const item of items) {
    area += item.width * item.height;
    if (item.width > maxWidth) maxWidth = item.width;
  }
  const target = Math.max(maxWidth, Math.ceil(Math.sqrt(area * 1.15)));
  return nextPow2(target);
};

const pickBetterLayout = (
  best: PackedAtlasResult | null,
  candidate: PackedAtlasResult | null,
): PackedAtlasResult | null => {
  if (candidate === null) return best;
  if (best === null) return candidate;
  const bestArea = best.atlas[0] * best.atlas[1];
  const candArea = candidate.atlas[0] * candidate.atlas[1];
  if (candArea < bestArea) return candidate;
  if (candArea === bestArea && candidate.atlas[0] < best.atlas[0]) return candidate;
  return best;
};

/**
 * Deterministically packs chart rectangles onto an integer texture grid using
 * shelf placement ordered by descending height, descending width, then id.
 */
export const packCharts = (
  items: readonly PackRectInput[],
  explicitAtlas: readonly [number, number] | null,
): PackedAtlasResult | null => {
  const sorted = sortedItems(items);
  if (explicitAtlas !== null) {
    const packed = packShelf(sorted, explicitAtlas[0], explicitAtlas[1]);
    if (packed === null) return null;
    return Object.freeze({ atlas: explicitAtlas, origins: packed.origins });
  }
  const startWidth = initialWidthFor(sorted);
  let best: PackedAtlasResult | null = null;
  for (let width = startWidth; width <= MAX_ATLAS_DIM; width *= 2) {
    best = pickBetterLayout(best, tryAutoCandidate(sorted, width));
  }
  return best;
};
