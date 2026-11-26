import type { Vec3 } from '../../model/identity';
import type { AxisCubeNode, CubeFace, CubeFaceDirection, CubeFaces } from '../../model/scene';
import type { CardinalFacing } from '../../project/structure/contract';
import type { ParsedBlockState } from '../../project/structure/state';
import type { TileUvRef } from './atlas';
import type { BlockDescriptor } from './blocks';

export interface CachedBlockState {
  readonly parsed: ParsedBlockState;
  readonly facing: CardinalFacing;
}

export interface LocalBoxSpec {
  readonly from: Vec3;
  readonly to: Vec3;
  readonly role?: 'front' | 'top' | 'bottom' | 'side';
  readonly emissive?: boolean;
  readonly tileOverride?: string;
}

const DIRS: readonly CubeFaceDirection[] = ['north', 'south', 'east', 'west', 'up', 'down'];

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

const rotateBox = (spec: LocalBoxSpec, facing: CardinalFacing): LocalBoxSpec =>
  normBounds(rotatePointXZ(spec.from, facing), rotatePointXZ(spec.to, facing), spec);

export const tileForFace = (
  desc: BlockDescriptor,
  dir: CubeFaceDirection,
  facing: CardinalFacing,
): string => {
  if (dir === 'up') return desc.top;
  if (dir === 'down') return desc.bottom;
  return dir === facing ? desc.front : desc.side;
};

export const makeFace = (uvRef: TileUvRef, enabled = true): CubeFace => ({
  enabled,
  textureId: uvRef.textureId,
  uv: [uvRef.u, uvRef.v, uvRef.u + uvRef.size, uvRef.v + uvRef.size],
  rotation: 0,
});

export const makeBoxFaces = (
  desc: BlockDescriptor,
  facing: CardinalFacing,
  uvs: ReadonlyMap<string, TileUvRef>,
  visible: readonly boolean[] = [true, true, true, true, true, true],
): CubeFaces => {
  const entries = DIRS.map((dir, i) => {
    const tile = tileForFace(desc, dir, facing);
    const ref = uvs.get(`${desc.layer}:${tile}`) ?? [...uvs.values()][0]!;
    return [dir, makeFace(ref, visible[i]!)];
  });
  return Object.fromEntries(entries) as CubeFaces;
};

const stairBoxes = (
  props: Readonly<Record<string, string>>,
  facing: CardinalFacing,
): readonly LocalBoxSpec[] => {
  const topHalf = props.half === 'top';
  const baseY0 = topHalf ? 8 : 0;
  const baseY1 = topHalf ? 16 : 8;
  const stepY0 = topHalf ? 0 : 8;
  const stepY1 = topHalf ? 8 : 16;
  const base: LocalBoxSpec = { from: [0, baseY0, 0], to: [16, baseY1, 16] };
  const shape = props.shape ?? 'straight';
  if (shape === 'outer_left') {
    return [base, rotateBox({ from: [0, stepY0, 0], to: [8, stepY1, 8] }, facing)];
  }
  if (shape === 'outer_right') {
    return [base, rotateBox({ from: [8, stepY0, 0], to: [16, stepY1, 8] }, facing)];
  }
  if (shape === 'inner_left') {
    return [
      base,
      rotateBox({ from: [0, stepY0, 0], to: [16, stepY1, 8] }, facing),
      rotateBox({ from: [0, stepY0, 8], to: [8, stepY1, 16] }, facing),
    ];
  }
  if (shape === 'inner_right') {
    return [
      base,
      rotateBox({ from: [0, stepY0, 0], to: [16, stepY1, 8] }, facing),
      rotateBox({ from: [8, stepY0, 8], to: [16, stepY1, 16] }, facing),
    ];
  }
  return [base, rotateBox({ from: [0, stepY0, 0], to: [16, stepY1, 8] }, facing)];
};

const fenceBoxes = (
  props: Readonly<Record<string, string>>,
  conns: readonly boolean[],
): readonly LocalBoxSpec[] => {
  const boxes: LocalBoxSpec[] = [{ from: [6, 0, 6], to: [10, 16, 10] }];
  const active = [
    props.north === 'true' || Boolean(conns[0]),
    props.south === 'true' || Boolean(conns[1]),
    props.east === 'true' || Boolean(conns[2]),
    props.west === 'true' || Boolean(conns[3]),
  ];
  const segments: readonly [boolean, number, number, number, number][] = [
    [active[0]!, 7, 0, 9, 6],
    [active[1]!, 7, 10, 9, 16],
    [active[2]!, 10, 7, 16, 9],
    [active[3]!, 0, 7, 6, 9],
  ];
  for (const [on, x0, z0, x1, z1] of segments) {
    if (!on) continue;
    boxes.push({ from: [x0, 6, z0], to: [x1, 9, z1] });
    boxes.push({ from: [x0, 12, z0], to: [x1, 15, z1] });
  }
  return boxes;
};

