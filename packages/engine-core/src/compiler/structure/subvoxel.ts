import type { Vec3 } from '../../model/identity';
import type { CardinalFacing } from '../../project/structure/contract';
import type { ParsedBlockState } from '../../project/structure/state';
import type { BlockDescriptor, BlockRenderLayer } from './blocks';
import type { StructureGrid, StructureOpeningMeta, StructureRoomMeta } from './contract';

export interface LocalBoxSpec {
  readonly from: Vec3;
  readonly to: Vec3;
  readonly role?: 'front' | 'top' | 'bottom' | 'side';
  readonly emissive?: boolean;
  readonly layer?: BlockRenderLayer;
  readonly tileOverride?: string;
}

const bx = (
  x0: number,
  y0: number,
  z0: number,
  x1: number,
  y1: number,
  z1: number,
  tileOverride?: string,
  layer: BlockRenderLayer = 'opaque',
): LocalBoxSpec => ({
  from: [x0, y0, z0],
  to: [x1, y1, z1],
  layer,
  ...(tileOverride ? { tileOverride } : {}),
});

const em = (
  x0: number,
  y0: number,
  z0: number,
  x1: number,
  y1: number,
  z1: number,
  tileOverride?: string,
): LocalBoxSpec => ({
  from: [x0, y0, z0],
  to: [x1, y1, z1],
  emissive: true,
  layer: 'emissive',
  ...(tileOverride ? { tileOverride } : {}),
});

const rotatePointXZ = ([x, y, z]: Vec3, facing: CardinalFacing): Vec3 => {
  if (facing === 'east') return [16 - z, y, x];
  if (facing === 'south') return [16 - x, y, 16 - z];
  if (facing === 'west') return [z, y, 16 - x];
  return [x, y, z];
};

const normBounds = (a: Vec3, b: Vec3, extra?: Partial<LocalBoxSpec>): LocalBoxSpec => ({
  ...extra,
  from: [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.min(a[2], b[2])],
  to: [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.max(a[2], b[2])],
});

export const rotateBox = (spec: LocalBoxSpec, facing: CardinalFacing): LocalBoxSpec =>
  normBounds(rotatePointXZ(spec.from, facing), rotatePointXZ(spec.to, facing), spec);

const stairStepBoxes = (
  shape: string,
  y0: number,
  y1: number,
  d: number,
): readonly LocalBoxSpec[] => {
  if (d === 16 || shape === 'straight') return [{ from: [0, y0, 0], to: [16, y1, d] }];
  if (shape === 'outer_left') return [{ from: [0, y0, 0], to: [d, y1, d] }];
  if (shape === 'outer_right') return [{ from: [16 - d, y0, 0], to: [16, y1, d] }];
  if (shape === 'inner_left') {
    return [
      { from: [0, y0, 0], to: [16, y1, d] },
      { from: [0, y0, d], to: [d, y1, 16] },
    ];
  }
  if (shape === 'inner_right') {
    return [
      { from: [0, y0, 0], to: [16, y1, d] },
      { from: [16 - d, y0, d], to: [16, y1, 16] },
    ];
  }
  return [{ from: [0, y0, 0], to: [16, y1, d] }];
};

export const stairBoxes = (
  props: Readonly<Record<string, string>>,
  facing: CardinalFacing,
): readonly LocalBoxSpec[] => {
  const topHalf = props.half === 'top';
  const shape = props.shape ?? 'straight';
  const out: LocalBoxSpec[] = [];
  for (let i = 0; i < 4; i += 1) {
    const y0 = topHalf ? 12 - i * 4 : i * 4;
    const d = 16 - i * 4;
    for (const box of stairStepBoxes(shape, y0, y0 + 4, d)) out.push(rotateBox(box, facing));
  }
  return out;
};

