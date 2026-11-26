import type { CubeFaceDirection } from '../../model/scene';
import type { CardinalFacing } from '../../project/structure/contract';
import { getBatch, pushQuad, type MeshCtx, type NonFullScratch } from './batch';
import type { StructureOpeningMeta, StructureRoomMeta } from './contract';
import {
  buildBottomStairMask,
  buildMaskByPredicate,
  emitRuns,
  layerHasMaskMatch,
} from './greedyMask';
import { computeFaceShade, SHARED_FACE_SHADE } from './lighting';
import { setVec3, writeSpecBoxUv, type LocalBoxSpec } from './shapes';
import * as sv from './subvoxel';

const DIRS6: readonly CubeFaceDirection[] = ['north', 'south', 'east', 'west', 'up', 'down'];
const DIR_BIT = { north: 1, south: 2, east: 4, west: 8, up: 16, down: 32 } as const;
const STRIP_SCRATCH: {
  from: [number, number, number];
  to: [number, number, number];
  tileOverride?: string;
} = { from: [0, 0, 0], to: [0, 0, 0], tileOverride: 'timber_trim' };

type V3 = readonly [number, number, number];
type StripSpec = readonly [number, number, number, number, number, string, number?];
interface TrimCtx {
  readonly ctx: MeshCtx;
  readonly scratch: NonFullScratch;
}

const solid = (t: TrimCtx, x: number, y: number, z: number): boolean =>
  sv.isSolidOpaqueAt(t.ctx.grid, t.ctx.descriptors, x, y, z);

const air = (t: TrimCtx, x: number, y: number, z: number): boolean =>
  sv.isTrueAirAt(t.ctx.grid, t.ctx.descriptors, x, y, z);

const vox = (t: TrimCtx, x: number, y: number, z: number): number =>
  sv.voxelAt(t.ctx.grid, x, y, z);

const emitBox = (t: TrimCtx, pos: V3, smp: V3, spec: LocalBoxSpec, skipMask = 0): number => {
  const { ctx, scratch } = t;
  const [vx, vy, vz] = pos;
  if (vy < 0 || vy >= ctx.maxY) return 0;
  const [w, _h, d] = ctx.grid.size;
  setVec3(
    scratch.from,
    vx + spec.from[0] / 16 - w / 2,
    vy + spec.from[1] / 16,
    vz + spec.from[2] / 16 - d / 2,
  );
  setVec3(
    scratch.to,
    vx + spec.to[0] / 16 - w / 2,
    vy + spec.to[1] / 16,
    vz + spec.to[2] / 16 - d / 2,
  );
  const layer = spec.layer ?? 'opaque';
  const batch = getBatch(ctx.batches, layer, spec.tileOverride ?? 'timber_trim');
  const { grid, descriptors, lighting, maxY } = ctx;
  let count = 0;
  for (let i = 0; i < 6; i += 1) {
    if ((skipMask & (1 << i)) !== 0) continue;
    const dir = DIRS6[i]!;
    const shade = computeFaceShade(
      grid,
      descriptors,
      lighting,
      smp[0],
      smp[1],
      smp[2],
      dir,
      layer === 'emissive',
      maxY,
      false,
      scratch.colors,
      SHARED_FACE_SHADE,
    );
    writeSpecBoxUv(dir, spec, scratch.uvs);
    pushQuad(batch, dir, scratch.from, scratch.to, scratch.uvs, shade.colors, shade.flip);
    count += 1;
  }
  return count;
};

const emitSpecs = (t: TrimCtx, p: V3, specs: readonly LocalBoxSpec[], skip = 0, smp: V3 = p) =>
  p[1] < 0 || p[1] >= t.ctx.maxY ? 0 : specs.reduce((n, s) => n + emitBox(t, p, smp, s, skip), 0);

const emitStrip = (t: TrimCtx, pos: V3, dir: CardinalFacing, s: StripSpec, smp?: V3): number => {
  const [ox, oz] = sv.OUTWARD[dir];
  sv.writeStripSpec(STRIP_SCRATCH, dir, s[0], s[1], s[2], s[3], s[4], s[5]);
  const sPos = smp ?? ([pos[0] + ox, pos[1], pos[2] + oz] as const);
  return emitBox(t, pos, sPos, STRIP_SCRATCH, DIR_BIT[sv.OPPOSITE[dir]] | (s[6] ?? 0));
};

