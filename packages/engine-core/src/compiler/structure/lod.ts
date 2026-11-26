import { clamp01, compareText } from '@ashfox/internal-contracts';
import type { CompiledModel } from '../../model/compiled';
import type { CubeFaceDirection } from '../../model/scene';
import type { TextureAsset } from '../../model/texture';
import type { BlockRotation, CardinalFacing } from '../../project/structure/contract';
import { parseBlockState } from '../../project/structure/state';
import { parseSurfaceColor } from '../../textures/color';
import { hexToOklch, oklchToHex } from '../../textures/oklch';
import { buildStructureTileTextures } from './atlas';
import { getBatch, pushQuad, type BatchDraft } from './batch';
import { describeBlockState, type BlockDescriptor, type BlockRenderLayer } from './blocks';
import type {
  StructureBakedBatch,
  StructureBakedMesh,
  StructureGrid,
  StructureLightingField,
  StructureLodLevels,
  StructurePropInstance,
} from './contract';
import { computeFaceShade, FACE_BASIS, samplePropLightRgb } from './lighting';
import { setVec3, tileForFace, writeQuadUv, writeSpecBoxUv, type CachedBlockState } from './shapes';
import { paintTileRects } from './tiles';
import { isInsideEnclosedRoom, isNearEnclosedRoom, linearToSrgb } from './vertexWeather';

const DIRS6: readonly CubeFaceDirection[] = ['north', 'south', 'east', 'west', 'up', 'down'];
const CARDINALS: readonly CardinalFacing[] = ['north', 'south', 'east', 'west'];
const S45 = Math.SQRT1_2;
type P3 = readonly [number, number, number];
interface Ctx {
  grid: StructureGrid;
  descs: readonly BlockDescriptor[];
  states: readonly CachedBlockState[];
  light: StructureLightingField;
  ext: Uint8Array;
  batches: Map<string, BatchDraft>;
  albedo: Map<string, P3>;
  horizon: boolean;
  from: [number, number, number];
  to: [number, number, number];
  uvs: number[];
  cols: number[];
}
interface Cell {
  key: string;
  layer: BlockRenderLayer;
  tile: string;
  flip: boolean;
  cols: readonly number[];
}

const srgbLin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const faceRot = (f: CardinalFacing): BlockRotation =>
  f === 'east' ? 270 : f === 'south' ? 180 : f === 'west' ? 90 : 0;
const faceAxes = (d: CubeFaceDirection): readonly [0 | 1 | 2, 0 | 1 | 2, 0 | 1 | 2] =>
  d === 'up' || d === 'down' ? [1, 0, 2] : d === 'east' || d === 'west' ? [0, 2, 1] : [2, 0, 1];
const shOf = (
  c: Ctx,
  x: number,
  y: number,
  z: number,
  d: CubeFaceDirection,
  em: boolean,
  ao: boolean,
) => computeFaceShade(c.grid, c.descs, c.light, x, y, z, d, em, c.grid.size[1], ao);

const tileAlbedo = (ctx: Ctx, tile: string): P3 => {
  const hit = ctx.albedo.get(tile);
  if (hit) return hit;
  let [l, a, b, w] = [0, 0, 0, 0];
  for (const r of paintTileRects(tile, 1, ctx.grid.seed, 0)) {
    if (r.alpha === 0) continue;
    const [area, ok] = [r.w * r.h, hexToOklch(r.color)];
    const rad = (ok.h * Math.PI) / 180;
    [l, a, b, w] = [
      l + ok.l * area,
      a + ok.c * Math.cos(rad) * area,
      b + ok.c * Math.sin(rad) * area,
      w + area,
    ];
  }
  let res: P3 = [0.5, 0.5, 0.5];
  if (w > 0) {
    const ch = Math.hypot(a / w, b / w);
    const h = ch < 1e-6 ? 0 : ((Math.atan2(b / w, a / w) * 180) / Math.PI + 360) % 360;
    const rgb = parseSurfaceColor(oklchToHex({ l: l / w, c: ch, h }));
    res = [srgbLin(rgb.r / 255), srgbLin(rgb.g / 255), srgbLin(rgb.b / 255)];
  }
  ctx.albedo.set(tile, res);
  return res;
};