export const bedBoxes = (
  props: Readonly<Record<string, string>>,
  facing: CardinalFacing,
): readonly LocalBoxSpec[] => {
  const boxes: LocalBoxSpec[] = [
    bx(0, 0, 0, 2.5, 4, 2.5, 'spruce_planks'),
    bx(13.5, 0, 0, 16, 4, 2.5, 'spruce_planks'),
    bx(0, 0, 13.5, 2.5, 4, 16, 'spruce_planks'),
    bx(13.5, 0, 13.5, 16, 4, 16, 'spruce_planks'),
    bx(0, 3, 2, 1.5, 6, 14, 'timber_trim'),
    bx(14.5, 3, 2, 16, 6, 14, 'timber_trim'),
    bx(1, 4, 1, 15, 8.5, 15, 'plaster_white'),
  ];
  if (props.part === 'head') {
    boxes.push(
      bx(0, 4, 0, 16, 14, 2, 'spruce_planks'),
      bx(0, 4, 0, 2.5, 16, 2.5, 'timber_trim'),
      bx(13.5, 4, 0, 16, 16, 2.5, 'timber_trim'),
      bx(2.5, 8.5, 2, 13.5, 11, 6.5, 'plaster_white'),
      { from: [1, 8.5, 7], to: [15, 9.8, 16], role: 'top', layer: 'opaque' },
    );
  } else {
    boxes.push(
      bx(0, 4, 14, 16, 10, 16, 'spruce_planks'),
      bx(0, 4, 13.5, 2.5, 12, 16, 'timber_trim'),
      bx(13.5, 4, 13.5, 16, 12, 16, 'timber_trim'),
      { from: [1, 8.5, 0], to: [15, 9.8, 14], role: 'top', layer: 'opaque' },
      bx(1, 9.8, 0, 15, 10.6, 3, 'plaster_white'),
    );
  }
  return boxes.map((b) => rotateBox(b, facing));
};

export const tableBoxes = (): readonly LocalBoxSpec[] => [
  { from: [0, 13.5, 0], to: [16, 16, 16], role: 'top', layer: 'opaque' },
  { from: [0.75, 12, 0.75], to: [15.25, 13.5, 15.25], role: 'side', layer: 'opaque' },
  { from: [1.5, 0, 1.5], to: [4, 12, 4], role: 'side', layer: 'opaque' },
  { from: [12, 0, 1.5], to: [14.5, 12, 4], role: 'side', layer: 'opaque' },
  { from: [1.5, 0, 12], to: [4, 12, 14.5], role: 'side', layer: 'opaque' },
  { from: [12, 0, 12], to: [14.5, 12, 14.5], role: 'side', layer: 'opaque' },
  bx(2, 3, 4, 3.5, 4.5, 12, 'timber_trim'),
  bx(12.5, 3, 4, 14, 4.5, 12, 'timber_trim'),
  bx(3.5, 3, 7.25, 12.5, 4.5, 8.75, 'timber_trim'),
];

export const campfireBoxes = (): readonly LocalBoxSpec[] => [
  bx(1, 0, 2, 15, 4, 6, 'spruce_planks'),
  bx(1, 0, 10, 15, 4, 14, 'spruce_planks'),
  bx(2, 3.5, 1, 6, 7.5, 15, 'oak_planks'),
  bx(10, 3.5, 1, 14, 7.5, 15, 'oak_planks'),
  em(3, 0, 3, 13, 2.5, 13, 'hearth_ember'),
  em(5, 2.5, 5, 11, 10, 11),
];

export const lanternBoxes = (props: Readonly<Record<string, string>>): readonly LocalBoxSpec[] => {
  const hanging = props.hanging === 'true';
  const y = hanging ? 2 : 0;
  return [
    em(5, y + 1, 5, 11, y + 7, 11),
    bx(4.5, y, 4.5, 11.5, y + 1, 11.5, 'iron_flue'),
    bx(4.5, y + 7, 4.5, 11.5, y + 8.5, 11.5, 'iron_flue'),
    bx(6, y + 8.5, 6, 10, y + 10, 10, 'iron_flue'),
    bx(4.5, y + 1, 4.5, 5.5, y + 7, 5.5, 'iron_flue'),
    bx(10.5, y + 1, 4.5, 11.5, y + 7, 5.5, 'iron_flue'),
    bx(4.5, y + 1, 10.5, 5.5, y + 7, 11.5, 'iron_flue'),
    bx(10.5, y + 1, 10.5, 11.5, y + 7, 11.5, 'iron_flue'),
    ...(hanging ? [bx(7.25, y + 10, 7.25, 8.75, 16, 8.75, 'iron_flue')] : []),
  ];
};

