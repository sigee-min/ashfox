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

export const tileForFace = (d: BlockDescriptor, dir: CubeFaceDirection, facing: CardinalFacing) =>
  dir === 'up' ? d.top : dir === 'down' ? d.bottom : dir === facing ? d.front : d.side;

export const tileForBoxFace = (
  d: BlockDescriptor,
  s: LocalBoxSpec,
  dir: CubeFaceDirection,
  facing: CardinalFacing,
): string => s.tileOverride ?? (s.role ? d[s.role] : tileForFace(d, dir, facing));

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
  const fx = ew ? spec.from[2] : spec.from[0];
  const fy = ud ? spec.from[2] : 16 - spec.to[1];
  writeQuadUv(
    uvs,
    fx >= 0 && fx + rawU <= 16 ? fx / 16 : 0,
    fy >= 0 && fy + rawV <= 16 ? fy / 16 : 0,
    Math.min(1, Math.max(0, rawU / 16)),
    Math.min(1, Math.max(0, rawV / 16)),
  );
};

const fenceBoxes = (
  props: Readonly<Record<string, string>>,
  conns: readonly boolean[],
): readonly LocalBoxSpec[] => {
  const boxes: LocalBoxSpec[] = [{ from: [6, 0, 6], to: [10, 16, 10] }];
  const segs: readonly [string, number, number, number, number, number, number][] = [
    ['north', 0, 7, 0, 9, 6, 2],
    ['south', 1, 7, 10, 9, 16, 1],
    ['east', 2, 10, 7, 16, 9, 8],
    ['west', 3, 0, 7, 6, 9, 4],
  ];
  for (const [k, i, x0, z0, x1, z1, skipMask] of segs) {
    if (props[k] !== 'true' && !conns[i]) continue;
    boxes.push(
      { from: [x0, 6, z0], to: [x1, 9, z1], skipMask },
      { from: [x0, 12, z0], to: [x1, 15, z1], skipMask },
    );
  }
  return boxes;
};

