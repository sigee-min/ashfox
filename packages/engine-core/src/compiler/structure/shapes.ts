import type { CubeFaceDirection } from '../../model/scene';
import type { CardinalFacing } from '../../project/structure/contract';
import type { ParsedBlockState } from '../../project/structure/state';
import type { BlockDescriptor, BlockRenderLayer } from './blocks';
import type { StructureGrid, StructureLightingField } from './contract';
import { computeFaceShade, FACE_BASIS } from './lighting';
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

const NO_CONNS: readonly boolean[] = [false, false, false, false];

interface GridSliceAxis {
  readonly dir: CubeFaceDirection;
  readonly axis: 0 | 1 | 2;
  readonly step: -1 | 1;
  readonly nbSlice: 0 | 3;
  readonly ud: boolean;
}

const GRID_SLICE_AXES: readonly GridSliceAxis[] = [
  { dir: 'north', axis: 2, step: -1, nbSlice: 3, ud: false },
  { dir: 'south', axis: 2, step: 1, nbSlice: 0, ud: false },
  { dir: 'west', axis: 0, step: -1, nbSlice: 3, ud: false },
  { dir: 'east', axis: 0, step: 1, nbSlice: 0, ud: false },
  { dir: 'down', axis: 1, step: -1, nbSlice: 3, ud: true },
  { dir: 'up', axis: 1, step: 1, nbSlice: 0, ud: true },
];

const SELF_OCC_SCRATCH = new Uint8Array(64);
const NB_OCC_SCRATCH = new Uint8Array(64);
const NB_FACE_SCRATCH = new Uint8Array(16);
const SLICE_MASK_SCRATCH = new Uint8Array(16);

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