export const torchBoxes = (name: string, facing: CardinalFacing): readonly LocalBoxSpec[] => {
  if (name.includes('wall_torch')) {
    return [
      bx(6.5, 4, 14.5, 9.5, 8, 16, 'iron_flue'),
      bx(7, 5, 11, 9, 7, 14.5, 'iron_flue'),
      bx(7.25, 5, 11.5, 8.75, 10.5, 13, 'spruce_planks'),
      em(6.5, 10, 10.75, 9.5, 13.5, 13.75),
    ].map((b) => rotateBox(b, facing));
  }
  return [
    bx(6.5, 0, 6.5, 9.5, 1.5, 9.5, 'iron_flue'),
    bx(6.75, 8, 6.75, 9.25, 9, 9.25, 'iron_flue'),
    bx(7.25, 1.5, 7.25, 8.75, 8.5, 8.75, 'spruce_planks'),
    em(6.5, 8.8, 6.5, 9.5, 12, 9.5),
  ];
};

const orientDoorBox = (
  spec: LocalBoxSpec,
  isOpen: boolean,
  hingeLeft: boolean,
  facing: CardinalFacing,
): LocalBoxSpec => {
  const [x0, y0, z0] = spec.from;
  const [x1, y1, z1] = spec.to;
  const leaf: LocalBoxSpec = !isOpen
    ? spec
    : hingeLeft
      ? { ...spec, from: [z0, y0, x0], to: [z1, y1, x1] }
      : { ...spec, from: [16 - z1, y0, x0], to: [16 - z0, y1, x1] };
  return rotateBox(leaf, facing);
};

export const doorBoxes = (
  desc: BlockDescriptor,
  props: Readonly<Record<string, string>>,
  facing: CardinalFacing,
): readonly LocalBoxSpec[] => {
  const isIron = desc.front === 'iron_door';
  const trim = isIron ? 'iron_flue' : 'timber_trim';
  const panel = isIron
    ? 'iron_block'
    : desc.front === 'spruce_door'
      ? 'spruce_planks'
      : 'oak_planks';
  const hingeLeft = props.hinge !== 'right';
  const raw: LocalBoxSpec[] = [
    bx(0, 0, 0, 2.5, 16, 3, trim),
    bx(13.5, 0, 0, 16, 16, 3, trim),
    bx(2.5, 13.5, 0, 13.5, 16, 3, trim),
  ];
  if (props.half === 'upper') {
    raw.push(
      bx(2.5, 0, 0, 13.5, 2, 3, trim),
      bx(2.5, 2, 0.75, 13.5, 13.5, 2.25, isIron ? 'iron_bars' : 'glass', 'cutout'),
      bx(7.25, 2, 0.5, 8.75, 13.5, 2.5, trim),
      bx(2.5, 7, 0.5, 13.5, 8.5, 2.5, trim),
    );
  } else {
    const hx = hingeLeft ? 11.5 : 3;
    raw.push(
      bx(2.5, 0, 0, 13.5, 2.5, 3, trim),
      bx(2.5, 2.5, 0.5, 13.5, 13.5, 2.5, panel),
      bx(hx, 12, -0.4, hx + 1.5, 14, 3.4, isIron ? 'iron_flue' : 'gold_block'),
    );
  }
  return raw.map((b) => orientDoorBox(b, props.open === 'true', hingeLeft, facing));
};

const paneConns = (
  props: Readonly<Record<string, string>>,
  conns: readonly boolean[],
): readonly [boolean, boolean, boolean, boolean] => {
  const on = (dir: string, idx: number): boolean => {
    const pVal = props[dir];
    return pVal !== undefined ? pVal !== 'none' && pVal !== 'false' : Boolean(conns[idx]);
  };
  return [on('north', 0), on('south', 1), on('east', 2), on('west', 3)];
};

const paneArmCoords: readonly [number, number, number, number][] = [
  [7, 0, 9, 7],
  [7, 9, 9, 16],
  [9, 7, 16, 9],
  [0, 7, 7, 9],
];
const mullionArmCoords: readonly [number, number, number, number][] = [
  [6.75, 0, 9.25, 7.25],
  [6.75, 8.75, 9.25, 16],
  [8.75, 6.75, 16, 9.25],
  [0, 6.75, 7.25, 9.25],
];