const wallOrPaneBoxes = (
  shape: 'wall' | 'pane',
  props: Readonly<Record<string, string>>,
  conns: readonly boolean[],
): readonly LocalBoxSpec[] => {
  const r = shape === 'pane' ? 1 : 4;
  const armR = shape === 'pane' ? 1 : 3;
  const armH = shape === 'wall' ? 14 : 16;
  const boxes: LocalBoxSpec[] = [{ from: [8 - r, 0, 8 - r], to: [8 + r, 16, 8 + r] }];
  const dirs = ['north', 'south', 'east', 'west'] as const;
  const coords: readonly [number, number, number, number][] = [
    [8 - armR, 0, 8 + armR, 8 - r],
    [8 - armR, 8 + r, 8 + armR, 16],
    [8 + r, 8 - armR, 16, 8 + armR],
    [0, 8 - armR, 8 - r, 8 + armR],
  ];
  for (let i = 0; i < 4; i += 1) {
    const pVal = props[dirs[i]!];
    const on = pVal !== undefined ? pVal !== 'none' && pVal !== 'false' : Boolean(conns[i]);
    if (!on) continue;
    const [x0, z0, x1, z1] = coords[i]!;
    boxes.push({ from: [x0, 0, z0], to: [x1, armH, z1] });
  }
  return boxes;
};

const doorBoxes = (
  props: Readonly<Record<string, string>>,
  facing: CardinalFacing,
): readonly LocalBoxSpec[] => {
  const isOpen = props.open === 'true';
  const hingeLeft = props.hinge === 'left';
  const raw: LocalBoxSpec = !isOpen
    ? { from: [0, 0, 0], to: [16, 16, 3] }
    : hingeLeft
      ? { from: [0, 0, 0], to: [3, 16, 16] }
      : { from: [13, 0, 0], to: [16, 16, 16] };
  return [rotateBox(raw, facing)];
};

const bedBoxes = (
  props: Readonly<Record<string, string>>,
  facing: CardinalFacing,
): readonly LocalBoxSpec[] => {
  const boxes: LocalBoxSpec[] = [
    { from: [0, 3, 0], to: [16, 9, 16] },
    { from: [0, 0, 0], to: [3, 3, 3] },
    { from: [13, 0, 0], to: [16, 3, 3] },
    { from: [0, 0, 13], to: [3, 3, 16] },
    { from: [13, 0, 13], to: [16, 3, 16] },
  ];
  if (props.part === 'head') {
    boxes.push(rotateBox({ from: [2, 9, 1], to: [14, 11, 6] }, facing));
  }
  return boxes;
};

const anvilBoxes = (facing: CardinalFacing): readonly LocalBoxSpec[] => [
  rotateBox({ from: [2, 0, 2], to: [14, 4, 14] }, facing),
  rotateBox({ from: [4, 4, 3], to: [12, 5, 13] }, facing),
  rotateBox({ from: [6, 5, 4], to: [10, 10, 12] }, facing),
  rotateBox({ from: [3, 10, 0], to: [13, 16, 16] }, facing),
];

const tableBoxes = (): readonly LocalBoxSpec[] => [
  { from: [0, 12, 0], to: [16, 16, 16] },
  { from: [1, 0, 1], to: [4, 12, 4] },
  { from: [12, 0, 1], to: [15, 12, 4] },
  { from: [1, 0, 12], to: [4, 12, 15] },
  { from: [12, 0, 12], to: [15, 12, 15] },
];

const lanternBoxes = (props: Readonly<Record<string, string>>): readonly LocalBoxSpec[] => {
  const hanging = props.hanging === 'true';
  const baseY = hanging ? 2 : 0;
  return [
    { from: [5, baseY, 5], to: [11, baseY + 7, 11], emissive: true },
    { from: [6, baseY + 7, 6], to: [10, baseY + 9, 10] },
    ...(hanging ? [{ from: [7, baseY + 9, 7] as Vec3, to: [9, 16, 9] as Vec3 }] : []),
  ];
};

const torchBoxes = (name: string, facing: CardinalFacing): readonly LocalBoxSpec[] => {
  if (name.includes('wall_torch')) {
    return [
      rotateBox({ from: [7, 3, 11], to: [9, 11, 16] }, facing),
      rotateBox({ from: [6.5, 10, 10.5], to: [9.5, 13, 13.5], emissive: true }, facing),
    ];
  }
  return [
    { from: [7, 0, 7], to: [9, 9, 9] },
    { from: [6.5, 8.5, 6.5], to: [9.5, 11.5, 9.5], emissive: true },
  ];
};