const emitPilasterCol = (
  t: TrimCtx,
  room: StructureRoomMeta,
  cx: number,
  cz: number,
  ox: -1 | 1,
  oz: -1 | 1,
  seen: Set<string>,
): number => {
  const yEnd = Math.min(room.to[1], t.ctx.maxY - 1);
  const specs = sv.pilasterSpecs(ox, oz);
  const skips = [
    DIR_BIT[ox < 0 ? 'east' : 'west'],
    DIR_BIT[oz < 0 ? 'south' : 'north'] | DIR_BIT[ox < 0 ? 'west' : 'east'],
  ];
  const ok = (y: number) =>
    !seen.has(`${cx},${y},${cz}`) &&
    solid(t, cx, y, cz) &&
    air(t, cx + ox, y, cz) &&
    air(t, cx, y, cz + oz);
  return emitRuns(room.from[1], yEnd + 1, ok, (y0, y1) => {
    for (let k = y0; k <= y1; k += 1) seen.add(`${cx},${k},${cz}`);
    const h16 = (y1 - y0 + 1) * 16;
    const cap =
      (y0 === 0 || solid(t, cx, y0 - 1, cz) ? DIR_BIT.down : 0) |
      (y1 + 1 >= t.ctx.maxY || solid(t, cx, y1 + 1, cz) ? DIR_BIT.up : 0);
    const smp: V3 = [cx + ox, Math.floor((y0 + y1) / 2), cz + oz];
    return specs.reduce(
      (n, s, i) =>
        n + emitBox(t, [cx, y0, cz], smp, { ...s, to: [s.to[0], h16, s.to[2]] }, skips[i]! | cap),
      0,
    );
  });
};

const emitCornerPilasters = (t: TrimCtx): number => {
  let count = 0;
  const seen = new Set<string>();
  for (const r of t.ctx.grid.rooms) {
    if (!r.enclosed || !sv.isTimberRoom(t.ctx.grid, t.ctx.descriptors, r)) continue;
    const xs: readonly [number, -1 | 1][] = [
      [r.from[0], -1],
      [r.to[0], 1],
    ];
    const zs: readonly [number, -1 | 1][] = [
      [r.from[2], -1],
      [r.to[2], 1],
    ];
    for (const [cx, ox] of xs)
      for (const [cz, oz] of zs) count += emitPilasterCol(t, r, cx, cz, ox, oz, seen);
  }
  return count;
};

const scanDirRows = (
  w: number,
  d: number,
  fn: (dir: CardinalFacing, ax: boolean, v: number, uMax: number) => number,
) => {
  let count = 0;
  for (const dir of sv.CARDINALS) {
    const ax = dir === 'north' || dir === 'south';
    for (let v = 0; v < (ax ? d : w); v += 1) count += fn(dir, ax, v, ax ? w : d);
  }
  return count;
};

const emitBeltRun = (
  t: TrimCtx,
  dir: CardinalFacing,
  ax: boolean,
  y: number,
  fixed: number,
  uMax: number,
) => {
  const [ox, oz] = sv.OUTWARD[dir];
  const at = (u: number): V3 => [ax ? u : fixed, y, ax ? fixed : u];
  return emitRuns(
    0,
    uMax,
    (u) => solid(t, at(u)[0], y, at(u)[2]) && air(t, at(u)[0] + ox, y, at(u)[2] + oz),
    (u0, u1) => {
      const m = at(Math.floor((u0 + u1) / 2));
      return emitStrip(
        t,
        at(u0),
        dir,
        [2.5, 0, (u1 - u0 + 1) * 16, 0, 3.5, 'timber_trim'],
        [m[0] + ox, y, m[2] + oz],
      );
    },
  );
};

const emitFloorBeltCourses = (t: TrimCtx): number => {
  const [w, _h, d] = t.ctx.grid.size;
  let count = 0;
  for (const y of sv.collectBeltCourseLevels(t.ctx.grid))
    if (y > 0 && y < t.ctx.maxY)
      count += scanDirRows(w, d, (dir, ax, v, uMax) => emitBeltRun(t, dir, ax, y, v, uMax));
  return count;
};

const emitCorbelCell = (t: TrimCtx, x: number, y: number, z: number): number => {
  const vy = y - 1;
  if ((x + z) % 3 !== 0 || !solid(t, x, y, z) || vox(t, x, vy, z) > 0) return 0;
  const dir = sv.CARDINALS.find((c) => solid(t, x - sv.OUTWARD[c][0], vy, z - sv.OUTWARD[c][1]));
  return dir
    ? emitSpecs(t, [x, vy, z], sv.corbelStepSpecs(dir), DIR_BIT[sv.OPPOSITE[dir]] | DIR_BIT.up)
    : 0;
};