export const glassPaneBoxes = (
  parsed: ParsedBlockState,
  conns: readonly boolean[],
  glow: boolean,
): readonly LocalBoxSpec[] => {
  const active = paneConns(parsed.properties, conns);
  const gTile = glow ? 'window_glow' : 'glass';
  const gBox = (x0: number, z0: number, x1: number, z1: number) =>
    glow ? em(x0, 0, z0, x1, 16, z1, gTile) : bx(x0, 0, z0, x1, 16, z1, gTile, 'cutout');
  const ewOnly = (active[2] || active[3]) && !active[0] && !active[1];
  const nsOnly = (active[0] || active[1]) && !active[2] && !active[3];
  const boxes: LocalBoxSpec[] = [
    gBox(7, 7, 9, 9),
    bx(
      ewOnly ? 7.25 : 6.75,
      0,
      nsOnly ? 7.25 : 6.75,
      ewOnly ? 8.75 : 9.25,
      16,
      nsOnly ? 8.75 : 9.25,
      'timber_trim',
    ),
    bx(6.75, 7.25, 6.75, 9.25, 8.75, 9.25, 'timber_trim'),
  ];
  for (let i = 0; i < 4; i += 1) {
    if (!active[i]) continue;
    const [gx0, gz0, gx1, gz1] = paneArmCoords[i]!;
    const [mx0, mz0, mx1, mz1] = mullionArmCoords[i]!;
    boxes.push(gBox(gx0, gz0, gx1, gz1), bx(mx0, 7.25, mz0, mx1, 8.75, mz1, 'timber_trim'));
  }
  return boxes;
};

export const corbelStepSpecs = (dir: CardinalFacing): readonly LocalBoxSpec[] => {
  const alongX = dir === 'east' || dir === 'west';
  const inwardLow = dir === 'east' || dir === 'south';
  return [0, 1, 2].map((step) => {
    const reach = step === 0 ? 5 : step === 1 ? 11 : 16;
    const y0 = 4 + step * 4;
    const d0 = inwardLow ? 0 : 16 - reach;
    const d1 = inwardLow ? reach : 16;
    return alongX
      ? bx(d0, y0, 6, d1, y0 + 4, 10, 'timber_trim')
      : bx(6, y0, d0, 10, y0 + 4, d1, 'timber_trim');
  });
};

export const flowerBoxSpecs = (wall: CardinalFacing): readonly LocalBoxSpec[] => [
  rotateBox(bx(1, 10, 11, 15, 16, 16, 'flower_box'), wall),
  rotateBox(bx(2, 8.5, 12, 14, 10, 16, 'timber_trim'), wall),
];

export const chimneyCapSpecs = (collarTile: string, onSlab: boolean): readonly LocalBoxSpec[] =>
  onSlab
    ? [bx(4, 8, 4, 12, 15, 12, 'iron_flue'), bx(3.5, 14.5, 3.5, 12.5, 16, 12.5, 'iron_flue')]
    : [
        bx(2, 0, 2, 14, 3, 14, collarTile),
        bx(4, 3, 4, 12, 11, 12, 'iron_flue'),
        bx(3.5, 11, 3.5, 12.5, 12.5, 12.5, 'iron_flue'),
      ];

export const windowMullionSpecs = (alongX: boolean): readonly LocalBoxSpec[] => [
  bx(
    alongX ? 7.4 : 6.8,
    0,
    alongX ? 6.8 : 7.4,
    alongX ? 8.6 : 9.2,
    16,
    alongX ? 9.2 : 8.6,
    'timber_trim',
  ),
  alongX
    ? bx(0, 7.4, 6.8, 16, 8.6, 9.2, 'timber_trim')
    : bx(6.8, 7.4, 0, 9.2, 8.6, 16, 'timber_trim'),
];

export const pilasterSpecs = (ox: -1 | 1, oz: -1 | 1): readonly LocalBoxSpec[] => {
  const ax0 = ox < 0 ? -2 : 16;
  const az0 = oz < 0 ? -2 : 11;
  const bx0 = ox < 0 ? 0 : 11;
  const bz0 = oz < 0 ? -2 : 16;
  return [
    bx(ax0, 0, az0, ax0 + 2, 16, az0 + 7, 'timber_trim'),
    bx(bx0, 0, bz0, bx0 + 5, 16, bz0 + 2, 'timber_trim'),
  ];
};

export const writeStripSpec = (
  out: { from: [number, number, number]; to: [number, number, number]; tileOverride?: string },
  dir: CardinalFacing,
  depth: number,
  u0: number,
  u1: number,
  y0: number,
  y1: number,
  tileId: string,
): void => {
  out.tileOverride = tileId;
  if (dir === 'north') {
    out.from[0] = u0;
    out.from[1] = y0;
    out.from[2] = -depth;
    out.to[0] = u1;
    out.to[1] = y1;
    out.to[2] = 0;
  } else if (dir === 'south') {
    out.from[0] = u0;
    out.from[1] = y0;
    out.from[2] = 16;
    out.to[0] = u1;
    out.to[1] = y1;
    out.to[2] = 16 + depth;
  } else if (dir === 'west') {
    out.from[0] = -depth;
    out.from[1] = y0;
    out.from[2] = u0;
    out.to[0] = 0;
    out.to[1] = y1;
    out.to[2] = u1;
  } else {
    out.from[0] = 16;
    out.from[1] = y0;
    out.from[2] = u0;
    out.to[0] = 16 + depth;
    out.to[1] = y1;
    out.to[2] = u1;
  }
};

