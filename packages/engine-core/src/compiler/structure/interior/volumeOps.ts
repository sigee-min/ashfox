import type { CardinalFacing, IntVec3 } from '../../../project/structure/contract';
import {
  SUBVOXEL_UNITS_PER_BLOCK,
  type AlcoveKind,
  type AlcoveVolumeSpec,
  type InteriorRoomInput,
  type OpenTrussVolumeSpec,
  type PartitionStyle,
  type PartitionVolumeSpec,
  type RailingStyle,
  type SubVoxelBoxIR,
} from './contract';
import { resolvePartitionDoorway, resolvePartitionSpan } from './zoneRect';

export interface VolumeZoneSurface {
  readonly id: string;
  readonly kind: 'platform' | 'sunken' | 'mezzanine';
  readonly x0_b: number;
  readonly x1_b: number;
  readonly z0_b: number;
  readonly z1_b: number;
  readonly surface_y_16: number;
}

export interface AlcoveCarveSpec {
  readonly pos: IntVec3;
  readonly wall: CardinalFacing;
  readonly depth_16: number;
}

export interface VolCtx {
  readonly room: InteriorRoomInput;
  readonly tile: string;
  readonly boxes: SubVoxelBoxIR[];
  readonly zones: VolumeZoneSurface[];
  readonly carves: IntVec3[];
  readonly carveSpecs: AlcoveCarveSpec[];
  readonly doorways: IntVec3[];
  readonly sunken: IntVec3[];
}

export type B6 = readonly [number, number, number, number, number, number];
export const U = SUBVOXEL_UNITS_PER_BLOCK;

const ALCOVE_TILE: Partial<Record<AlcoveKind, readonly [string, SubVoxelBoxIR['layer']]>> = {
  fireplace: ['deepslate_bricks', 'opaque'],
  cryo_pod: ['soul_lantern', 'emissive'],
};

export const pushBox = (
  c: VolCtx,
  id: string,
  b: B6,
  tag: string,
  tile = c.tile,
  layer: SubVoxelBoxIR['layer'] = 'opaque',
  zone?: string,
): void => {
  c.boxes.push({
    id,
    from_16: [b[0], b[1], b[2]],
    to_16: [b[3], b[4], b[5]],
    tile_id: tile,
    layer,
    semantic_tag: tag,
    ...(zone ? { zone_id: zone } : {}),
  });
};

const axBox = (
  ax: boolean,
  u0: number,
  y0: number,
  z0: number,
  u1: number,
  y1: number,
  z1: number,
): B6 => (ax ? [u0, y0, z0, u1, y1, z1] : [z0, y0, u0, z1, y1, u1]);

export const pushZone = (
  c: VolCtx,
  id: string,
  kind: VolumeZoneSurface['kind'],
  x0: number,
  x1: number,
  z0: number,
  z1: number,
  surfaceY: number,
): void => {
  c.zones.push({
    id,
    kind,
    x0_b: x0,
    x1_b: x1,
    z0_b: z0,
    z1_b: z1,
    surface_y_16: surfaceY,
  });
};

export const emitRailing = (
  c: VolCtx,
  id: string,
  r: readonly [number, number, number, number],
  yBase: number,
  style: RailingStyle,
): void => {
  if (style === 'none') return;
  const railTile =
    style === 'iron' || style === 'cable' ? 'iron_flue' : style === 'glass' ? 'glass' : c.tile;
  const layer: SubVoxelBoxIR['layer'] = style === 'glass' ? 'translucent' : 'opaque';
  const top = yBase + 14;
  pushBox(c, `${id}_t`, [r[0], top - 2, r[1], r[2], top, r[3]], `railing_${style}`);
  pushBox(
    c,
    `${id}_f`,
    [r[0], yBase + 2, r[1], r[2], top - 2, r[3]],
    `railing_${style}`,
    railTile,
    layer,
  );
};