const emitJettyCorbels = (t: TrimCtx): number => {
  const [w, _h, d] = t.ctx.grid.size;
  const ySet = new Set<number>();
  for (const f of t.ctx.grid.floors) if (f.y > 0) ySet.add(f.y);
  for (const r of t.ctx.grid.rooms) if (r.from[1] > 0) ySet.add(r.from[1]);
  let count = 0;
  for (const y of ySet) {
    if (y - 1 < 0 || y - 1 >= t.ctx.maxY) continue;
    for (let z = 0; z < d; z += 1)
      for (let x = 0; x < w; x += 1) count += emitCorbelCell(t, x, y, z);
  }
  return count;
};

const emitOpeningJambs = (t: TrimCtx, op: StructureOpeningMeta, tileId: string): number => {
  const { tx, tz } = sv.openingSpan(op);
  const yMax = Math.min(op.to[1], t.ctx.maxY - 1);
  const jamb = (x: number, z: number, u0: number, u1: number) =>
    emitRuns(
      op.from[1],
      yMax + 1,
      (y) => solid(t, x, y, z),
      (y0, y1) => {
        const cap =
          (y0 === 0 || solid(t, x, y0 - 1, z) ? DIR_BIT.down : 0) |
          (y1 + 1 >= t.ctx.maxY || solid(t, x, y1 + 1, z) ? DIR_BIT.up : 0);
        return emitStrip(t, [x, y0, z], op.wall, [2, u0, u1, 0, (y1 - y0 + 1) * 16, tileId, cap]);
      },
    );
  return jamb(op.from[0] - tx, op.from[2] - tz, 12, 16) + jamb(op.to[0] + tx, op.to[2] + tz, 0, 4);
};

const emitOpeningHeader = (
  t: TrimCtx,
  op: StructureOpeningMeta,
  tileId: string,
  cornice: boolean,
): number => {
  const hy = op.to[1] + 1;
  if (hy >= t.ctx.maxY) return 0;
  const { tx, tz, len } = sv.openingSpan(op);
  const ok = (u: number) => solid(t, op.from[0] + u * tx, hy, op.from[2] + u * tz);
  return emitRuns(-1, len + 1, ok, (u0, u1) => {
    const pos: V3 = [op.from[0] + u0 * tx, hy, op.from[2] + u0 * tz];
    const [rx0, rx1] = [u0 === -1 ? 12 : 0, (u1 - u0) * 16 + (u1 === len ? 4 : 16)];
    const b = emitStrip(t, pos, op.wall, [
      2.5,
      rx0,
      rx1,
      0,
      cornice ? 5 : 4,
      tileId,
      cornice ? DIR_BIT.up : 0,
    ]);
    return (
      b + (cornice ? emitStrip(t, pos, op.wall, [3.5, rx0, rx1, 5, 7, tileId, DIR_BIT.down]) : 0)
    );
  });
};

const emitWindowMullions = (
  t: TrimCtx,
  op: StructureOpeningMeta,
  ax: boolean,
  tx: number,
  tz: number,
  len: number,
): number => {
  const [vS, hS] = sv.windowMullionSpecs(ax);
  const [y0, yMax] = [op.from[1], Math.min(op.to[1], t.ctx.maxY - 1)];
  const isM = (cx: number, y: number, cz: number) => {
    const v = sv.voxelAt(t.ctx.grid, cx, y, cz);
    return v > 0 && t.ctx.descriptors[v]!.shape !== 'pane';
  };
  let count = 0;
  for (let u = 0; u < len; u += 1) {
    const [cx, cz] = [op.from[0] + u * tx, op.from[2] + u * tz];
    count += emitRuns(
      y0,
      yMax + 1,
      (y) => isM(cx, y, cz),
      (ya, yb) =>
        emitBox(
          t,
          [cx, ya, cz],
          [cx, ya, cz],
          { ...vS!, to: [vS!.to[0], (yb - ya + 1) * 16, vS!.to[2]] },
          DIR_BIT.up | DIR_BIT.down,
        ),
    );
  }
  const endMask = ax ? DIR_BIT.east | DIR_BIT.west : DIR_BIT.north | DIR_BIT.south;
  for (let y = y0; y <= yMax; y += 1) {
    count += emitRuns(
      0,
      len,
      (u) => isM(op.from[0] + u * tx, y, op.from[2] + u * tz),
      (ua, ub) => {
        const s16 = (ub - ua + 1) * 16;
        const p: V3 = [op.from[0] + ua * tx, y, op.from[2] + ua * tz];
        return emitBox(
          t,
          p,
          p,
          { ...hS!, to: [ax ? s16 : hS!.to[0], hS!.to[1], ax ? hS!.to[2] : s16] },
          endMask,
        );
      },
    );
  }
  return count;
};