export const CARDINALS: readonly CardinalFacing[] = ['north', 'south', 'east', 'west'];
export const OUTWARD: Readonly<Record<CardinalFacing, readonly [number, number]>> = {
  north: [0, -1],
  south: [0, 1],
  east: [1, 0],
  west: [-1, 0],
};
export const OPPOSITE: Readonly<Record<CardinalFacing, CardinalFacing>> = {
  north: 'south',
  south: 'north',
  east: 'west',
  west: 'east',
};
export const PERP_DIRS: Readonly<
  Record<CardinalFacing, readonly [CardinalFacing, CardinalFacing]>
> = {
  north: ['west', 'east'],
  south: ['west', 'east'],
  east: ['north', 'south'],
  west: ['north', 'south'],
};

export const isTimberWallTile = (t: string): boolean =>
  t.includes('plank') || t.includes('log') || t === 'plaster_white' || t === 'terracotta';

export const isChimneyBrickTile = (tile: string): boolean =>
  tile === 'bricks' || tile === 'deepslate_tiles' || tile === 'deepslate_bricks';

const addUpperLevels = <T>(
  levels: Set<number>,
  items: readonly T[],
  yOf: (item: T) => number,
): void => {
  if (items.length === 0) return;
  let minY = yOf(items[0]!);
  for (const item of items) minY = Math.min(minY, yOf(item));
  for (const item of items) if (yOf(item) > minY) levels.add(yOf(item));
};

export const collectBeltCourseLevels = (grid: StructureGrid): readonly number[] => {
  const levels = new Set<number>();
  addUpperLevels(levels, grid.floors, (f) => f.y);
  addUpperLevels(levels, grid.rooms, (r) => r.from[1]);
  return [...levels].sort((a, b) => a - b);
};

export const openingSpan = (op: StructureOpeningMeta) => {
  const alongX = op.wall === 'north' || op.wall === 'south';
  const tx = alongX ? 1 : 0;
  const tz = alongX ? 0 : 1;
  const len = (alongX ? op.to[0] - op.from[0] : op.to[2] - op.from[2]) + 1;
  return { alongX, tx, tz, len };
};

export const voxelAt = (grid: StructureGrid, x: number, y: number, z: number): number => {
  const [w, h, d] = grid.size;
  return x < 0 || x >= w || y < 0 || y >= h || z < 0 || z >= d
    ? -1
    : grid.voxels[(y * d + z) * w + x]!;
};

export const isSolidOpaqueAt = (
  grid: StructureGrid,
  descriptors: readonly BlockDescriptor[],
  x: number,
  y: number,
  z: number,
): boolean => {
  const v = voxelAt(grid, x, y, z);
  if (v <= 0) return false;
  const [w, _h, d] = grid.size;
  return grid.customTags[(y * d + z) * w + x] === null && descriptors[v]!.solidOpaque;
};

export const isTrueAirAt = (
  grid: StructureGrid,
  descriptors: readonly BlockDescriptor[],
  x: number,
  y: number,
  z: number,
): boolean => {
  const v = voxelAt(grid, x, y, z);
  return v <= 0 || !descriptors[v]!.solidOpaque;
};

export const isTimberRoom = (
  grid: StructureGrid,
  descriptors: readonly BlockDescriptor[],
  room: StructureRoomMeta,
): boolean => {
  const [x0, y0, z0] = room.from;
  const [x1, y1, z1] = room.to;
  const my = Math.min(y1 - 1, Math.max(y0 + 1, Math.floor((y0 + y1) / 2)));
  const probes: readonly [number, number][] = [
    [x0, z0],
    [x1, z0],
    [x0 + 1, z0],
    [x0, z0 + 1],
    [x1, z1],
  ];
  return probes.some(([px, pz]) => {
    const v = voxelAt(grid, px, my, pz);
    return v > 0 && isTimberWallTile(descriptors[v]!.side);
  });
};
