import type { CardinalFacing, IntVec2, IntVec3 } from '../../../project/structure/contract';
import {
  InteriorContractError,
  SUBVOXEL_UNITS_PER_BLOCK,
  type AlcoveKind,
  type AlcoveVolumeSpec,
  type InteriorRoomInput,
  type MezzanineVolumeSpec,
  type OpenTrussVolumeSpec,
  type PartitionStyle,
  type PartitionVolumeSpec,
  type PlatformVolumeSpec,
  type RailingStyle,
  type StyleDnaArch,
  type SubVoxelBoxIR,
  type VolumeAnchor,
} from './contract';

export interface VolumeZoneSurface {
  readonly id: string;
  readonly kind: 'platform' | 'sunken' | 'mezzanine';
  readonly x0_b: number;
  readonly x1_b: number;
  readonly z0_b: number;
  readonly z1_b: number;
  readonly surface_y_16: number;
}

export interface InteriorVolumeResult {
  readonly boxes: readonly SubVoxelBoxIR[];
  readonly zone_surfaces: readonly VolumeZoneSurface[];
  readonly alcove_carves: readonly IntVec3[];
  readonly doorway_clearances: readonly IntVec3[];
}

interface VolCtx {
  readonly room: InteriorRoomInput;
  readonly tile: string;
  readonly boxes: SubVoxelBoxIR[];
  readonly zones: VolumeZoneSurface[];
  readonly carves: IntVec3[];
  readonly doorways: IntVec3[];
}

type B6 = readonly [number, number, number, number, number, number];
const U = SUBVOXEL_UNITS_PER_BLOCK;

const ARCH_TIMBER: Readonly<Record<StyleDnaArch, string>> = {
  rustic: 'timber_trim',
  japanese: 'birch_planks',
  modern: 'dark_oak_planks',
  scifi: 'iron_flue',
  gothic: 'deepslate_bricks',
  desert: 'oak_planks',
  industrial: 'iron_block',
  nordic: 'spruce_planks',
};

const ALCOVE_TILE: Partial<Record<AlcoveKind, readonly [string, SubVoxelBoxIR['layer']]>> = {
  fireplace: ['deepslate_bricks', 'opaque'],
  cryo_pod: ['soul_lantern', 'emissive'],
};