const emitWindowExtras = (t: TrimCtx, op: StructureOpeningMeta): number => {
  const { alongX, tx, tz, len } = sv.openingSpan(op);
  const sy = op.from[1] - 1;
  const [ox, oz] = sv.OUTWARD[op.wall];
  let count = 0;
  if (sy >= 0 && sy < t.ctx.maxY) {
    count += emitRuns(
      0,
      len,
      (u) => solid(t, op.from[0] + u * tx, sy, op.from[2] + u * tz),
      (u0, u1) =>
        emitStrip(t, [op.from[0] + u0 * tx, sy, op.from[2] + u0 * tz], op.wall, [
          2.5,
          0,
          (u1 - u0 + 1) * 16,
          12,
          16,
          'timber_trim',
        ]),
    );
    count += emitRuns(
      0,
      len,
      (u) => {
        const [cx, cz] = [op.from[0] + u * tx, op.from[2] + u * tz];
        return (
          solid(t, cx, sy, cz) &&
          vox(t, cx + ox, sy, cz + oz) <= 0 &&
          vox(t, cx + ox, sy + 1, cz + oz) <= 0
        );
      },
      (u0, u1) => {
        const span = (u1 - u0 + 1) * 16;
        const pos: V3 = [op.from[0] + u0 * tx + ox, sy, op.from[2] + u0 * tz + oz];
        return (
          emitStrip(t, pos, op.wall, [5, 1, span - 1, 10, 16, 'flower_box', DIR_BIT.down]) +
          emitStrip(t, pos, op.wall, [4, 2, span - 2, 8.5, 10, 'timber_trim', DIR_BIT.up])
        );
      },
    );
  }
  return count + emitWindowMullions(t, op, alongX, tx, tz, len);
};

const emitWindowAndDoorTrims = (t: TrimCtx): number => {
  let count = 0;
  for (const op of t.ctx.grid.openings) {
    if (op.kind === 'window' || op.kind === 'bay_window') {
      count +=
        emitOpeningJambs(t, op, 'timber_trim') +
        emitOpeningHeader(t, op, 'timber_trim', false) +
        emitWindowExtras(t, op);
    } else if (op.kind === 'door' || op.kind === 'arch' || op.kind === 'arcade') {
      const tile = op.kind === 'door' ? 'timber_trim' : 'stone_bricks';
      count += emitOpeningJambs(t, op, tile) + emitOpeningHeader(t, op, tile, true);
    }
  }
  return count;
};

const isBottomEaveStair = (
  t: TrimCtx,
  x: number,
  y: number,
  z: number,
  eaveDir: CardinalFacing,
): boolean => {
  const v = vox(t, x, y, z);
  if (v <= 0 || t.ctx.descriptors[v]!.shape !== 'stair') return false;
  const cached = t.ctx.parsedStates[v]!;
  if (cached.parsed.properties.half === 'top' || sv.OPPOSITE[cached.facing] !== eaveDir)
    return false;
  const [ox, oz] = sv.OUTWARD[eaveDir];
  return vox(t, x + ox, y, z + oz) <= 0 && vox(t, x + ox, y - 1, z + oz) <= 0;
};

const emitEaveRow = (
  t: TrimCtx,
  dir: CardinalFacing,
  ax: boolean,
  y: number,
  fixed: number,
  uMax: number,
  bottomStair: Uint8Array,
): number => {
  const [w, _h, d] = t.ctx.grid.size;
  const voxels = t.ctx.grid.voxels;
  const rowBase = y * w * d + (ax ? fixed * w : fixed);
  const uStep = ax ? 1 : w;
  const at = (u: number): V3 => [ax ? u : fixed, y, ax ? fixed : u];
  return emitRuns(
    0,
    uMax,
    (u) =>
      bottomStair[voxels[rowBase + u * uStep]!] === 1 &&
      isBottomEaveStair(t, ax ? u : fixed, y, ax ? fixed : u, dir),
    (u0, u1) => {
      let sub = emitStrip(t, at(u0), dir, [1.5, 0, (u1 - u0 + 1) * 16, 2, 4, 'dark_oak_planks']);
      for (let k = u0; k <= u1; k += 3)
        sub += emitStrip(t, at(k), dir, [2.5, 6, 10, 0, 3.5, 'dark_oak_planks', DIR_BIT.up]);
      return sub;
    },
  );
};

