import type { AxisCubeNode, CubeFace, CubeFaceDirection, CubeFaces } from '../../model/scene';
import type { CardinalFacing } from '../../project/structure/contract';
import type { ParsedBlockState } from '../../project/structure/state';
import type { TileUvRef } from './atlas';
import type { BlockDescriptor } from './blocks';
import {
  bedBoxes,
  campfireBoxes,
  doorBoxes,
  glassPaneBoxes,
  lanternBoxes,
  rotateBox,
  stairBoxes,
  tableBoxes,
  torchBoxes,
  type LocalBoxSpec,
} from './subvoxel';

export type { LocalBoxSpec };

export interface CachedBlockState {
  readonly parsed: ParsedBlockState;
  readonly facing: CardinalFacing;
}

const DIRS: readonly CubeFaceDirection[] = ['north', 'south', 'east', 'west', 'up', 'down'];

export const tileForFace = (
  desc: BlockDescriptor,
  dir: CubeFaceDirection,
  facing: CardinalFacing,
): string => {
  if (dir === 'up') return desc.top;
  if (dir === 'down') return desc.bottom;
  return dir === facing ? desc.front : desc.side;
};

export const tileForBoxFace = (
  desc: BlockDescriptor,
  spec: LocalBoxSpec,
  dir: CubeFaceDirection,
  facing: CardinalFacing,
): string => {
  if (spec.tileOverride) return spec.tileOverride;
  if (spec.role === 'top') return desc.top;
  if (spec.role === 'bottom') return desc.bottom;
  if (spec.role === 'side') return desc.side;
  if (spec.role === 'front') return desc.front;
  return tileForFace(desc, dir, facing);
};

export const setVec3 = (out: [number, number, number], x: number, y: number, z: number): void => {
  out[0] = x;
  out[1] = y;
  out[2] = z;
};

export const writeQuadUv = (
  uvs: number[],
  pu: number,
  pv: number,
  uSpan: number,
  vSpan: number,
): void => {
  uvs[0] = pu;
  uvs[1] = pv + vSpan;
  uvs[2] = pu + uSpan;
  uvs[3] = pv + vSpan;
  uvs[4] = pu + uSpan;
  uvs[5] = pv;
  uvs[6] = pu;
  uvs[7] = pv;
};

export const writeSpecBoxUv = (
  dir: CubeFaceDirection,
  spec: LocalBoxSpec,
  x: number,
  y: number,
  z: number,
  uvs: number[],
): void => {
  const ew = dir === 'east' || dir === 'west';
  const ud = dir === 'up' || dir === 'down';
  const uSpan = ((ew ? spec.to[2] - spec.from[2] : spec.to[0] - spec.from[0]) / 16) * 0.5;
  const vSpan = ((ud ? spec.to[2] - spec.from[2] : spec.to[1] - spec.from[1]) / 16) * 0.5;
  writeQuadUv(uvs, ((ew ? z : x) & 1) * 0.5, ((ud ? z : y) & 1) * 0.5, uSpan, vSpan);
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

const anvilBoxes = (facing: CardinalFacing): readonly LocalBoxSpec[] => [
  rotateBox({ from: [2, 0, 2], to: [14, 4, 14] }, facing),
  rotateBox({ from: [4, 4, 3], to: [12, 5, 13] }, facing),
  rotateBox({ from: [6, 5, 4], to: [10, 10, 12] }, facing),
  rotateBox({ from: [3, 10, 0], to: [13, 16, 16] }, facing),
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
  desc: BlockDescriptor,
  parsed: ParsedBlockState,
  facing: CardinalFacing,
  conns: readonly boolean[],
  interiorGlow: boolean,
) => readonly LocalBoxSpec[];

const DYNAMIC_SHAPES: Partial<Record<BlockDescriptor['shape'], ShapeBuilder>> = {
  stair: (_d, p, f) => stairBoxes(p.properties, f),
  slab: (_d, p) => slabBoxes(p.properties),
  fence: (_d, p, _f, c) => fenceBoxes(p.properties, c),
  wall: (_d, p, _f, c) => wallOrPaneBoxes('wall', p.properties, c),
  pane: (d, p, _f, c, glow) =>
    d.top === 'iron_bars' ? wallOrPaneBoxes('pane', p.properties, c) : glassPaneBoxes(p, c, glow),
  door: (d, p, f) => doorBoxes(d, p.properties, f),
  lantern: (_d, p) => lanternBoxes(p.properties),
  torch: (_d, p, f) => torchBoxes(p.name, f),
  campfire: () => campfireBoxes(),
  bed: (_d, p, f) => bedBoxes(p.properties, f),
  anvil: (_d, _p, f) => anvilBoxes(f),
  table: () => tableBoxes(),
  chest: (_d, _p, f) => [
    { from: [1, 0, 1], to: [15, 14, 15] },
    rotateBox({ from: [7, 7, 0], to: [9, 11, 1] }, f),
  ],
  ladder: (_d, _p, f) => [rotateBox({ from: [0, 0, 14], to: [16, 16, 16] }, f)],
  trapdoor: (_d, p, f) => trapdoorBoxes(p.properties, f),
};

export const shapeBoxSpecs = (
  desc: BlockDescriptor,
  parsed: ParsedBlockState,
  facing: CardinalFacing,
  conns: readonly boolean[],
  interiorGlow = false,
): readonly LocalBoxSpec[] => {
  const staticHit = STATIC_SHAPES[desc.shape];
  if (staticHit) return staticHit;
  const builder = DYNAMIC_SHAPES[desc.shape];
  return builder
    ? builder(desc, parsed, facing, conns, interiorGlow)
    : trapdoorBoxes(parsed.properties, facing);
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
