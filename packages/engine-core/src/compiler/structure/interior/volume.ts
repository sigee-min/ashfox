import type { CardinalFacing, IntVec3 } from '../../../project/structure/contract';
import {
  InteriorContractError,
  type InteriorRoomInput,
  type MezzanineVolumeSpec,
  type PlatformVolumeSpec,
  type StyleDnaArch,
  type SubVoxelBoxIR,
} from './contract';
import {
  U,
  emitAlcove,
  emitOpenTruss,
  emitPartition,
  emitRailing,
  pushBox,
  pushZone,
  type AlcoveCarveSpec,
  type B6,
  type VolCtx,
  type VolumeZoneSurface,
} from './volumeOps';
import { resolveMezzanineRect, resolveMezzanineYOffset, resolvePlatformRect } from './zoneRect';

export { resolvePlatformRect } from './zoneRect';
export type { AlcoveCarveSpec, VolumeZoneSurface } from './volumeOps';

export interface InteriorVolumeResult {
  readonly boxes: readonly SubVoxelBoxIR[];
  readonly zone_surfaces: readonly VolumeZoneSurface[];
  readonly alcove_carves: readonly IntVec3[];
  readonly alcove_carve_specs: readonly AlcoveCarveSpec[];
  readonly doorway_clearances: readonly IntVec3[];
  readonly sunken_cells: readonly IntVec3[];
}

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

const stepBoundsFor = (
  sf: CardinalFacing,
  px0: number,
  pz0: number,
  px1: number,
  pz1: number,
): readonly [number, number, number, number] => {
  if (sf === 'south') return [px0 + 4, pz1, px1 - 4, pz1 + 6];
  if (sf === 'north') return [px0 + 4, pz0 - 6, px1 - 4, pz0];
  return sf === 'east' ? [px1, pz0 + 4, px1 + 6, pz1 - 4] : [px0 - 6, pz0 + 4, px0, pz1 - 4];
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
  emit('rw', [px0, surfY, pz0 + 2, px0 + 2, fy, pz1 - 2], 'volume_sunken_rim', c.tile);
  emit('re', [px1 - 2, surfY, pz0 + 2, px1, fy, pz1 - 2], 'volume_sunken_rim', c.tile);
};

const recordSunkenCells = (c: VolCtx, ox: number, oz: number, w: number, d: number): void => {
  for (let z = oz; z < oz + d; z += 1)
    for (let x = ox; x < ox + w; x += 1) c.sunken.push([x, c.room.bounds_from[1], z]);
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
  const iy0 = c.room.bounds_from[1] + 1;
  const { ox, oz, w, d } = resolvePlatformRect(c.room, spec);
  const [fy, surfY] = [iy0 * U, iy0 * U + spec.height_16];
  const rect: readonly [number, number, number, number] = [
    ox * U,
    oz * U,
    (ox + w) * U,
    (oz + d) * U,
  ];
  emitPlatformBoxes(c, spec, rect, fy, surfY, spec.trim_tile ?? c.tile);
  if (spec.kind === 'sunken') recordSunkenCells(c, ox, oz, w, d);
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
  const iy0 = c.room.bounds_from[1] + 1;
  const yOff = resolveMezzanineYOffset(c.room, spec.y_offset_b);
  const [deckTop, deckBot] = [(iy0 + yOff) * U, (iy0 + yOff) * U - 4];
  const rect = resolveMezzanineRect(c.room, spec);
  const [ox0, ox1, oz0, oz1] = [rect.ox, rect.ox + rect.w - 1, rect.oz, rect.oz + rect.d - 1];
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

/** Generates sculpted spatial volumes (platform, sunken, mezzanine, open_truss, alcove, partition). */
export const buildSculptedVolumes = (room: InteriorRoomInput): InteriorVolumeResult => {
  const c: VolCtx = {
    room,
    tile: ARCH_TIMBER[room.style_dna.arch],
    boxes: [],
    zones: [],
    carves: [],
    carveSpecs: [],
    doorways: [],
    sunken: [],
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
    alcove_carve_specs: c.carveSpecs,
    doorway_clearances: c.doorways,
    sunken_cells: c.sunken,
  };
};