const emitOpenTrussBay = (
  c: VolCtx,
  spec: OpenTrussVolumeSpec,
  bayIdx: number,
  u16: number,
  s0: number,
  s1: number,
  baseY: number,
  ridgeH: number,
  thick: number,
): void => {
  const ax = spec.axis === 'x';
  const half = (s1 - s0) / 2;
  const steps = Math.max(4, Math.round(half / 8));
  const span = (id: string, a: number, b: number, y0: number, y1: number) =>
    pushBox(c, id, axBox(!ax, a, y0, u16, b, y1, u16 + thick), `truss_${spec.style}`);
  span(`tr_${spec.id}_${bayIdx}_t`, s0, s1, baseY, baseY + thick);
  for (let i = 0; i < steps; i += 1) {
    const [t0, t1] = [i / steps, (i + 1) / steps];
    const [y0, y1] = [baseY + t0 * ridgeH, baseY + t0 * ridgeH + thick];
    span(`tr_${spec.id}_${bayIdx}_l${i}`, s0 + t0 * half, s0 + t1 * half, y0, y1);
    span(`tr_${spec.id}_${bayIdx}_r${i}`, s1 - t1 * half, s1 - t0 * half, y0, y1);
  }
  if (spec.style === 'king_post' || spec.style === 'steel_web') {
    span(
      `tr_${spec.id}_${bayIdx}_kp`,
      s0 + half - thick / 2,
      s0 + half + thick / 2,
      baseY + thick,
      baseY + ridgeH,
    );
  }
};

export const emitOpenTruss = (c: VolCtx, spec: OpenTrussVolumeSpec): void => {
  const [ix0, iz0] = [(c.room.bounds_from[0] + 1) * U, (c.room.bounds_from[2] + 1) * U];
  const [ix1, iz1] = [c.room.bounds_to[0] * U, c.room.bounds_to[2] * U];
  const [baseY, ridgeH, thick] = [
    c.room.bounds_to[1] * U - 4,
    spec.ridge_height_16 ?? 28,
    spec.chord_thickness_16 ?? 3,
  ];
  const spacing = Math.max(1, spec.bay_spacing_b ?? 2) * U;
  const [uStart, uEnd, s0, s1] =
    spec.axis === 'x' ? [ix0 + 8, ix1 - 8, iz0, iz1] : [iz0 + 8, iz1 - 8, ix0, ix1];
  let bay = 0;
  for (let u = uStart; u <= uEnd; u += spacing)
    emitOpenTrussBay(c, spec, bay++, u, s0, s1, baseY, ridgeH, thick);
  const mid = (s0 + s1) / 2;
  const rg: B6 =
    spec.axis === 'x'
      ? [ix0, baseY + ridgeH - thick, mid - 2, ix1, baseY + ridgeH, mid + 2]
      : [mid - 2, baseY + ridgeH - thick, iz0, mid + 2, baseY + ridgeH, iz1];
  pushBox(c, `tr_${spec.id}_rg`, rg, 'truss_ridge');
};

const recordAlcoveCarves = (
  c: VolCtx,
  ax: boolean,
  uStartB: number,
  y0B: number,
  wallB: number,
  depth16: number,
  spec: AlcoveVolumeSpec,
): void => {
  if (depth16 <= 0) return;
  const [bf, bt] = [c.room.bounds_from, c.room.bounds_to];
  const [uMin, uMax] = ax ? [bf[0] + 1, bt[0] - 1] : [bf[2] + 1, bt[2] - 1];
  const [yMin, yMax] = [bf[1] + 1, bt[1] - 1];
  for (let du = 0; du < spec.width_b; du += 1) {
    const u = uStartB + du;
    if (u < uMin || u > uMax) continue;
    for (let dy = 0; dy < spec.height_b; dy += 1) {
      const y = y0B + dy;
      if (y < yMin || y > yMax) continue;
      const pos: IntVec3 = ax ? [u, y, wallB] : [wallB, y, u];
      c.carves.push(pos);
      c.carveSpecs.push({ pos, wall: spec.wall, depth_16: depth16 });
    }
  }
};