const floodIdx = (g: StructureGrid, l: StructureLightingField, m: Uint8Array, p: P3) => {
  const [x, y, z] = p;
  const [w, h, d] = g.size;
  if (x < 0 || x >= w || y < 0 || y >= h || z < 0 || z >= d) return -1;
  const idx = (y * d + z) * w + x;
  return m[idx] === 0 &&
    g.voxels[idx]! <= 0 &&
    l.sky[idx]! >= 64 &&
    !isInsideEnclosedRoom(g, x, y, z)
    ? idx
    : -1;
};

const buildExtMask = (g: StructureGrid, l: StructureLightingField): Uint8Array => {
  const [w, h, d] = g.size;
  const vol = w * h * d;
  const [mask, q] = [new Uint8Array(vol), new Int32Array(vol)];
  let [head, tail] = [0, 0];
  for (let i = 0; i < vol; i += 1) {
    if (g.voxels[i]! > 0) continue;
    const [x, z, y] = [i % w, Math.floor(i / w) % d, Math.floor(i / (w * d))];
    if (
      (x === 0 || x === w - 1 || z === 0 || z === d - 1 || y === h - 1) &&
      !isInsideEnclosedRoom(g, x, y, z)
    )
      [mask[i], q[tail++]] = [1, i];
  }
  while (head < tail) {
    const cur = q[head++]!;
    const [cx, cz, cy] = [cur % w, Math.floor(cur / w) % d, Math.floor(cur / (w * d))];
    for (const dir of DIRS6) {
      const n = FACE_BASIS[dir].normal;
      const nIdx = floodIdx(g, l, mask, [cx + n[0], cy + n[1], cz + n[2]]);
      if (nIdx >= 0) [mask[nIdx], q[tail++]] = [1, nIdx];
    }
  }
  return mask;
};

const isExt = (
  ctx: Ctx,
  own: number,
  desc: BlockDescriptor,
  nx: number,
  ny: number,
  nz: number,
) => {
  const [w, h, d] = ctx.grid.size;
  if (ny < 0) return false;
  if (nx < 0 || nx >= w || ny >= h || nz < 0 || nz >= d) return true;
  const nIdx = (ny * d + nz) * w + nx;
  if (ctx.ext[nIdx] === 1) return true;
  if (isInsideEnclosedRoom(ctx.grid, nx, ny, nz)) return false;
  const nv = ctx.grid.voxels[nIdx]!;
  if (nv <= 0 || ctx.grid.customTags[nIdx] !== null) return false;
  const nD = ctx.descs[nv]!;
  return (
    !nD.solidOpaque &&
    !(desc.top === 'glass' && nv === own) &&
    nD.shape !== 'pane' &&
    nD.shape !== 'door'
  );
};

const fillCols = (ctx: Ctx, tile: string, src: readonly number[]) => {
  if (!ctx.horizon) {
    for (let i = 0; i < 12; i += 1) ctx.cols[i] = src[i]!;
    return;
  }
  const alb = tileAlbedo(ctx, tile);
  for (let i = 0; i < 12; i += 3) {
    ctx.cols[i] = linearToSrgb(clamp01(alb[0] * srgbLin(src[i]!)));
    ctx.cols[i + 1] = linearToSrgb(clamp01(alb[1] * srgbLin(src[i + 1]!)));
    ctx.cols[i + 2] = linearToSrgb(clamp01(alb[2] * srgbLin(src[i + 2]!)));
  }
};

