import type { Vec3 } from '../../../model/identity';
import type { CardinalFacing } from '../../../project/structure/contract';
import {
  SUBVOXEL_UNITS_PER_BLOCK,
  type InteriorPropKind,
  type InteriorPropSpec,
  type MountSurface,
  type PlayableInteriorHook,
  type StyleDna,
  type SubVoxelBoxIR,
} from './contract';
import {
  NO_JOINS,
  box16,
  buildChairBoxes,
  buildCounterBoxes,
  buildCushionBoxes,
  buildFireplaceBoxes,
  buildShelvingBoxes,
  buildSofaBoxes,
  buildStorageBoxes,
  buildTableBoxes,
  buildTerminalBoxes,
  finalizeLocalBoxes,
  materialsForStyle,
  signedSeed,
  type JoinEdges,
  type LocalBoxDraft,
  type StyleMaterials,
} from './propsGeo';

export interface CustomPropMount {
  readonly id: string;
  readonly asset_alias: string;
  readonly at_16: Vec3;
  readonly mount_on: MountSurface;
  readonly facing: CardinalFacing;
  readonly rotation_y_deg: number;
  readonly zone_id?: string;
}

export interface PropCompileResult {
  readonly boxes: readonly SubVoxelBoxIR[];
  readonly custom_mounts: readonly CustomPropMount[];
  readonly hooks: readonly PlayableInteriorHook[];
  readonly surface_y_16: number;
}

export interface CompiledPropsBundle {
  readonly boxes: readonly SubVoxelBoxIR[];
  readonly custom_mounts: readonly CustomPropMount[];
  readonly hooks: readonly PlayableInteriorHook[];
  readonly surface_y_map: ReadonlyMap<string, number>;
}

const SURFACE_HEIGHT_MAP: ReadonlyMap<string, number> = new Map(
  'table:16,tables:16,dining_set:16,low_table:8,counter:14,l_counter:14,terminal:12,terminals:12,console_terminal:12,fireplace:25,cabinet:24,display_case:25.5,shelving:28,wall_shelf:1.5,barrel_rack:14,sofa:8.5,sofas:8.5,chair:8.5,swivel_chair:9,cushion:2.8,cushions:2.8,holo_screen:3,custom_prop:8'
    .split(',')
    .map((row) => {
      const [k, v] = row.split(':');
      return [k!, Number(v)];
    }),
);

export const propSurfaceHeight16 = (kind: InteriorPropKind): number =>
  SURFACE_HEIGHT_MAP.get(kind) ?? 8;

const SEAT_KINDS: ReadonlySet<string> = new Set(
  'chair,swivel_chair,sofa,sofas,cushion,cushions,dining_set'.split(','),
);
const STATION_KINDS: ReadonlySet<string> = new Set(
  'table,tables,low_table,counter,l_counter,terminal,terminals,console_terminal,dining_set'.split(
    ',',
  ),
);

const JOIN_GROUPS: Partial<Record<InteriorPropKind, string>> = {
  table: 'table',
  tables: 'table',
  sofa: 'sofa',
  sofas: 'sofa',
  terminal: 'terminal',
  terminals: 'terminal',
  console_terminal: 'terminal',
};

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

const facingAxes = (
  facing: CardinalFacing,
): { right: readonly [number, number]; back: readonly [number, number] } => {
  if (facing === 'east') return { right: [0, 1], back: [-1, 0] };
  if (facing === 'south') return { right: [-1, 0], back: [0, -1] };
  if (facing === 'west') return { right: [0, -1], back: [1, 0] };
  return { right: [1, 0], back: [0, 1] };
};

export interface OrganicTransform {
  readonly rotation_y_deg: number;
  readonly offset_x_16: number;
  readonly offset_z_16: number;
}

