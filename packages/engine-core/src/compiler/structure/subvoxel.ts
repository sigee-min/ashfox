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
  readonly skipMask?: number;
}

const MASK_UD = 48;
const MASK_D = 32;
const MASK_U = 16;

const bx = (
  x0: number,
  y0: number,
  z0: number,
  x1: number,
  y1: number,
  z1: number,
  tileOverride?: string,
  layer: BlockRenderLayer = 'opaque',
  skipMask = 0,
): LocalBoxSpec => ({
  from: [x0, y0, z0],
  to: [x1, y1, z1],
  layer,
  ...(tileOverride ? { tileOverride } : {}),
  ...(skipMask ? { skipMask } : {}),
});

const em = (
  x0: number,
  y0: number,
  z0: number,
  x1: number,
  y1: number,
  z1: number,
  tileOverride?: string,
  skipMask = 0,
): LocalBoxSpec => ({
  from: [x0, y0, z0],
  to: [x1, y1, z1],
  emissive: true,
  layer: 'emissive',
  ...(tileOverride ? { tileOverride } : {}),
  ...(skipMask ? { skipMask } : {}),
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
  const head = props.part === 'head';
  const b: LocalBoxSpec[] = [
    bx(0, 0, 0, 2.5, 4, 2.5, 'spruce_planks'),
    bx(13.5, 0, 0, 16, 4, 2.5, 'spruce_planks'),
    bx(0, 0, 13.5, 2.5, 4, 16, 'spruce_planks'),
    bx(13.5, 0, 13.5, 16, 4, 16, 'spruce_planks'),
    bx(0, 3, 2, 1.5, 6, 14, 'timber_trim'),
    bx(14.5, 3, 2, 16, 6, 14, 'timber_trim'),
    bx(1, 4, 1, 15, 8.5, 15, 'plaster_white'),
    bx(0, 4, head ? 0 : 14, 16, head ? 14 : 10, head ? 2 : 16, 'spruce_planks'),
    bx(0, 4, head ? 0 : 13.5, 2.5, head ? 16 : 12, head ? 2.5 : 16, 'timber_trim'),
    bx(13.5, 4, head ? 0 : 13.5, 16, head ? 16 : 12, head ? 2.5 : 16, 'timber_trim'),
    {
      from: [1, 8.5, head ? 7 : 0],
      to: [15, 9.8, head ? 16 : 14],
      role: 'top',
      layer: 'opaque',
      skipMask: MASK_D,
    },
    head
      ? bx(2.5, 8.5, 2, 13.5, 11, 6.5, 'plaster_white')
      : bx(1, 9.8, 0, 15, 10.6, 3, 'plaster_white'),
  ];
  return b.map((spec) => rotateBox(spec, facing));
};

export const tableBoxes = (): readonly LocalBoxSpec[] => [
  { from: [0, 13.5, 0], to: [16, 16, 16], role: 'top', layer: 'opaque' },
  {
    from: [0.75, 12, 0.75],
    to: [15.25, 13.5, 15.25],
    role: 'side',
    layer: 'opaque',
    skipMask: MASK_U,
  },
  { from: [1.5, 0, 1.5], to: [4, 12, 4], role: 'side', layer: 'opaque', skipMask: MASK_U },
  { from: [12, 0, 1.5], to: [14.5, 12, 4], role: 'side', layer: 'opaque', skipMask: MASK_U },
  { from: [1.5, 0, 12], to: [4, 12, 14.5], role: 'side', layer: 'opaque', skipMask: MASK_U },
  { from: [12, 0, 12], to: [14.5, 12, 14.5], role: 'side', layer: 'opaque', skipMask: MASK_U },
  bx(2, 3, 4, 3.5, 4.5, 12, 'timber_trim'),
  bx(12.5, 3, 4, 14, 4.5, 12, 'timber_trim'),
  bx(3.5, 3, 7.25, 12.5, 4.5, 8.75, 'timber_trim'),
];

export const campfireBoxes = (): readonly LocalBoxSpec[] => [
  bx(1, 0, 2, 15, 4, 6, 'spruce_planks'),
  bx(1, 0, 10, 15, 4, 14, 'spruce_planks'),
  bx(2, 3.5, 1, 6, 7.5, 15, 'oak_planks'),
  bx(10, 3.5, 1, 14, 7.5, 15, 'oak_planks'),
  em(3, 0, 3, 13, 2.5, 13, 'hearth_ember', MASK_D),
  em(5, 2.5, 5, 11, 10, 11, undefined, MASK_D),
];

export const lanternBoxes = (props: Readonly<Record<string, string>>): readonly LocalBoxSpec[] => {
  const y = props.hanging === 'true' ? 2 : 0;
  const out: LocalBoxSpec[] = [
    em(5, y + 1, 5, 11, y + 7, 11, undefined, MASK_UD),
    bx(4.5, y, 4.5, 11.5, y + 1, 11.5, 'iron_flue'),
    bx(4.5, y + 7, 4.5, 11.5, y + 8.5, 11.5, 'iron_flue'),
    bx(6, y + 8.5, 6, 10, y + 10, 10, 'iron_flue', 'opaque', MASK_D),
    bx(4.5, y + 1, 4.5, 5.5, y + 7, 5.5, 'iron_flue', 'opaque', MASK_UD),
    bx(10.5, y + 1, 4.5, 11.5, y + 7, 5.5, 'iron_flue', 'opaque', MASK_UD),
    bx(4.5, y + 1, 10.5, 5.5, y + 7, 11.5, 'iron_flue', 'opaque', MASK_UD),
    bx(10.5, y + 1, 10.5, 11.5, y + 7, 11.5, 'iron_flue', 'opaque', MASK_UD),
  ];
  if (y > 0) out.push(bx(7.25, y + 10, 7.25, 8.75, 16, 8.75, 'iron_flue', 'opaque', MASK_D));
  return out;
};

export const torchBoxes = (name: string, facing: CardinalFacing): readonly LocalBoxSpec[] =>
  name.includes('wall_torch')
    ? [
        bx(6.5, 4, 14.5, 9.5, 8, 16, 'iron_flue'),
        bx(7, 5, 11, 9, 7, 14.5, 'iron_flue'),
        bx(7.25, 5, 11.5, 8.75, 10.5, 13, 'spruce_planks'),
        em(6.5, 10, 10.75, 9.5, 13.5, 13.75),
      ].map((b) => rotateBox(b, facing))
    : [
        bx(6.5, 0, 6.5, 9.5, 1.5, 9.5, 'iron_flue'),
        bx(6.75, 8, 6.75, 9.25, 9, 9.25, 'iron_flue'),
        bx(7.25, 1.5, 7.25, 8.75, 8.5, 8.75, 'spruce_planks', 'opaque', MASK_UD),
        em(6.5, 8.8, 6.5, 9.5, 12, 9.5, undefined, MASK_D),
      ];

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

const paneCullBox = (
  x0: number,
  y0: number,
  z0: number,
  x1: number,
  y1: number,
  z1: number,
  tile: string,
  layer: BlockRenderLayer,
  glow: boolean,
): LocalBoxSpec =>
  glow ? em(x0, y0, z0, x1, y1, z1, tile) : bx(x0, y0, z0, x1, y1, z1, tile, layer);

const mullionSpan = (low: boolean, high: boolean): readonly [number, number] => [
  low ? 0 : 6.75,
  high ? 16 : 9.25,
];

const appendPaneMullions = (
  boxes: LocalBoxSpec[],
  n: boolean,
  s: boolean,
  e: boolean,
  w: boolean,
): void => {
  const ew = e || w;
  const ns = n || s;
  const rx = ew && !ns ? 0.75 : 1.25;
  const rz = ns && !ew ? 0.75 : 1.25;
  boxes.push(bx(8 - rx, 0, 8 - rz, 8 + rx, 16, 8 + rz, 'timber_trim'));
  if (ew || !ns) {
    const [x0, x1] = mullionSpan(w, e);
    boxes.push(bx(x0, 7.25, 6.75, x1, 8.75, 9.25, 'timber_trim'));
  }
  if (ns) {
    const [z0, z1] = mullionSpan(n, s);
    boxes.push(bx(6.75, 7.25, z0, 9.25, 8.75, z1, 'timber_trim'));
  }
};

export const glassPaneBoxes = (
  parsed: ParsedBlockState,
  conns: readonly boolean[],
  glow: boolean,
): readonly LocalBoxSpec[] => {
  const [n, s, e, w] = paneConns(parsed.properties, conns);
  const gTile = glow ? 'window_glow' : 'glass';
  const g = (x0: number, z0: number, x1: number, z1: number) =>
    paneCullBox(x0, 0, z0, x1, 16, z1, gTile, 'cutout', glow);
  const [x0, x1] = [w ? 0 : 7, e ? 16 : 9];
  const [z0, z1] = [n ? 0 : 7, s ? 16 : 9];
  const boxes: LocalBoxSpec[] = [];
  if (!e && !w) {
    boxes.push(g(7, z0, 9, z1));
  } else {
    boxes.push(g(x0, 7, x1, 9));
    if (n) boxes.push(g(7, 0, 9, 7));
    if (s) boxes.push(g(7, 9, 9, 16));
  }
  appendPaneMullions(boxes, n, s, e, w);
  return boxes;
};

export const corbelStepSpecs = (dir: CardinalFacing): readonly LocalBoxSpec[] => {
  const alongX = dir === 'east' || dir === 'west';
  const inwardLow = dir === 'east' || dir === 'south';
  const d0 = inwardLow ? 0 : 4;
  const d1 = inwardLow ? 12 : 16;
  return [
    alongX
      ? bx(d0, 9, 5.5, d1, 16, 10.5, 'timber_trim', 'opaque', MASK_U)
      : bx(5.5, 9, d0, 10.5, 16, d1, 'timber_trim', 'opaque', MASK_U),
  ];
};

export const chimneyCapSpecs = (collarTile: string, onSlab: boolean): readonly LocalBoxSpec[] =>
  onSlab
    ? [
        bx(4, 8, 4, 12, 15, 12, 'iron_flue', 'opaque', MASK_UD),
        bx(3.5, 14.5, 3.5, 12.5, 16, 12.5, 'iron_flue', 'opaque', MASK_D),
      ]
    : [
        bx(2, 0, 2, 14, 3, 14, collarTile, 'opaque', MASK_D),
        bx(4, 3, 4, 12, 11, 12, 'iron_flue', 'opaque', MASK_UD),
        bx(3.5, 11, 3.5, 12.5, 12.5, 12.5, 'iron_flue', 'opaque', MASK_D),
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
  const [ax0, az0] = [ox < 0 ? -2 : 16, oz < 0 ? -2 : 11];
  const [bx0, bz0] = [ox < 0 ? 0 : 11, oz < 0 ? -2 : 16];
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
  out.from[1] = y0;
  out.to[1] = y1;
  const n = dir === 'north' || dir === 'west';
  const zAxis = dir === 'north' || dir === 'south';
  const d0 = n ? -depth : 16;
  const d1 = n ? 0 : 16 + depth;
  out.from[0] = zAxis ? u0 : d0;
  out.to[0] = zAxis ? u1 : d1;
  out.from[2] = zAxis ? d0 : u0;
  out.to[2] = zAxis ? d1 : u1;
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

export const isChimneyBrickTile = (t: string): boolean =>
  t === 'bricks' || t === 'deepslate_tiles' || t === 'deepslate_bricks';

const addUpperLevels = <T>(levels: Set<number>, items: readonly T[], yOf: (item: T) => number) => {
  if (items.length === 0) return;
  const minY = items.reduce((m, item) => Math.min(m, yOf(item)), yOf(items[0]!));
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
  const [tx, tz] = [alongX ? 1 : 0, alongX ? 0 : 1];
  return { alongX, tx, tz, len: (alongX ? op.to[0] - op.from[0] : op.to[2] - op.from[2]) + 1 };
};

export const voxelAt = (grid: StructureGrid, x: number, y: number, z: number): number => {
  const s = grid.size;
  return x < 0 || x >= s[0] || y < 0 || y >= s[1] || z < 0 || z >= s[2]
    ? -1
    : grid.voxels[(y * s[2] + z) * s[0] + x]!;
};

export const isSolidOpaqueAt = (
  grid: StructureGrid,
  descriptors: readonly BlockDescriptor[],
  x: number,
  y: number,
  z: number,
): boolean => {
  const s = grid.size;
  if (x < 0 || x >= s[0] || y < 0 || y >= s[1] || z < 0 || z >= s[2]) return false;
  const idx = (y * s[2] + z) * s[0] + x;
  const v = grid.voxels[idx]!;
  return v > 0 && grid.customTags[idx] === null && descriptors[v]!.solidOpaque;
};

export const isTrueAirAt = (
  grid: StructureGrid,
  descriptors: readonly BlockDescriptor[],
  x: number,
  y: number,
  z: number,
): boolean => {
  const s = grid.size;
  if (x < 0 || x >= s[0] || y < 0 || y >= s[1] || z < 0 || z >= s[2]) return true;
  const v = grid.voxels[(y * s[2] + z) * s[0] + x]!;
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
  return [
    [x0, z0],
    [x1, z0],
    [x0 + 1, z0],
    [x0, z0 + 1],
    [x1, z1],
  ].some(([px, pz]) => {
    const v = voxelAt(grid, px!, my, pz!);
    return v > 0 && isTimberWallTile(descriptors[v]!.side);
  });
};