const batchFor = (ctx: Ctx, layer: BlockRenderLayer, tile: string): BatchDraft => {
  if (!ctx.horizon) return getBatch(ctx.batches, layer, tile);
  let b = ctx.batches.get('lod2');
  if (!b) {
    b = {
      layer: 'opaque',
      tileId: '',
      textureId: '',
      positions: [],
      normals: [],
      uvs: [],
      colors: [],
      indices: [],
    };
    ctx.batches.set('lod2', b);
  }
  return b;
};

const pushLodQuad = (
  ctx: Ctx,
  b: BatchDraft,
  dir: CubeFaceDirection,
  cols: readonly number[],
  flip: boolean,
) => {
  const prev = b.uvs.length;
  pushQuad(b, dir, ctx.from, ctx.to, ctx.uvs, cols, flip);
  if (ctx.horizon) b.uvs.length = prev;
};

const makeCell = (ctx: Ctx, dir: CubeFaceDirection, p: P3): Cell | null => {
  const [x, y, z] = p;
  const [w, _h, d] = ctx.grid.size;
  const idx = (y * d + z) * w + x;
  const vox = ctx.grid.voxels[idx]!;
  if (vox <= 0 || ctx.grid.customTags[idx] !== null) return null;
  const desc = ctx.descs[vox]!;
  if (desc.shape !== 'full' || desc.furniture || desc.zone === 'interior') return null;
  const n = FACE_BASIS[dir].normal;
  if (!isExt(ctx, vox, desc, x + n[0], y + n[1], z + n[2])) return null;
  const tile = tileForFace(desc, dir, ctx.states[vox]!.facing);
  const sh = shOf(ctx, x, y, z, dir, desc.layer === 'emissive', true);
  fillCols(ctx, tile, sh.colors);
  const k = ctx.horizon
    ? `${tile}|${sh.quantizedTint}`
    : `${desc.layer}|${tile}|${sh.aoCode}|${sh.quantizedTint}`;
  return {
    key: `${k}|${sh.flip ? 1 : 0}`,
    layer: desc.layer,
    tile,
    flip: sh.flip,
    cols: [...ctx.cols],
  };
};

const greedySpan = (
  mask: readonly (Cell | null)[],
  uLen: number,
  vLen: number,
  u0: number,
  v0: number,
  key: string,
) => {
  let [mw, mh] = [1, 1];
  while (u0 + mw < uLen && mask[v0 * uLen + u0 + mw]?.key === key) mw += 1;
  outer: while (v0 + mh < vLen) {
    for (let k = 0; k < mw; k += 1) if (mask[(v0 + mh) * uLen + u0 + k]?.key !== key) break outer;
    mh += 1;
  }
  return { mw, mh };
};

const emitSlice = (ctx: Ctx, dir: CubeFaceDirection, s: number, mask: (Cell | null)[]) => {
  const [ax, uAx, vAx] = faceAxes(dir);
  const [uLen, vLen] = [ctx.grid.size[uAx], ctx.grid.size[vAx]];
  const pos: [number, number, number] = [0, 0, 0];
  pos[ax] = s;
  let [raw, merged] = [0, 0];
  for (let i = 0; i < mask.length; i += 1) {
    [pos[uAx], pos[vAx]] = [i % uLen, Math.floor(i / uLen)];
    if ((mask[i] = makeCell(ctx, dir, pos))) raw += 1;
  }
  const off: P3 = [-ctx.grid.size[0] / 2, 0, -ctx.grid.size[2] / 2];
  for (let i = 0; i < mask.length; i += 1) {
    const c = mask[i];
    if (!c) continue;
    const [u, v] = [i % uLen, Math.floor(i / uLen)];
    const { mw, mh } = greedySpan(mask, uLen, vLen, u, v, c.key);
    for (let dy = 0; dy < mh; dy += 1)
      mask.fill(null, (v + dy) * uLen + u, (v + dy) * uLen + u + mw);
    [ctx.from[ax], ctx.to[ax]] = [s + off[ax]!, s + 1 + off[ax]!];
    [ctx.from[uAx], ctx.to[uAx]] = [u + off[uAx]!, u + mw + off[uAx]!];
    [ctx.from[vAx], ctx.to[vAx]] = [v + off[vAx]!, v + mh + off[vAx]!];
    writeQuadUv(ctx.uvs, (u & 1) * 0.5, (v & 1) * 0.5, mw * 0.5, mh * 0.5);
    pushLodQuad(ctx, batchFor(ctx, c.layer, c.tile), dir, c.cols, c.flip);
    merged += 1;
  }
  return { raw, merged };
};