/** Deterministic organic micro-rotation and sub-voxel offset calibrated by organic in [0, 1]. */
export const computeOrganicTransform = (
  seed: number,
  id: string,
  organic: number,
  explicitDeg?: number,
  isMovableSeat = false,
): OrganicTransform => {
  const level = clamp01(organic);
  if (explicitDeg !== undefined) {
    return { rotation_y_deg: explicitDeg, offset_x_16: 0, offset_z_16: 0 };
  }
  if (level <= 0 || !isMovableSeat) {
    return { rotation_y_deg: 0, offset_x_16: 0, offset_z_16: 0 };
  }
  const yaw = Math.round(signedSeed(seed, `${id}:yaw`) * 16 * level * 10) / 10;
  const ox = Math.round(signedSeed(seed, `${id}:ox`) * 2 * level * 10) / 10;
  const oz = Math.round(signedSeed(seed, `${id}:oz`) * 2 * level * 10) / 10;
  return { rotation_y_deg: yaw, offset_x_16: ox, offset_z_16: oz };
};

const detectNeighbors = (spec: InteriorPropSpec, all: readonly InteriorPropSpec[]): JoinEdges => {
  const group = JOIN_GROUPS[spec.kind];
  if (!group || spec.auto_join === false) return NO_JOINS;
  const [wB, dB] = spec.size ?? [1, 1];
  const { right, back } = facingAxes(spec.facing);
  const near = (dx: number, dz: number): boolean =>
    all.some((other) => {
      if (other.id === spec.id || JOIN_GROUPS[other.kind] !== group || other.auto_join === false)
        return false;
      if (Math.abs(other.at[1] - spec.at[1]) > 0.25) return false;
      return (
        Math.abs(other.at[0] - (spec.at[0] + dx)) < 0.35 &&
        Math.abs(other.at[2] - (spec.at[2] + dz)) < 0.35
      );
    });
  return {
    left: near(-right[0], -right[1]),
    right: near(right[0] * wB, right[1] * wB),
    front: near(-back[0], -back[1]),
    back: near(back[0] * dB, back[1] * dB),
  };
};

interface DraftCtx {
  readonly spec: InteriorPropSpec;
  readonly w16: number;
  readonly d16: number;
  readonly mat: StyleMaterials;
  readonly joins: JoinEdges;
  readonly style: StyleDna['furn'];
  readonly seed: number;
}

const PROP_DRAFT_BUILDERS: Readonly<
  Record<InteriorPropKind, (c: DraftCtx) => readonly LocalBoxDraft[]>
> = {
  table: (c) => buildTableBoxes(c.w16, c.d16, c.mat, c.joins, false, c.style),
  tables: (c) => buildTableBoxes(c.w16, c.d16, c.mat, c.joins, false, c.style),
  dining_set: (c) => buildTableBoxes(c.w16, c.d16, c.mat, c.joins, false, c.style),
  low_table: (c) => buildTableBoxes(c.w16, c.d16, c.mat, c.joins, true, c.style),
  counter: (c) => buildCounterBoxes(c.w16, c.d16, c.mat, false, c.style),
  l_counter: (c) => buildCounterBoxes(c.w16, c.d16, c.mat, true, c.style),
  sofa: (c) => buildSofaBoxes(c.w16, c.mat, c.joins),
  sofas: (c) => buildSofaBoxes(c.w16, c.mat, c.joins),
  chair: (c) => buildChairBoxes(c.mat, false),
  swivel_chair: (c) => buildChairBoxes(c.mat, true),
  cushion: (c) => buildCushionBoxes(c.mat),
  cushions: (c) => buildCushionBoxes(c.mat),
  shelving: (c) => buildShelvingBoxes(c.w16, c.mat, c.spec.mount_on === 'wall', c.seed),
  wall_shelf: (c) => buildShelvingBoxes(c.w16, c.mat, true, c.seed),
  terminal: (c) => buildTerminalBoxes(c.w16, c.mat, c.joins),
  terminals: (c) => buildTerminalBoxes(c.w16, c.mat, c.joins),
  console_terminal: (c) => buildTerminalBoxes(c.w16, c.mat, c.joins),
  fireplace: (c) => buildFireplaceBoxes(c.w16, c.mat),
  barrel_rack: (c) => buildStorageBoxes('barrel_rack', c.w16, c.mat),
  display_case: (c) => buildStorageBoxes('display_case', c.w16, c.mat),
  cabinet: (c) => buildStorageBoxes('cabinet', c.w16, c.mat),
  holo_screen: (c) => buildStorageBoxes('holo_screen', c.w16, c.mat),
  custom_prop: (c) => [box16('mount_base', 4, 0, 4, 12, 8, 12, c.mat.accent)],
};

