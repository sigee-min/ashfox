import type { Vec3 } from '../../model/identity';
import type { AxisCubeNode, CubeFace, CubeFaceDirection, CubeFaces } from '../../model/scene';
import type { CardinalFacing } from '../../project/structure/contract';
import { parseBlockState } from '../../project/structure/state';
import type { BlockDescriptor } from './blocks';
import type { TileUvRef } from './atlas';

export interface LocalBoxSpec {
  readonly from: Vec3;
  readonly to: Vec3;
  readonly role?: 'front' | 'top' | 'bottom' | 'side';
  readonly emissive?: boolean;
}

const DIRS: readonly CubeFaceDirection[] = ['north', 'south', 'east', 'west', 'up', 'down'];

const rotatePointXZ = ([x, y, z]: Vec3, facing: CardinalFacing): Vec3 => {
  if (facing === 'east') return [16 - z, y, x];
  if (facing === 'south') return [16 - x, y, 16 - z];
  if (facing === 'west') return [z, y, 16 - x];
  return [x, y, z];
};

const normBounds = (a: Vec3, b: Vec3): { readonly from: Vec3; readonly to: Vec3 } => ({
  from: [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.min(a[2], b[2])],
  to: [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.max(a[2], b[2])],
});

const tileForFace = (
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
  uv: [uvRef.u, uvRef.v, uvRef.u + 16, uvRef.v + 16],
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
  const base: LocalBoxSpec = topHalf
    ? { from: [0, 8, 0], to: [16, 16, 16] }
    : { from: [0, 0, 0], to: [16, 8, 16] };
  const step: LocalBoxSpec = topHalf
    ? { from: [0, 0, 0], to: [16, 8, 8] }
    : { from: [0, 8, 0], to: [16, 16, 8] };
  const rotStep = normBounds(rotatePointXZ(step.from, facing), rotatePointXZ(step.to, facing));
  return [base, rotStep];
};

const fenceOrPaneBoxes = (
  shape: 'fence' | 'wall' | 'pane',
  conns: readonly boolean[],
): readonly LocalBoxSpec[] => {
  const r = shape === 'pane' ? 1 : shape === 'wall' ? 4 : 2;
  const h = 16;
  const boxes: LocalBoxSpec[] = [{ from: [8 - r, 0, 8 - r], to: [8 + r, h, 8 + r] }];
  const armR = shape === 'pane' ? 1 : shape === 'wall' ? 3 : 1.5;
  const armH = shape === 'wall' ? 14 : 16;
  const arms: readonly [boolean, Vec3, Vec3][] = [
    [conns[0]!, [8 - armR, 0, 0], [8 + armR, armH, 8 - r]],
    [conns[1]!, [8 - armR, 0, 8 + r], [8 + armR, armH, 16]],
    [conns[2]!, [8 + r, 0, 8 - armR], [16, armH, 8 + armR]],
    [conns[3]!, [0, 0, 8 - armR], [8 - r, armH, 8 + armR]],
  ];
  for (const [on, from, to] of arms) {
    if (on) boxes.push({ from, to });
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
  return [normBounds(rotatePointXZ(raw.from, facing), rotatePointXZ(raw.to, facing))];
};

const STATIC_SHAPES: Partial<Record<BlockDescriptor['shape'], readonly LocalBoxSpec[]>> = {
  carpet: [{ from: [0, 0, 0], to: [16, 1, 16] }],
  chest: [{ from: [1, 0, 1], to: [15, 14, 15] }],
  bed: [{ from: [0, 0, 0], to: [16, 9, 16] }],
  torch: [{ from: [6, 0, 6], to: [10, 10, 10], emissive: true }],
  chain: [{ from: [6.5, 0, 6.5], to: [9.5, 16, 9.5] }],
  pot: [{ from: [5, 0, 5], to: [11, 6, 11] }],
  campfire: [{ from: [1, 0, 1], to: [15, 7, 15], emissive: true }],
};

const lanternBoxes = (props: Readonly<Record<string, string>>): readonly LocalBoxSpec[] => {
  const hanging = props.hanging === 'true';
  const baseY = hanging ? 2 : 0;
  const chain: readonly LocalBoxSpec[] = hanging
    ? [{ from: [7, baseY + 9, 7], to: [9, 16, 9] }]
    : [];
  return [
    { from: [5, baseY, 5], to: [11, baseY + 7, 11], emissive: true },
    { from: [6, baseY + 7, 6], to: [10, baseY + 9, 10] },
    ...chain,
  ];
};

const slabBoxes = (props: Readonly<Record<string, string>>): readonly LocalBoxSpec[] => {
  if (props.type === 'double') return [{ from: [0, 0, 0], to: [16, 16, 16] }];
  return props.type === 'top'
    ? [{ from: [0, 8, 0], to: [16, 16, 16] }]
    : [{ from: [0, 0, 0], to: [16, 8, 16] }];
};

const simpleShapeBoxes = (
  desc: BlockDescriptor,
  props: Readonly<Record<string, string>>,
  facing: CardinalFacing,
  conns: readonly boolean[],
): readonly LocalBoxSpec[] => {
  const staticHit = STATIC_SHAPES[desc.shape];
  if (staticHit) return staticHit;
  if (desc.shape === 'stair') return stairBoxes(props, facing);
  if (desc.shape === 'slab') return slabBoxes(props);
  if (desc.shape === 'fence' || desc.shape === 'wall' || desc.shape === 'pane')
    return fenceOrPaneBoxes(desc.shape, conns);
  if (desc.shape === 'door') return doorBoxes(props, facing);
  if (desc.shape === 'lantern') return lanternBoxes(props);
  if (desc.shape === 'ladder')
    return [normBounds(rotatePointXZ([0, 0, 14], facing), rotatePointXZ([16, 16, 16], facing))];
  const raw: LocalBoxSpec =
    props.open === 'true'
      ? { from: [0, 0, 0], to: [16, 16, 3] }
      : props.half === 'top'
        ? { from: [0, 13, 0], to: [16, 16, 16] }
        : { from: [0, 0, 0], to: [16, 3, 16] };
  return [normBounds(rotatePointXZ(raw.from, facing), rotatePointXZ(raw.to, facing))];
};

export const buildNonFullCubes = (
  idPrefix: string,
  parentId: string,
  ox: number,
  oy: number,
  oz: number,
  state: string,
  desc: BlockDescriptor,
  conns: readonly boolean[],
  uvs: ReadonlyMap<string, TileUvRef>,
): readonly AxisCubeNode[] => {
  const parsed = parseBlockState(state);
  const fRaw = parsed.properties.facing;
  const facing: CardinalFacing =
    fRaw === 'south' || fRaw === 'east' || fRaw === 'west' ? fRaw : 'north';
  const specs = simpleShapeBoxes(desc, parsed.properties, facing, conns);
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
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], pivot: [0, 0, 0] },
    visible: true,
    inflate: 0,
    mirror: false,
    boxUv: false,
    faces,
  }));
};