/** Writes local [0..1] UVs for non-repeating sub-voxel and trim boxes. */
export const writeSpecBoxUv = (dir: CubeFaceDirection, spec: LocalBoxSpec, uvs: number[]): void => {
  const ew = dir === 'east' || dir === 'west';
  const ud = dir === 'up' || dir === 'down';
  const rawU = ew ? spec.to[2] - spec.from[2] : spec.to[0] - spec.from[0];
  const rawV = ud ? spec.to[2] - spec.from[2] : spec.to[1] - spec.from[1];
  const uSpan = Math.min(1, Math.max(0, rawU / 16));
  const vSpan = Math.min(1, Math.max(0, rawV / 16));
  const fx = ew ? spec.from[2] : spec.from[0];
  const fy = ud ? spec.from[2] : 16 - spec.to[1];
  const pu = fx >= 0 && fx + rawU <= 16 ? fx / 16 : 0;
  const pv = fy >= 0 && fy + rawV <= 16 ? fy / 16 : 0;
  writeQuadUv(uvs, pu, pv, uSpan, vSpan);
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

const occAt = (occ: Uint8Array, axis: 0 | 1 | 2, s: number, u: number, v: number): number => {
  if (axis === 2) return occ[(v * 4 + s) * 4 + u]!;
  if (axis === 0) return occ[(v * 4 + u) * 4 + s]!;
  return occ[(s * 4 + v) * 4 + u]!;
};

const fillVoxelGrid4 = (specs: readonly LocalBoxSpec[], out: Uint8Array): void => {
  out.fill(0);
  for (const spec of specs) {
    const x0 = spec.from[0] >> 2;
    const x1 = spec.to[0] >> 2;
    const y0 = spec.from[1] >> 2;
    const y1 = spec.to[1] >> 2;
    const z0 = spec.from[2] >> 2;
    const z1 = spec.to[2] >> 2;
    for (let y = y0; y < y1; y += 1) {
      for (let z = z0; z < z1; z += 1) {
        for (let x = x0; x < x1; x += 1) out[(y * 4 + z) * 4 + x] = 1;
      }
    }
  }
};

export interface CulledShapeContext {
  readonly grid: StructureGrid;
  readonly descriptors: readonly BlockDescriptor[];
  readonly parsedStates: readonly CachedBlockState[];
  readonly lighting: StructureLightingField;
  readonly maxY: number;
}

export interface CulledShapeScratch {
  readonly from: [number, number, number];
  readonly to: [number, number, number];
  readonly uvs: number[];
  readonly colors: number[];
}

export type EmitCulledQuadFn = (
  layer: BlockRenderLayer,
  tileId: string,
  dir: CubeFaceDirection,
  from: readonly [number, number, number],
  to: readonly [number, number, number],
  uvs: readonly number[],
  colors: readonly number[],
  flip: boolean,
) => void;

const readNeighborFaceMask = (
  ctx: CulledShapeContext,
  nx: number,
  ny: number,
  nz: number,
  cfg: GridSliceAxis,
): void => {
  const [w, _h, d] = ctx.grid.size;
  if (nx < 0 || nx >= w || ny < 0 || ny >= ctx.maxY || nz < 0 || nz >= d) {
    NB_FACE_SCRATCH.fill(0);
    return;
  }
  const idx = (ny * d + nz) * w + nx;
  const nv = ctx.grid.voxels[idx]!;
  if (nv <= 0 || ctx.grid.customTags[idx] !== null) {
    NB_FACE_SCRATCH.fill(0);
    return;
  }
  const ndesc = ctx.descriptors[nv]!;
  if (ndesc.solidOpaque) {
    NB_FACE_SCRATCH.fill(1);
    return;
  }
  if (ndesc.shape !== 'stair' && ndesc.shape !== 'slab') {
    NB_FACE_SCRATCH.fill(0);
    return;
  }
  const ncached = ctx.parsedStates[nv]!;
  fillVoxelGrid4(shapeBoxSpecs(ndesc, ncached.parsed, ncached.facing, NO_CONNS), NB_OCC_SCRATCH);
  for (let v = 0; v < 4; v += 1) {
    for (let u = 0; u < 4; u += 1) {
      NB_FACE_SCRATCH[v * 4 + u] = occAt(NB_OCC_SCRATCH, cfg.axis, cfg.nbSlice, u, v);
    }
  }
};

const cellVisible4 = (
  axis: 0 | 1 | 2,
  step: -1 | 1,
  s: number,
  u: number,
  v: number,
  atEdge: boolean,
): 0 | 1 => {
  if (!occAt(SELF_OCC_SCRATCH, axis, s, u, v)) return 0;
  const blocked = atEdge
    ? NB_FACE_SCRATCH[v * 4 + u]!
    : occAt(SELF_OCC_SCRATCH, axis, s + step, u, v);
  return blocked ? 0 : 1;
};

const fillSliceFaceMask4 = (
  axis: 0 | 1 | 2,
  step: -1 | 1,
  s: number,
  outMask: Uint8Array,
): boolean => {
  const ns = s + step;
  const atEdge = ns < 0 || ns > 3;
  let any = false;
  for (let v = 0; v < 4; v += 1) {
    for (let u = 0; u < 4; u += 1) {
      const vis = cellVisible4(axis, step, s, u, v, atEdge);
      outMask[v * 4 + u] = vis;
      if (vis) any = true;
    }
  }
  return any;
};

const greedySpan4 = (mask: Uint8Array, u0: number, v0: number): readonly [number, number] => {
  let mw = 1;
  while (u0 + mw < 4 && mask[v0 * 4 + u0 + mw] === 1) mw += 1;
  let mh = 1;
  outer: while (v0 + mh < 4) {
    for (let k = 0; k < mw; k += 1) if (mask[(v0 + mh) * 4 + u0 + k] !== 1) break outer;
    mh += 1;
  }
  return [mw, mh];
};

const writeGridBoxBounds = (
  axis: 0 | 1 | 2,
  s: number,
  u: number,
  v: number,
  mw: number,
  mh: number,
  bx: number,
  bz: number,
  y: number,
  from: [number, number, number],
  to: [number, number, number],
): void => {
  if (axis === 2) {
    setVec3(from, bx + u * 0.25, y + v * 0.25, bz + s * 0.25);
    setVec3(to, bx + (u + mw) * 0.25, y + (v + mh) * 0.25, bz + (s + 1) * 0.25);
  } else if (axis === 0) {
    setVec3(from, bx + s * 0.25, y + v * 0.25, bz + u * 0.25);
    setVec3(to, bx + (s + 1) * 0.25, y + (v + mh) * 0.25, bz + (u + mw) * 0.25);
  } else {
    setVec3(from, bx + u * 0.25, y + s * 0.25, bz + v * 0.25);
    setVec3(to, bx + (u + mw) * 0.25, y + (s + 1) * 0.25, bz + (v + mh) * 0.25);
  }
};

const clearMaskSpan4 = (mask: Uint8Array, u: number, v: number, mw: number, mh: number): void => {
  for (let dy = 0; dy < mh; dy += 1)
    for (let dx = 0; dx < mw; dx += 1) mask[(v + dy) * 4 + u + dx] = 0;
};

const emitCulledSliceQuads4 = (
  ctx: CulledShapeContext,
  emitQuad: EmitCulledQuadFn,
  cfg: GridSliceAxis,
  s: number,
  x: number,
  y: number,
  z: number,
  layer: BlockRenderLayer,
  tileId: string,
  colors: readonly number[],
  flip: boolean,
  scratch: CulledShapeScratch,
): number => {
  const [w, _h, d] = ctx.grid.size;
  const bx = x - w / 2;
  const bz = z - d / 2;
  let emitted = 0;
  for (let v = 0; v < 4; v += 1) {
    for (let u = 0; u < 4; u += 1) {
      if (SLICE_MASK_SCRATCH[v * 4 + u] !== 1) continue;
      const [mw, mh] = greedySpan4(SLICE_MASK_SCRATCH, u, v);
      clearMaskSpan4(SLICE_MASK_SCRATCH, u, v, mw, mh);
      writeGridBoxBounds(cfg.axis, s, u, v, mw, mh, bx, bz, y, scratch.from, scratch.to);
      const pv = cfg.ud ? v * 0.25 : 1 - (v + mh) * 0.25;
      writeQuadUv(scratch.uvs, u * 0.25, pv, mw * 0.25, mh * 0.25);
      emitQuad(layer, tileId, cfg.dir, scratch.from, scratch.to, scratch.uvs, colors, flip);
      emitted += 1;
    }
  }
  return emitted;
};

/** Emits 4x4x4-culled faces for stairs and slabs (internal + neighbor + bottom occlusion). */
export const emitCulledGridShape = (
  ctx: CulledShapeContext,
  emitQuad: EmitCulledQuadFn,
  desc: BlockDescriptor,
  cached: CachedBlockState,
  x: number,
  y: number,
  z: number,
  scratch: CulledShapeScratch,
): number => {
  fillVoxelGrid4(shapeBoxSpecs(desc, cached.parsed, cached.facing, NO_CONNS), SELF_OCC_SCRATCH);
  let count = 0;
  for (const cfg of GRID_SLICE_AXES) {
    const normal = FACE_BASIS[cfg.dir].normal;
    readNeighborFaceMask(ctx, x + normal[0], y + normal[1], z + normal[2], cfg);
    const tileId = tileForFace(desc, cfg.dir, cached.facing);
    let shade: ReturnType<typeof computeFaceShade> | null = null;
    for (let s = 0; s < 4; s += 1) {
      if (!fillSliceFaceMask4(cfg.axis, cfg.step, s, SLICE_MASK_SCRATCH)) continue;
      shade ??= computeFaceShade(
        ctx.grid,
        ctx.descriptors,
        ctx.lighting,
        x,
        y,
        z,
        cfg.dir,
        desc.layer === 'emissive',
        ctx.maxY,
        false,
        scratch.colors,
      );
      count += emitCulledSliceQuads4(
        ctx,
        emitQuad,
        cfg,
        s,
        x,
        y,
        z,
        desc.layer,
        tileId,
        shade.colors,
        shade.flip,
        scratch,
      );
    }
  }
  return count;
};