const draftsForSimpleKind = (
  spec: InteriorPropSpec,
  w16: number,
  d16: number,
  mat: StyleMaterials,
  joins: JoinEdges,
  style: StyleDna['furn'],
  seed: number,
): readonly LocalBoxDraft[] =>
  PROP_DRAFT_BUILDERS[spec.kind]({ spec, w16, d16, mat, joins, style, seed });

const buildOrganicDetailBoxes = (
  spec: InteriorPropSpec,
  origin16: Vec3,
  w16: number,
  mat: StyleMaterials,
  organic: number,
  seed: number,
): readonly SubVoxelBoxIR[] => {
  if (organic < 0.35) return [];
  if (spec.kind === 'fireplace') {
    const yaw = 14 + Math.round(signedSeed(seed, `${spec.id}:sword`) * 4);
    const lean = [box16('leaning_blade', w16 - 3, 0, 2, w16 - 1.5, 19, 3.5, mat.metal)];
    return finalizeLocalBoxes(
      `${spec.id}:organic`,
      lean,
      origin16,
      w16,
      16,
      spec.facing,
      yaw,
      spec.zone_id,
    );
  }
  if (spec.kind === 'shelving') {
    const yaw = Math.round(7 * organic * 10) / 10;
    const stack = [box16('skew_books', 4, 28, 10, 8, 30.5, 14, mat.fabric)];
    return finalizeLocalBoxes(
      `${spec.id}:organic`,
      stack,
      origin16,
      w16,
      16,
      spec.facing,
      yaw,
      spec.zone_id,
    );
  }
  return [];
};

const diningSeatOffsets = (
  wB: number,
  dB: number,
  seatCount: number,
): readonly [number, number, CardinalFacing][] => {
  const seats: [number, number, CardinalFacing][] = [];
  for (let i = 0; i < wB && seats.length < seatCount; i += 1) {
    seats.push([i, -1, 'south']);
    if (seats.length < seatCount) seats.push([i, dB, 'north']);
  }
  if (seats.length < seatCount) seats.push([-1, 0, 'east']);
  if (seats.length < seatCount) seats.push([wB, 0, 'west']);
  return seats;
};

const CW_FACING: readonly CardinalFacing[] = ['north', 'east', 'south', 'west'];

const rotateChairOffset = (
  lx: number,
  lz: number,
  relFacing: CardinalFacing,
  wB: number,
  dB: number,
  tableFacing: CardinalFacing,
): readonly [number, number, CardinalFacing] => {
  const rotIdx = CW_FACING.indexOf(tableFacing);
  const nextFacing = CW_FACING[(CW_FACING.indexOf(relFacing) + rotIdx) % 4]!;
  if (tableFacing === 'east') return [dB - 1 - lz, lx, nextFacing];
  if (tableFacing === 'south') return [wB - 1 - lx, dB - 1 - lz, nextFacing];
  if (tableFacing === 'west') return [lz, wB - 1 - lx, nextFacing];
  return [lx, lz, nextFacing];
};