const wallOrPaneBoxes = (
  shape: 'wall' | 'pane',
  props: Readonly<Record<string, string>>,
  conns: readonly boolean[],
): readonly LocalBoxSpec[] => {
  const [r, armR, armH] = shape === 'pane' ? [1, 1, 16] : [4, 3, 14];
  const boxes: LocalBoxSpec[] = [{ from: [8 - r, 0, 8 - r], to: [8 + r, 16, 8 + r] }];
  const specs: readonly [string, number, number, number, number, number][] = [
    ['north', 8 - armR, 0, 8 + armR, 8 - r, 2],
    ['south', 8 - armR, 8 + r, 8 + armR, 16, 1],
    ['east', 8 + r, 8 - armR, 16, 8 + armR, 8],
    ['west', 0, 8 - armR, 8 - r, 8 + armR, 4],
  ];
  for (let i = 0; i < 4; i += 1) {
    const [d, x0, z0, x1, z1, skipMask] = specs[i]!;
    const pVal = props[d];
    if (pVal !== undefined ? pVal === 'none' || pVal === 'false' : !conns[i]) continue;
    boxes.push({ from: [x0, 0, z0], to: [x1, armH, z1], skipMask });
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
const slabBoxes = (p: Readonly<Record<string, string>>): readonly LocalBoxSpec[] => [
  { from: [0, p.type === 'top' ? 8 : 0, 0], to: [16, p.type === 'bottom' ? 8 : 16, 16] },
];
const trapdoorBoxes = (
  p: Readonly<Record<string, string>>,
  f: CardinalFacing,
): readonly LocalBoxSpec[] => [
  rotateBox(
    p.open === 'true'
      ? { from: [0, 0, 0], to: [16, 16, 3] }
      : { from: [0, p.half === 'top' ? 13 : 0, 0], to: [16, p.half === 'top' ? 16 : 3, 16] },
    f,
  ),
];
type ShapeBuilder = (
  d: BlockDescriptor,
  p: ParsedBlockState,
  f: CardinalFacing,
  c: readonly boolean[],
  g: boolean,
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
): readonly LocalBoxSpec[] =>
  STATIC_SHAPES[desc.shape] ??
  DYNAMIC_SHAPES[desc.shape]?.(desc, parsed, facing, conns, interiorGlow) ??
  trapdoorBoxes(parsed.properties, facing);

const occAt = (occ: Uint8Array, axis: 0 | 1 | 2, s: number, u: number, v: number): number =>
  axis === 2
    ? occ[(v * 4 + s) * 4 + u]!
    : axis === 0
      ? occ[(v * 4 + u) * 4 + s]!
      : occ[(s * 4 + v) * 4 + u]!;

const fillVoxelGrid4 = (specs: readonly LocalBoxSpec[], out: Uint8Array): void => {
  out.fill(0);
  for (const s of specs) {
    for (let y = s.from[1] >> 2; y < s.to[1] >> 2; y += 1)
      for (let z = s.from[2] >> 2; z < s.to[2] >> 2; z += 1)
        for (let x = s.from[0] >> 2; x < s.to[0] >> 2; x += 1) out[(y * 4 + z) * 4 + x] = 1;
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
export interface GridRunSpan {
  readonly axis: 0 | 2;
  readonly len: number;
  readonly uCoord: number;
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
  stretched?: boolean,
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
  const ndesc = nv > 0 && ctx.grid.customTags[idx] === null ? ctx.descriptors[nv]! : null;
  if (!ndesc) {
    NB_FACE_SCRATCH.fill(0);
    return;
  }
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
  for (let v = 0; v < 4; v += 1)
    for (let u = 0; u < 4; u += 1)
      NB_FACE_SCRATCH[v * 4 + u] = occAt(NB_OCC_SCRATCH, cfg.axis, cfg.nbSlice, u, v);
};

const fillSliceFaceMask4 = (axis: 0 | 1 | 2, step: -1 | 1, s: number, out: Uint8Array): boolean => {
  const ns = s + step;
  const atEdge = ns < 0 || ns > 3;
  let any = false;
  for (let v = 0; v < 4; v += 1) {
    for (let u = 0; u < 4; u += 1) {
      const blocked = atEdge
        ? NB_FACE_SCRATCH[v * 4 + u]!
        : occAt(SELF_OCC_SCRATCH, axis, ns, u, v);
      const vis = occAt(SELF_OCC_SCRATCH, axis, s, u, v) && !blocked ? 1 : 0;
      out[v * 4 + u] = vis;
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

const writeGridBounds = (
  j: AxisEmitJob,
  s: number,
  u: number,
  v: number,
  mw: number,
  mh: number,
): void => {
  const [w, _h, d] = j.ctx.grid.size;
  const [bx, y, bz] = [j.origin[0] - w / 2, j.origin[1], j.origin[2] - d / 2];
  const { from, to } = j.scratch;
  if (j.cfg.axis === 2) {
    setVec3(from, bx + u * 0.25, y + v * 0.25, bz + s * 0.25);
    setVec3(to, bx + (u + mw) * 0.25, y + (v + mh) * 0.25, bz + (s + 1) * 0.25);
  } else if (j.cfg.axis === 0) {
    setVec3(from, bx + s * 0.25, y + v * 0.25, bz + u * 0.25);
    setVec3(to, bx + (s + 1) * 0.25, y + (v + mh) * 0.25, bz + (u + mw) * 0.25);
  } else {
    setVec3(from, bx + u * 0.25, y + s * 0.25, bz + v * 0.25);
    setVec3(to, bx + (u + mw) * 0.25, y + (s + 1) * 0.25, bz + (v + mh) * 0.25);
  }
};

const clearSpan4 = (u: number, v: number, mw: number, mh: number): void => {
  for (let dy = 0; dy < mh; dy += 1)
    for (let dx = 0; dx < mw; dx += 1) SLICE_MASK_SCRATCH[(v + dy) * 4 + u + dx] = 0;
};

const writeGridCellUv = (
  cfg: GridSliceAxis,
  u: number,
  v: number,
  mw: number,
  mh: number,
  run: GridRunSpan | undefined,
  uvs: number[],
): void => {
  const rawPv = cfg.ud ? v * 0.25 : 1 - (v + mh) * 0.25;
  if (!run || run.len <= 1 || cfg.axis === run.axis) {
    writeQuadUv(uvs, u * 0.25, rawPv, mw * 0.25, mh * 0.25);
    return;
  }
  const vs = run.axis === 2 && cfg.axis === 1;
  const [pu, pv] = [
    vs ? u * 0.125 : (run.uCoord & 1) * 0.5,
    vs ? (run.uCoord & 1) * 0.5 : rawPv * 0.5,
  ];
  writeQuadUv(uvs, pu, pv, vs ? mw * 0.125 : run.len * 0.5, vs ? run.len * 0.5 : mh * 0.125);
};

interface AxisEmitJob {
  readonly ctx: CulledShapeContext;
  readonly emitQuad: EmitCulledQuadFn;
  readonly cfg: GridSliceAxis;
  readonly origin: readonly [number, number, number];
  readonly layer: BlockRenderLayer;
  readonly tileId: string;
  readonly scratch: CulledShapeScratch;
  readonly run?: GridRunSpan;
}

const emitCulledSliceQuads4 = (
  j: AxisEmitJob,
  s: number,
  shade: ReturnType<typeof computeFaceShade>,
): number => {
  const stretched = Boolean(j.run && j.run.len > 1 && j.cfg.axis !== j.run.axis);
  const sc = j.scratch;
  let emitted = 0;
  for (let v = 0; v < 4; v += 1) {
    for (let u = 0; u < 4; u += 1) {
      if (SLICE_MASK_SCRATCH[v * 4 + u] !== 1) continue;
      const [mw, mh] = greedySpan4(SLICE_MASK_SCRATCH, u, v);
      clearSpan4(u, v, mw, mh);
      writeGridBounds(j, s, u, v, mw, mh);
      if (stretched) sc.to[j.run!.axis] += j.run!.len - 1;
      writeGridCellUv(j.cfg, u, v, mw, mh, j.run, sc.uvs);
      j.emitQuad(
        j.layer,
        j.tileId,
        j.cfg.dir,
        sc.from,
        sc.to,
        sc.uvs,
        shade.colors,
        shade.flip,
        stretched,
      );
      emitted += 1;
    }
  }
  return emitted;
};

const sliceWindow = (cfg: GridSliceAxis, run?: GridRunSpan) => {
  const len = run?.len ?? 1;
  if (!run || len <= 1) return { rAx: -1, shift: 0, s0: 0, s1: 4, mid: 0 };
  const cap = cfg.axis === run.axis;
  const shift = cap && cfg.step === 1 ? len - 1 : 0;
  const s0 = !cap ? 0 : cfg.step === -1 ? 0 : 3;
  return { rAx: run.axis, shift, s0, s1: cap ? s0 + 1 : 4, mid: cap ? shift : Math.floor(len / 2) };
};

const emitGridAxisSlices = (
  ctx: CulledShapeContext,
  emitQuad: EmitCulledQuadFn,
  desc: BlockDescriptor,
  cached: CachedBlockState,
  cfg: GridSliceAxis,
  pos: readonly [number, number, number],
  scratch: CulledShapeScratch,
  run?: GridRunSpan,
): number => {
  const { rAx, shift, s0, s1, mid } = sliceWindow(cfg, run);
  const [ox, oz] = [pos[0] + (rAx === 0 ? shift : 0), pos[2] + (rAx === 2 ? shift : 0)];
  const n = FACE_BASIS[cfg.dir].normal;
  readNeighborFaceMask(ctx, ox + n[0], pos[1] + n[1], oz + n[2], cfg);
  const job: AxisEmitJob = {
    ctx,
    emitQuad,
    cfg,
    origin: [ox, pos[1], oz],
    layer: desc.layer,
    tileId: tileForFace(desc, cfg.dir, cached.facing),
    scratch,
    run,
  };
  const [sx, sz] = [pos[0] + (rAx === 0 ? mid : 0), pos[2] + (rAx === 2 ? mid : 0)];
  const { grid, descriptors, lighting, maxY } = ctx;
  const emissive = desc.layer === 'emissive';
  let shade: ReturnType<typeof computeFaceShade> | null = null;
  let count = 0;
  for (let s = s0; s < s1; s += 1) {
    if (!fillSliceFaceMask4(cfg.axis, cfg.step, s, SLICE_MASK_SCRATCH)) continue;
    shade ??= computeFaceShade(
      grid,
      descriptors,
      lighting,
      sx,
      pos[1],
      sz,
      cfg.dir,
      emissive,
      maxY,
      false,
      scratch.colors,
    );
    count += emitCulledSliceQuads4(job, s, shade);
  }
  return count;
};

/** Emits 4x4x4-culled faces for stairs and slabs (internal + neighbor + run merge). */
export const emitCulledGridShape = (
  ctx: CulledShapeContext,
  emitQuad: EmitCulledQuadFn,
  desc: BlockDescriptor,
  cached: CachedBlockState,
  x: number,
  y: number,
  z: number,
  scratch: CulledShapeScratch,
  run?: GridRunSpan,
): number => {
  fillVoxelGrid4(shapeBoxSpecs(desc, cached.parsed, cached.facing, NO_CONNS), SELF_OCC_SCRATCH);
  let count = 0;
  for (const cfg of GRID_SLICE_AXES) {
    count += emitGridAxisSlices(ctx, emitQuad, desc, cached, cfg, [x, y, z], scratch, run);
  }
  return count;
};