const emitQuads = (
  ctx: Ctx,
  pos: P3,
  layer: BlockRenderLayer,
  tile: string,
  dirs: readonly CubeFaceDirection[],
  spec?: { from: P3; to: P3 },
) => {
  const [[x, y, z], [w, h, d]] = [pos, ctx.grid.size];
  const [f, t] = [spec?.from ?? [0, 0, 0], spec?.to ?? [16, 16, 16]];
  setVec3(ctx.from, x + f[0] / 16 - w / 2, y + f[1] / 16, z + f[2] / 16 - d / 2);
  setVec3(ctx.to, x + t[0] / 16 - w / 2, y + t[1] / 16, z + t[2] / 16 - d / 2);
  const own = ctx.descs[ctx.grid.voxels[(y * d + z) * w + x]!]!;
  let count = 0;
  for (const dir of dirs) {
    const n = FACE_BASIS[dir].normal;
    const [nx, ny, nz] = [x + n[0], y + n[1], z + n[2]];
    const nv =
      nx >= 0 && nx < w && ny >= 0 && ny < h && nz >= 0 && nz < d
        ? ctx.grid.voxels[(ny * d + nz) * w + nx]!
        : 0;
    if (spec ? nv > 0 && ctx.descs[nv]!.solidOpaque : !isExt(ctx, 0, own, nx, ny, nz)) continue;
    const sh = shOf(ctx, x, y, z, dir, layer === 'emissive', false);
    fillCols(ctx, tile, sh.colors);
    if (spec) writeSpecBoxUv(dir, spec, ctx.uvs);
    else writeQuadUv(ctx.uvs, 0, 0, 0.5, 0.5);
    pushLodQuad(ctx, batchFor(ctx, layer, tile), dir, ctx.cols, sh.flip);
    count += 1;
  }
  return count;
};

const stairLen = (ctx: Ctx, vis: Uint8Array, pos: P3, v: number, ax: boolean) => {
  const [w, _h, d] = ctx.grid.size;
  let len = 1;
  while ((ax ? pos[0] + len : pos[0]) < w && (ax ? pos[2] : pos[2] + len) < d) {
    const nIdx = (pos[1] * d + (ax ? pos[2] : pos[2] + len)) * w + (ax ? pos[0] + len : pos[0]);
    if (vis[nIdx] !== 0 || ctx.grid.voxels[nIdx] !== v) break;
    vis[nIdx] = 1;
    len += 1;
  }
  return len;
};

const pushWedge = (
  b: BatchDraft,
  cols: number[],
  uv: boolean,
  pts: number[][],
  sN: number[],
  ord: number[],
) => {
  const base = b.positions.length / 3;
  for (const p of pts) b.positions.push(p[0]!, p[1]!, p[2]!);
  for (let i = 0; i < 4; i += 1) {
    b.normals.push(sN[0]!, sN[1]!, sN[2]!);
    b.colors.push(cols[0]!, cols[1]!, cols[2]!);
    if (uv) b.uvs.push(i === 1 || i === 2 ? 0.5 : 0, i >= 2 ? 0.5 : 0);
  }
  for (const o of ord) b.indices.push(base + o);
};