const buildDiningChairs = (
  spec: InteriorPropSpec,
  styleDna: StyleDna,
  seed: number,
  organic: number,
): { boxes: SubVoxelBoxIR[]; hooks: PlayableInteriorHook[] } => {
  const [wB, dB] = spec.size ?? [2, 1];
  const count = spec.seat_count ?? Math.max(2, wB * 2);
  const offsets = diningSeatOffsets(wB, dB, count);
  const mat = materialsForStyle(spec.style_override ?? styleDna.furn);
  const boxes: SubVoxelBoxIR[] = [];
  const hooks: PlayableInteriorHook[] = [];
  offsets.forEach(([lx, lz, relFacing], idx) => {
    const chairId = `${spec.id}:chair_${idx}`;
    const j = computeOrganicTransform(seed, chairId, organic, undefined, true);
    const [rx, rz, chairFacing] = rotateChairOffset(lx, lz, relFacing, wB, dB, spec.facing);
    const wx = spec.at[0] + rx;
    const wz = spec.at[2] + rz;
    const origin16: Vec3 = [
      wx * SUBVOXEL_UNITS_PER_BLOCK + j.offset_x_16,
      spec.at[1] * SUBVOXEL_UNITS_PER_BLOCK,
      wz * SUBVOXEL_UNITS_PER_BLOCK + j.offset_z_16,
    ];
    const yaw =
      Math.abs(j.rotation_y_deg) < 4 && organic >= 0.5
        ? 12 * (idx % 2 === 0 ? 1 : -1)
        : j.rotation_y_deg;
    boxes.push(
      ...finalizeLocalBoxes(
        chairId,
        buildChairBoxes(mat, false),
        origin16,
        16,
        16,
        chairFacing,
        yaw,
        spec.zone_id,
      ),
    );
    hooks.push({
      kind: 'sit',
      id: `${chairId}:sit`,
      position: [wx + 0.5, spec.at[1], wz + 0.5],
      facing: chairFacing,
      seat_height_16: 8.5,
      prop_id: chairId,
    });
  });
  return { boxes, hooks };
};

const emitLitPropHooks = (
  spec: InteriorPropSpec,
  centerPos: Vec3,
  mat: StyleMaterials,
  hooks: PlayableInteriorHook[],
): void => {
  const isFire = spec.kind === 'fireplace';
  if (
    !isFire &&
    spec.kind !== 'terminal' &&
    spec.kind !== 'console_terminal' &&
    spec.kind !== 'holo_screen'
  ) {
    return;
  }
  hooks.push(
    {
      kind: 'toggle_light',
      id: `${spec.id}:light`,
      position: centerPos,
      color: isFire ? '#ff9e3d' : mat.emissiveColor,
      default_on: true,
      light_id: `${spec.id}:glow`,
    },
    {
      kind: 'audio_emitter',
      id: `${spec.id}:audio`,
      cue_kind: isFire ? 'fire_loop' : 'tech_hum',
      sound_id: isFire ? 'hearth_fire_loop' : 'console_tech_hum',
      position: centerPos,
      radius: isFire ? 7 : 5,
      gain_db: isFire ? -12 : -18,
    },
  );
};

const collectPropHooks = (
  spec: InteriorPropSpec,
  centerPos: Vec3,
  mat: StyleMaterials,
): readonly PlayableInteriorHook[] => {
  const hooks: PlayableInteriorHook[] = [];
  if (SEAT_KINDS.has(spec.kind) && spec.kind !== 'dining_set') {
    hooks.push({
      kind: 'sit',
      id: `${spec.id}:sit`,
      position: centerPos,
      facing: spec.facing,
      seat_height_16: propSurfaceHeight16(spec.kind),
      prop_id: spec.id,
    });
  }
  if (STATION_KINDS.has(spec.kind)) {
    hooks.push({
      kind: 'station',
      id: `${spec.id}:station`,
      position: centerPos,
      facing: spec.facing,
      station_kind: spec.kind,
    });
  }
  if (spec.kind === 'cabinet' || spec.kind === 'display_case') {
    hooks.push({
      kind: 'hinge',
      id: `hinge_${spec.id}`,
      position: centerPos,
      facing: spec.facing,
      pivot: centerPos,
      travel: 90,
      target_id: spec.id,
    });
  }
  emitLitPropHooks(spec, centerPos, mat, hooks);
  return hooks;
};