const campfireBoxes = (): readonly LocalBoxSpec[] => [
  { from: [1, 0, 2], to: [15, 4, 6], tileOverride: 'spruce_planks' },
  { from: [1, 0, 10], to: [15, 4, 14], tileOverride: 'spruce_planks' },
  { from: [2, 3, 1], to: [6, 7, 15], tileOverride: 'oak_planks' },
  { from: [10, 3, 1], to: [14, 7, 15], tileOverride: 'oak_planks' },
  { from: [3, 0, 3], to: [13, 3, 13], emissive: true },
  { from: [5, 3, 5], to: [11, 10, 11], emissive: true },
];

const STATIC_SHAPES: Partial<Record<BlockDescriptor['shape'], readonly LocalBoxSpec[]>> = {
  carpet: [{ from: [0, 0, 0], to: [16, 1, 16] }],
  chain: [{ from: [6.5, 0, 6.5], to: [9.5, 16, 9.5] }],
  pot: [{ from: [5, 0, 5], to: [11, 6, 11] }],
};

const slabBoxes = (props: Readonly<Record<string, string>>): readonly LocalBoxSpec[] => {
  if (props.type === 'double') return [{ from: [0, 0, 0], to: [16, 16, 16] }];
  return props.type === 'top'
    ? [{ from: [0, 8, 0], to: [16, 16, 16] }]
    : [{ from: [0, 0, 0], to: [16, 8, 16] }];
};

const trapdoorBoxes = (
  props: Readonly<Record<string, string>>,
  facing: CardinalFacing,
): readonly LocalBoxSpec[] => {
  const raw: LocalBoxSpec =
    props.open === 'true'
      ? { from: [0, 0, 0], to: [16, 16, 3] }
      : props.half === 'top'
        ? { from: [0, 13, 0], to: [16, 16, 16] }
        : { from: [0, 0, 0], to: [16, 3, 16] };
  return [rotateBox(raw, facing)];
};

type ShapeBuilder = (
  parsed: ParsedBlockState,
  facing: CardinalFacing,
  conns: readonly boolean[],
) => readonly LocalBoxSpec[];

const DYNAMIC_SHAPES: Partial<Record<BlockDescriptor['shape'], ShapeBuilder>> = {
  stair: (p, f) => stairBoxes(p.properties, f),
  slab: (p) => slabBoxes(p.properties),
  fence: (p, _f, c) => fenceBoxes(p.properties, c),
  wall: (p, _f, c) => wallOrPaneBoxes('wall', p.properties, c),
  pane: (p, _f, c) => wallOrPaneBoxes('pane', p.properties, c),
  door: (p, f) => doorBoxes(p.properties, f),
  lantern: (p) => lanternBoxes(p.properties),
  torch: (p, f) => torchBoxes(p.name, f),
  campfire: () => campfireBoxes(),
  bed: (p, f) => bedBoxes(p.properties, f),
  anvil: (_p, f) => anvilBoxes(f),
  table: () => tableBoxes(),
  chest: (_p, f) => [
    { from: [1, 0, 1], to: [15, 14, 15] },
    rotateBox({ from: [7, 7, 0], to: [9, 11, 1] }, f),
  ],
  ladder: (_p, f) => [rotateBox({ from: [0, 0, 14], to: [16, 16, 16] }, f)],
  trapdoor: (p, f) => trapdoorBoxes(p.properties, f),
};

export const shapeBoxSpecs = (
  desc: BlockDescriptor,
  parsed: ParsedBlockState,
  facing: CardinalFacing,
  conns: readonly boolean[],
): readonly LocalBoxSpec[] => {
  const staticHit = STATIC_SHAPES[desc.shape];
  if (staticHit) return staticHit;
  const builder = DYNAMIC_SHAPES[desc.shape];
  return builder ? builder(parsed, facing, conns) : trapdoorBoxes(parsed.properties, facing);
};

export const buildNonFullCubes = (
  idPrefix: string,
  parentId: string,
  ox: number,
  oy: number,
  oz: number,
  cachedState: CachedBlockState,
  desc: BlockDescriptor,
  conns: readonly boolean[],
  uvs: ReadonlyMap<string, TileUvRef>,
): readonly AxisCubeNode[] => {
  const { parsed, facing } = cachedState;
  const specs = shapeBoxSpecs(desc, parsed, facing, conns);
  const faces = makeBoxFaces(desc, facing, uvs);
  return specs.map((spec, idx) => ({
    id: `${idPrefix}_${idx}`,
    kind: 'cube',
    name: `${idPrefix}_${idx}`,
    parentId,
    geometryMode: 'axis-box',
    bounds: {
      from: [ox + spec.from[0], oy + spec.from[1], oz + spec.from[2]],
      to: [ox + spec.to[0], oy + spec.to[1], oz + spec.to[2]],
    },
    transform: {
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      pivot: [0, 0, 0],
    },
    visible: true,
    inflate: 0,
    mirror: false,
    boxUv: false,
    faces,
  }));
};