const emitStair = (ctx: Ctx, vis: Uint8Array, idx: number, pos: P3) => {
  if (vis[idx] !== 0) return 0;
  vis[idx] = 1;
  const v = ctx.grid.voxels[idx]!;
  const [desc, st, [w, _h, d]] = [ctx.descs[v]!, ctx.states[v]!, ctx.grid.size];
  const [f, top] = [st.facing, st.parsed.properties.half === 'top'];
  const [ax, back] = [f === 'north' || f === 'south', f === 'south' || f === 'east'];
  const len = stairLen(ctx, vis, pos, v, ax);
  const [xs, zs] = [pos[0] - w / 2, pos[2] - d / 2];
  const [xe, ze] = [xs + (ax ? len : 1), zs + (ax ? 1 : len)];
  const [yT, yB] = top ? [pos[1] + 1, pos[1]] : [pos[1], pos[1] + 1];
  const [lo, hi] = ax ? [zs, ze] : [xs, xe];
  const [bC, tC] = back ? [hi, lo] : [lo, hi];
  const pts = ax
    ? [
        [xs, yT, tC],
        [xe, yT, tC],
        [xe, yB, bC],
        [xs, yB, bC],
      ]
    : [
        [tC, yT, zs],
        [tC, yT, ze],
        [bC, yB, ze],
        [bC, yB, zs],
      ];
  const [ny, nz] = [top ? -S45 : S45, back ? -S45 : S45];
  const sN = ax ? [0, ny, nz] : [nz, ny, 0];
  const ord = (f === 'south' || f === 'west') !== top ? [0, 2, 1, 0, 3, 2] : [0, 1, 2, 0, 2, 3];
  fillCols(ctx, desc.top, shOf(ctx, pos[0], pos[1], pos[2], 'up', false, false).colors);
  pushWedge(batchFor(ctx, desc.layer, desc.top), ctx.cols, !ctx.horizon, pts, sN, ord);
  return 2;
};

const nonFullSpec = (ctx: Ctx, pos: P3, desc: BlockDescriptor, st: CachedBlockState) => {
  if (desc.shape === 'pane') {
    const glow = desc.top !== 'iron_bars' && isNearEnclosedRoom(ctx.grid, pos[0], pos[1], pos[2]);
    return {
      layer: (glow ? 'emissive' : desc.layer) as BlockRenderLayer,
      tile: glow ? 'window_glow' : desc.front,
      dirs: CARDINALS,
    };
  }
  if (desc.shape === 'door')
    return { layer: desc.layer, tile: desc.front, dirs: [st.facing] as const };
  if (desc.shape === 'slab') {
    const y0 = st.parsed.properties.type === 'top' ? 8 : 0;
    return {
      layer: desc.layer,
      tile: desc.top,
      dirs: DIRS6,
      spec: { from: [0, y0, 0] as P3, to: [16, y0 + 8, 16] as P3 },
    };
  }
  if (ctx.horizon || (desc.shape !== 'fence' && desc.shape !== 'wall')) return null;
  const r = desc.shape === 'wall' ? 4 : 2;
  return {
    layer: desc.layer,
    tile: desc.side,
    dirs: DIRS6,
    spec: { from: [8 - r, 0, 8 - r] as P3, to: [8 + r, 16, 8 + r] as P3 },
  };
};

const emitNonFull = (ctx: Ctx, vis: Uint8Array, idx: number): number => {
  const v = ctx.grid.voxels[idx]!;
  if (v <= 0 || ctx.grid.customTags[idx] !== null) return 0;
  const desc = ctx.descs[v]!;
  if (desc.shape === 'full' || desc.furniture || desc.zone === 'interior') return 0;
  const [w, _h, d] = ctx.grid.size;
  const pos: P3 = [idx % w, Math.floor(idx / (w * d)), Math.floor(idx / w) % d];
  if (isInsideEnclosedRoom(ctx.grid, pos[0], pos[1], pos[2])) return 0;
  if (desc.shape === 'stair') return emitStair(ctx, vis, idx, pos);
  const nf = nonFullSpec(ctx, pos, desc, ctx.states[v]!);
  return nf ? emitQuads(ctx, pos, nf.layer, nf.tile, nf.dirs, nf.spec) : 0;
};