const buildCustomMounts = (
  spec: InteriorPropSpec,
  origin16: Vec3,
  w16: number,
  d16: number,
  rotDeg: number,
): readonly CustomPropMount[] => {
  if (!spec.asset_alias && spec.kind !== 'custom_prop') return [];
  return [
    {
      id: spec.id,
      asset_alias: spec.asset_alias ?? spec.id,
      at_16: [origin16[0] + w16 / 2, origin16[1], origin16[2] + d16 / 2],
      mount_on: spec.mount_on ?? 'floor',
      facing: spec.facing,
      rotation_y_deg: rotDeg,
      ...(spec.zone_id ? { zone_id: spec.zone_id } : {}),
    },
  ];
};

/** Compiles a single parametric 1/16 interior prop with organic micro-jitter and mounts. */
export const compileInteriorProp = (
  spec: InteriorPropSpec,
  styleDna: StyleDna,
  seed: number,
  joins: JoinEdges = NO_JOINS,
): PropCompileResult => {
  const arch = spec.style_override ?? styleDna.furn;
  const mat = materialsForStyle(arch);
  const organic = clamp01(spec.organic_jitter ?? styleDna.organic);
  const [wB, dB] = spec.size ?? [1, 1];
  const [w16, d16] = [wB * SUBVOXEL_UNITS_PER_BLOCK, dB * SUBVOXEL_UNITS_PER_BLOCK];
  const isMovableSeat =
    spec.kind === 'chair' || spec.kind === 'swivel_chair' || spec.kind === 'cushion';
  const tr = computeOrganicTransform(seed, spec.id, organic, spec.rotation_deg, isMovableSeat);
  const origin16: Vec3 = [
    spec.at[0] * SUBVOXEL_UNITS_PER_BLOCK + tr.offset_x_16,
    spec.at[1] * SUBVOXEL_UNITS_PER_BLOCK,
    spec.at[2] * SUBVOXEL_UNITS_PER_BLOCK + tr.offset_z_16,
  ];
  const drafts = draftsForSimpleKind(spec, w16, d16, mat, joins, arch, seed);
  const boxes = [
    ...finalizeLocalBoxes(
      spec.id,
      drafts,
      origin16,
      w16,
      d16,
      spec.facing,
      tr.rotation_y_deg,
      spec.zone_id,
    ),
    ...buildOrganicDetailBoxes(spec, origin16, w16, mat, organic, seed),
  ];
  const [fw, fd] = spec.facing === 'east' || spec.facing === 'west' ? [dB, wB] : [wB, dB];
  const hooks = [
    ...collectPropHooks(spec, [spec.at[0] + fw / 2, spec.at[1], spec.at[2] + fd / 2], mat),
  ];
  if (spec.kind === 'dining_set') {
    const chairs = buildDiningChairs(spec, styleDna, seed, organic);
    boxes.push(...chairs.boxes);
    hooks.push(...chairs.hooks);
  }
  return {
    boxes,
    custom_mounts: buildCustomMounts(spec, origin16, w16, d16, tr.rotation_y_deg),
    hooks,
    surface_y_16: origin16[1] + propSurfaceHeight16(spec.kind),
  };
};

/** Compiles an entire list of room props with automatic neighbor joining and surface lookup. */
export const compileInteriorProps = (
  specs: readonly InteriorPropSpec[],
  styleDna: StyleDna,
  seed: number,
): CompiledPropsBundle => {
  const boxes: SubVoxelBoxIR[] = [];
  const custom_mounts: CustomPropMount[] = [];
  const hooks: PlayableInteriorHook[] = [];
  const surface_y_map = new Map<string, number>();
  for (const spec of specs) {
    const joins = detectNeighbors(spec, specs);
    const res = compileInteriorProp(spec, styleDna, seed, joins);
    boxes.push(...res.boxes);
    custom_mounts.push(...res.custom_mounts);
    hooks.push(...res.hooks);
    surface_y_map.set(spec.id, res.surface_y_16);
  }
  return { boxes, custom_mounts, hooks, surface_y_map };
};