const pushBox = (
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

const pushZone = (
  c: VolCtx,
  id: string,
  kind: VolumeZoneSurface['kind'],
  x0: number,
  x1: number,
  z0: number,
  z1: number,
  surfaceY: number,
): void => {
  c.zones.push({ id, kind, x0_b: x0, x1_b: x1, z0_b: z0, z1_b: z1, surface_y_16: surfaceY });
};

const WEST = new Set<VolumeAnchor>(['west', 'nw', 'sw']);
const EAST = new Set<VolumeAnchor>(['east', 'ne', 'se']);
const NORTH = new Set<VolumeAnchor>(['north', 'nw', 'ne']);
const SOUTH = new Set<VolumeAnchor>(['south', 'sw', 'se']);

const resolveAnchor = (
  anchor: VolumeAnchor,
  ix0: number,
  ix1: number,
  iz0: number,
  iz1: number,
  w: number,
  d: number,
): IntVec2 => {
  const [cx, cz] = [Math.floor((ix0 + ix1 - w + 1) / 2), Math.floor((iz0 + iz1 - d + 1) / 2)];
  const x = WEST.has(anchor) ? ix0 : EAST.has(anchor) ? ix1 - w + 1 : cx;
  const z = NORTH.has(anchor) ? iz0 : SOUTH.has(anchor) ? iz1 - d + 1 : cz;
  return [Math.max(ix0, x), Math.max(iz0, z)];
};

const emitRailing = (
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

const stepBoundsFor = (
  sf: CardinalFacing,
  px0: number,
  pz0: number,
  px1: number,
  pz1: number,
): readonly [number, number, number, number] => {
  const m: Record<CardinalFacing, readonly [number, number, number, number]> = {
    south: [px0 + 4, pz1, px1 - 4, pz1 + 6],
    north: [px0 + 4, pz0 - 6, px1 - 4, pz0],
    east: [px1, pz0 + 4, px1 + 6, pz1 - 4],
    west: [px0 - 6, pz0 + 4, px0, pz1 - 4],
  };
  return m[sf];
};

const emitPlatformBoxes = (
  c: VolCtx,
  spec: PlatformVolumeSpec,
  r: readonly [number, number, number, number],
  fy: number,
  surfY: number,
  dk: string,
): void => {
  const [px0, pz0, px1, pz1] = r;
  const emit = (suffix: string, b: B6, tag: string, tl = dk) =>
    pushBox(c, `vol_${spec.id}_${suffix}`, b, tag, tl, 'opaque', spec.id);
  if (spec.kind === 'platform') {
    const [sx0, sz0, sx1, sz1] = stepBoundsFor(spec.step_facing ?? 'south', px0, pz0, px1, pz1);
    emit('dk', [px0, fy, pz0, px1, surfY, pz1], 'volume_platform');
    emit('st', [sx0, fy, sz0, sx1, fy + Math.floor(spec.height_16 / 2), sz1], 'volume_step');
    return;
  }
  emit('pt', [px0 + 2, surfY - 1, pz0 + 2, px1 - 2, surfY, pz1 - 2], 'volume_sunken');
  emit('rn', [px0, surfY, pz0, px1, fy, pz0 + 2], 'volume_sunken_rim', c.tile);
  emit('rs', [px0, surfY, pz1 - 2, px1, fy, pz1], 'volume_sunken_rim', c.tile);
};

const emitPlatformOrSunken = (c: VolCtx, spec: PlatformVolumeSpec): void => {
  const absH = Math.abs(spec.height_16);
  const badSign =
    (spec.kind === 'platform' && spec.height_16 < 0) ||
    (spec.kind === 'sunken' && spec.height_16 > 0);
  if (absH < 4 || absH > 8 || badSign) {
    throw new InteriorContractError({
      pointer: `volume.${spec.id}.height_16`,
      expected: spec.kind === 'platform' ? '4..8' : '-8..-4',
      actual: String(spec.height_16),
    });
  }
  const [bf, bt] = [c.room.bounds_from, c.room.bounds_to];
  const [ix0, iy0, iz0] = [bf[0] + 1, bf[1] + 1, bf[2] + 1];
  const [w, d] = [Math.min(spec.size[0], bt[0] - ix0), Math.min(spec.size[1], bt[2] - iz0)];
  const [ox, oz] =
    spec.from ?? resolveAnchor(spec.on ?? 'north', ix0, bt[0] - 1, iz0, bt[2] - 1, w, d);
  const [fy, surfY] = [iy0 * U, iy0 * U + spec.height_16];
  const rect: readonly [number, number, number, number] = [
    ox * U,
    oz * U,
    (ox + w) * U,
    (oz + d) * U,
  ];
  emitPlatformBoxes(c, spec, rect, fy, surfY, spec.trim_tile ?? c.tile);
  if (spec.railing && spec.railing !== 'none')
    emitRailing(
      c,
      `vol_${spec.id}_rl`,
      [rect[0], rect[3] - 2, rect[2], rect[3]],
      surfY,
      spec.railing,
    );
  pushZone(c, spec.id, spec.kind, ox, ox + w - 1, oz, oz + d - 1, surfY);
};

const mezSpan = (
  min: number,
  max: number,
  on: CardinalFacing,
  lo: CardinalFacing,
  hi: CardinalFacing,
  depth: number,
): IntVec2 =>
  on === hi
    ? [Math.max(min, max - depth + 1), max]
    : on === lo
      ? [min, Math.min(max, min + depth - 1)]
      : [min, max];

const emitMezzanineSupports = (
  c: VolCtx,
  spec: MezzanineVolumeSpec,
  r: readonly [number, number, number, number],
  rPos: number,
  fy: number,
  deckBot: number,
): void => {
  if (spec.support_pillars === false) return;
  const alongX = spec.on === 'north' || spec.on === 'south';
  const [p0x, p0z, p1x, p1z] = alongX
    ? [r[0], rPos - 2, r[2] - 4, rPos - 2]
    : [rPos - 2, r[1], rPos - 2, r[3] - 4];
  pushBox(c, `mez_${spec.id}_p1`, [p0x, fy, p0z, p0x + 4, deckBot, p0z + 4], 'mezzanine_pillar');
  pushBox(c, `mez_${spec.id}_p2`, [p1x, fy, p1z, p1x + 4, deckBot, p1z + 4], 'mezzanine_pillar');
};

const emitMezzanine = (c: VolCtx, spec: MezzanineVolumeSpec): void => {
  const [bf, bt] = [c.room.bounds_from, c.room.bounds_to];
  const [ix0, iy0, iz0] = [bf[0] + 1, bf[1] + 1, bf[2] + 1];
  const [ix1, iy1, iz1] = [bt[0] - 1, bt[1] - 1, bt[2] - 1];
  const yOff = Math.max(
    2,
    Math.min(iy1 - iy0 - 1, spec.y_offset_b ?? Math.max(3, Math.floor((iy1 - iy0 + 1) * 0.5))),
  );
  const [deckTop, deckBot] = [(iy0 + yOff) * U, (iy0 + yOff) * U - 4];
  const [ox0, ox1] = mezSpan(ix0, ix1, spec.on, 'west', 'east', spec.depth);
  const [oz0, oz1] = mezSpan(iz0, iz1, spec.on, 'north', 'south', spec.depth);
  const r: readonly [number, number, number, number] = [
    ox0 * U,
    oz0 * U,
    (ox1 + 1) * U,
    (oz1 + 1) * U,
  ];
  pushBox(
    c,
    `mez_${spec.id}_dk`,
    [r[0], deckBot, r[1], r[2], deckTop, r[3]],
    'volume_mezzanine',
    c.tile,
    'opaque',
    spec.id,
  );
  const alongX = spec.on === 'north' || spec.on === 'south';
  const rPos = { north: r[3] - 2, south: r[1], west: r[2] - 2, east: r[0] }[spec.on];
  const railR: readonly [number, number, number, number] = alongX
    ? [r[0], rPos, r[2], rPos + 2]
    : [rPos, r[1], rPos + 2, r[3]];
  emitRailing(c, `mez_${spec.id}_rl`, railR, deckTop, spec.railing);
  emitMezzanineSupports(c, spec, r, rPos, iy0 * U, deckBot);
  pushZone(c, spec.id, 'mezzanine', ox0, ox1, oz0, oz1, deckTop);
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

const emitOpenTruss = (c: VolCtx, spec: OpenTrussVolumeSpec): void => {
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
  spec: AlcoveVolumeSpec,
): void => {
  for (let du = 0; du < spec.width_b; du += 1) {
    for (let dy = 0; dy < spec.height_b; dy += 1)
      c.carves.push(ax ? [uStartB + du, y0B + dy, wallB] : [wallB, y0B + dy, uStartB + du]);
  }
};

const emitAlcove = (c: VolCtx, spec: AlcoveVolumeSpec): void => {
  const ax = spec.wall === 'north' || spec.wall === 'south';
  const y0B = c.room.bounds_from[1] + 1;
  const [bf, bt] = [c.room.bounds_from, c.room.bounds_to];
  const wallB = { north: bf[2], south: bt[2], west: bf[0], east: bt[0] }[spec.wall];
  const uStartB = (ax ? bf[0] : bf[2]) + 1 + spec.at_u;
  recordAlcoveCarves(c, ax, uStartB, y0B, wallB, spec);
  const [u0, u1, yOff] = [uStartB * U, (uStartB + spec.width_b) * U, spec.y_offset_16 ?? 0];
  const [y0, y1] = [y0B * U + yOff, y0B * U + yOff + spec.height_b * U];
  const depth = Math.min(12, Math.max(4, spec.depth_16 ?? 8));
  const [d0, d1] =
    spec.wall === 'north' || spec.wall === 'west'
      ? [wallB * U + 16 - depth, wallB * U + 16]
      : [wallB * U, wallB * U + depth];
  const [bTile, bLayer] = ALCOVE_TILE[spec.alcove_kind] ?? [c.tile, 'opaque'];
  const tag = `alcove_${spec.alcove_kind}`;
  pushBox(c, `alc_${spec.id}_bk`, axBox(ax, u0, y0, d0, u1, y1, d0 + 2), tag, bTile, bLayer);
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
  pushBox(c, `pt_${spec.id}_s${u}`, b, `partition_${spec.style}`, 'plaster_white', 'translucent');
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

const emitPartition = (c: VolCtx, spec: PartitionVolumeSpec): void => {
  const [fy, cy] = [(c.room.bounds_from[1] + 1) * U, c.room.bounds_to[1] * U];
  const doorAt = spec.doorway_at ?? Math.floor((spec.span_from + spec.span_to) / 2);
  const doorW = Math.max(2, spec.doorway_width ?? 2);
  const slideOff = Math.round(Math.max(0, Math.min(1, spec.open_ratio ?? 0.4)) * 10);
  const fx = spec.at_pos * U + 7;
  for (let u = spec.span_from; u <= spec.span_to; u += 1) {
    if (u >= doorAt && u < doorAt + doorW) emitPartitionDoor(c, spec, u, fy, cy, fx, slideOff);
    else emitPartitionSolid(c, spec, u, fy, cy, fx);
  }
};

/** Generates sculpted spatial volumes (platform, sunken, mezzanine, open_truss, alcove, partition). */
export const buildSculptedVolumes = (room: InteriorRoomInput): InteriorVolumeResult => {
  const c: VolCtx = {
    room,
    tile: ARCH_TIMBER[room.style_dna.arch],
    boxes: [],
    zones: [],
    carves: [],
    doorways: [],
  };
  for (const vol of room.volumes) {
    if (vol.kind === 'platform' || vol.kind === 'sunken') emitPlatformOrSunken(c, vol);
    else if (vol.kind === 'mezzanine') emitMezzanine(c, vol);
    else if (vol.kind === 'open_truss') emitOpenTruss(c, vol);
    else if (vol.kind === 'alcove') emitAlcove(c, vol);
    else if (vol.kind === 'partition') emitPartition(c, vol);
  }
  return {
    boxes: c.boxes,
    zone_surfaces: c.zones,
    alcove_carves: c.carves,
    doorway_clearances: c.doorways,
  };
};