const emitBargeboardCell = (t: TrimCtx, x: number, y: number, z: number): number => {
  const v = vox(t, x, y, z);
  if (v <= 0 || t.ctx.descriptors[v]!.shape !== 'stair') return 0;
  const cached = t.ctx.parsedStates[v]!;
  if (cached.parsed.properties.half === 'top') return 0;
  const occSkip =
    (vox(t, x, y - 1, z) > 0 ? DIR_BIT.down : 0) | (vox(t, x, y + 1, z) > 0 ? DIR_BIT.up : 0);
  let count = 0;
  for (const perp of sv.PERP_DIRS[sv.OPPOSITE[cached.facing]]) {
    const [px, pz] = sv.OUTWARD[perp];
    if (vox(t, x + px, y, z + pz) <= 0 && vox(t, x - px, y, z - pz) > 0)
      count += emitStrip(t, [x, y, z], perp, [2, 0, 16, 0, 4, 'dark_oak_planks', occSkip]);
  }
  return count;
};

const emitRoofEavesAndBargeboards = (t: TrimCtx): number => {
  const [w, _h, d] = t.ctx.grid.size;
  const bottomStair = buildBottomStairMask(t.ctx.descriptors, t.ctx.parsedStates);
  let count = 0;
  for (let y = 1; y < t.ctx.maxY; y += 1) {
    if (!layerHasMaskMatch(t.ctx.grid.voxels, bottomStair, y * w * d, (y + 1) * w * d)) continue;
    count += scanDirRows(w, d, (dir, ax, v, uMax) =>
      emitEaveRow(t, dir, ax, y, v, uMax, bottomStair),
    );
    for (let z = 0; z < d; z += 1)
      for (let x = 0; x < w; x += 1)
        if (bottomStair[t.ctx.grid.voxels[(y * d + z) * w + x]!] === 1)
          count += emitBargeboardCell(t, x, y, z);
  }
  return count;
};

const emitChimneyCell = (t: TrimCtx, x: number, y: number, z: number): number => {
  const v = vox(t, x, y, z);
  const desc = v > 0 ? t.ctx.descriptors[v]! : null;
  if (!desc || desc.shape !== 'full' || !sv.isChimneyBrickTile(desc.top)) return 0;
  if (vox(t, x, y - 1, z) !== v || vox(t, x, y - 2, z) !== v) return 0;
  let openSides = 0;
  for (const c of sv.CARDINALS)
    if (vox(t, x + sv.OUTWARD[c][0], y, z + sv.OUTWARD[c][1]) <= 0) openSides += 1;
  if (openSides < 3) return 0;
  const ab = vox(t, x, y + 1, z);
  const onSlab = ab > 0 && t.ctx.descriptors[ab]!.shape === 'slab' && vox(t, x, y + 2, z) <= 0;
  if (ab > 0 && !onSlab) return 0;
  const specs = sv.chimneyCapSpecs(desc.top, onSlab);
  return emitSpecs(t, [x, y + 1, z], specs, DIR_BIT.down, [x, onSlab ? y + 2 : y + 1, z]);
};

const emitChimneyCaps = (t: TrimCtx): number => {
  const [w, h, d] = t.ctx.grid.size;
  const chimneyMask = buildMaskByPredicate(
    t.ctx.descriptors,
    (desc) => desc.shape === 'full' && sv.isChimneyBrickTile(desc.top),
  );
  let count = 0;
  for (let y = 3; y < Math.min(t.ctx.maxY - 1, h - 1); y += 1)
    for (let z = 0; z < d; z += 1)
      for (let x = 0; x < w; x += 1)
        if (chimneyMask[t.ctx.grid.voxels[(y * d + z) * w + x]!] === 1)
          count += emitChimneyCell(t, x, y, z);
  return count;
};

export const emitArchitecturalTrims = (ctx: MeshCtx, scratch: NonFullScratch): number => {
  const t: TrimCtx = { ctx, scratch };
  return (
    emitCornerPilasters(t) +
    emitFloorBeltCourses(t) +
    emitJettyCorbels(t) +
    emitWindowAndDoorTrims(t) +
    emitRoofEavesAndBargeboards(t) +
    emitChimneyCaps(t)
  );
};