const buildInstances = (
  g: StructureGrid,
  l: StructureLightingField,
  m: Readonly<Record<string, CompiledModel>>,
  h: boolean,
) => {
  const out: StructurePropInstance[] = [];
  if (h) return out;
  const [w, _h, d] = g.size;
  for (const cp of g.customPlacements) {
    if (
      !m[cp.assetAlias] ||
      isInsideEnclosedRoom(g, cp.x, cp.y, cp.z) ||
      l.sky[(cp.y * d + cp.z) * w + cp.x]! < 64
    )
      continue;
    const translation: [number, number, number] = [cp.x - w / 2 + 0.5, cp.y, cp.z - d / 2 + 0.5];
    out.push({
      assetKey: cp.assetAlias,
      translation,
      rotation: faceRot(cp.facing),
      lightRgb: samplePropLightRgb(l, cp.x, cp.y, cp.z),
    });
  }
  return out;
};

const buildTier = (
  ctx: Ctx,
  models: Readonly<Record<string, CompiledModel>>,
): StructureBakedMesh => {
  let [raw, merged, other] = [0, 0, 0];
  for (const dir of DIRS6) {
    const [ax, uAx, vAx] = faceAxes(dir);
    const mask = new Array<Cell | null>(ctx.grid.size[uAx] * ctx.grid.size[vAx]).fill(null);
    for (let s = 0; s < ctx.grid.size[ax]; s += 1) {
      const r = emitSlice(ctx, dir, s, mask);
      [raw, merged] = [raw + r.raw, merged + r.merged];
    }
  }
  const vol = ctx.grid.size[0] * ctx.grid.size[1] * ctx.grid.size[2];
  const vis = new Uint8Array(vol);
  for (let i = 0; i < vol; i += 1) other += emitNonFull(ctx, vis, i);
  const active = [...ctx.batches.values()].filter((b) => b.indices.length > 0);
  const batches: StructureBakedBatch[] = active
    .map(({ tileId: _t, ...rest }) => rest)
    .sort((a, b) => compareText(a.layer, b.layer) || compareText(a.textureId, b.textureId));
  const texList = active.map((b) => ({ layer: b.layer, tileId: b.tileId }));
  const textures: Readonly<Record<string, TextureAsset>> = ctx.horizon
    ? {}
    : buildStructureTileTextures(texList, ctx.grid.density, ctx.grid.seed);
  return {
    batches,
    textures,
    instances: buildInstances(ctx.grid, ctx.light, models, ctx.horizon),
    rawFaceCount: raw + other,
    mergedQuadCount: merged + other,
    trimCount: 0,
  };
};

export const buildStructureLodLevels = (
  grid: StructureGrid,
  lighting: StructureLightingField,
  customModels: Readonly<Record<string, CompiledModel>>,
  options?: { readonly descriptors?: readonly BlockDescriptor[] },
): StructureLodLevels => {
  const descs = options?.descriptors ?? grid.states.map(describeBlockState);
  const states: CachedBlockState[] = grid.states.map((s) => {
    const parsed = parseBlockState(s);
    const f = parsed.properties.facing;
    return { parsed, facing: f === 'south' || f === 'east' || f === 'west' ? f : 'north' };
  });
  const ext = buildExtMask(grid, lighting);
  const mk = (horizon: boolean): Ctx => ({
    grid,
    descs,
    states,
    light: lighting,
    ext,
    batches: new Map(),
    albedo: new Map(),
    horizon,
    from: [0, 0, 0],
    to: [0, 0, 0],
    uvs: new Array<number>(8),
    cols: new Array<number>(12),
  });
  return { lod1: buildTier(mk(false), customModels), lod2: buildTier(mk(true), customModels) };
};