export const emitAlcove = (c: VolCtx, spec: AlcoveVolumeSpec): void => {
  const ax = spec.wall === 'north' || spec.wall === 'south';
  const y0B = c.room.bounds_from[1] + 1;
  const [bf, bt] = [c.room.bounds_from, c.room.bounds_to];
  const wallB = { north: bf[2], south: bt[2], west: bf[0], east: bt[0] }[spec.wall];
  const uStartB = (ax ? bf[0] : bf[2]) + 1 + spec.at_u;
  const yOff = spec.y_offset_16 ?? 0;
  const depth = spec.depth_16 === 0 ? 0 : Math.min(12, Math.max(4, spec.depth_16 ?? 8));
  recordAlcoveCarves(c, ax, uStartB, y0B + Math.floor(yOff / U), wallB, depth, spec);
  const [u0, u1] = [uStartB * U, (uStartB + spec.width_b) * U];
  const [y0, y1] = [y0B * U + yOff, y0B * U + yOff + spec.height_b * U];
  const [d0, d1] =
    spec.wall === 'north' || spec.wall === 'west'
      ? [wallB * U + 16 - depth, wallB * U + 16]
      : [wallB * U, wallB * U + depth];
  const [bk0, bk1] = spec.wall === 'north' || spec.wall === 'west' ? [d0, d0 + 2] : [d1 - 2, d1];
  const [bTile, bLayer] = ALCOVE_TILE[spec.alcove_kind] ?? [c.tile, 'opaque'];
  const tag = `alcove_${spec.alcove_kind}`;
  pushBox(c, `alc_${spec.id}_bk`, axBox(ax, u0, y0, bk0, u1, y1, bk1), tag, bTile, bLayer);
  pushBox(c, `alc_${spec.id}_lt`, axBox(ax, u0 - 2, y1 - 3, d0, u1 + 2, y1, d1), tag);
};

const PARTITION_STYLE_PROPS: Record<PartitionStyle, readonly [string, SubVoxelBoxIR['layer']]> = {
  colonnade: ['', 'opaque'],
  sliding_shoji: ['plaster_white', 'translucent'],
  fusuma: ['', 'opaque'],
  glass_wall: ['glass', 'translucent'],
  booth: ['', 'opaque'],
  screen: ['', 'opaque'],
};

const emitPartitionDoor = (
  c: VolCtx,
  spec: PartitionVolumeSpec,
  u: number,
  fy: number,
  cy: number,
  fx: number,
  slideOff: number,
): void => {
  const ax = spec.axis === 'x';
  const yFloorB = c.room.bounds_from[1] + 1;
  c.doorways.push(ax ? [u, yFloorB, spec.at_pos] : [spec.at_pos, yFloorB, u]);
  if (spec.style !== 'sliding_shoji' && spec.style !== 'fusuma') return;
  const s0 = u * U + slideOff;
  const b = axBox(ax, s0, fy, fx, s0 + 12, cy - 2, fx + 1.5);
  pushBox(
    c,
    `pt_${spec.id}_s${u}`,
    b,
    `partition_door_${spec.style}`,
    'plaster_white',
    'translucent',
  );
};

const emitPartitionSolid = (
  c: VolCtx,
  spec: PartitionVolumeSpec,
  u: number,
  fy: number,
  cy: number,
  fx: number,
): void => {
  const ax = spec.axis === 'x';
  const [u0, u1] = [u * U, (u + 1) * U];
  if (spec.style === 'colonnade') {
    if ((u - spec.span_from) % 2 === 0)
      pushBox(
        c,
        `pt_${spec.id}_c${u}`,
        axBox(ax, u0 + 5, fy, fx - 2, u0 + 11, cy, fx + 4),
        'partition_colonnade',
      );
    return;
  }
  const top = spec.style === 'booth' ? fy + 18 : spec.style === 'screen' ? fy + 24 : cy;
  const [pTile, pLayer] = PARTITION_STYLE_PROPS[spec.style];
  pushBox(
    c,
    `pt_${spec.id}_${u}`,
    axBox(ax, u0, fy, fx, u1, top, fx + 2),
    `partition_${spec.style}`,
    pTile || c.tile,
    pLayer,
  );
};

export const emitPartition = (c: VolCtx, spec: PartitionVolumeSpec): void => {
  const span = resolvePartitionSpan(c.room, spec);
  if (!span) return;
  const [lo, hi] = span;
  const [fy, cy] = [(c.room.bounds_from[1] + 1) * U, c.room.bounds_to[1] * U];
  const { doorAt, doorW } = resolvePartitionDoorway(spec);
  const slideOff = Math.round(Math.max(0, Math.min(1, spec.open_ratio ?? 0.4)) * 10);
  const fx = spec.at_pos * U + 7;
  for (let u = lo; u <= hi; u += 1) {
    if (u >= doorAt && u < doorAt + doorW) emitPartitionDoor(c, spec, u, fy, cy, fx, slideOff);
    else emitPartitionSolid(c, spec, u, fy, cy, fx);
  }
};
