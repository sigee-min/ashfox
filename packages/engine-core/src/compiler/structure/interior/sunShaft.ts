import { clamp01 } from '@ashfox/internal-contracts';
import type { Vec3 } from '../../../model/identity';
import type { AcousticSpace, CardinalFacing } from '../../../project/structure/contract';
import type { PlayableLight } from '../contract';
import {
  SUBVOXEL_UNITS_PER_BLOCK,
  type InteriorAudioCueKind,
  type InteriorOpeningSpan,
  type InteriorPropSpec,
  type InteriorRoomInput,
  type InteriorSubVoxelIR,
  type InteriorSunShaftConfig,
  type InteriorSunShaftQuad,
  type PlayableInteriorHook,
  type PlayableInteriorMeta,
  type StyleDnaMood,
  type SubVoxelBoxIR,
} from './contract';
import { parseHexRgb } from './radiosity';

type ShaftTuple = readonly [Vec3, number, number, string];
const SHAFT_MOODS: Readonly<Record<StyleDnaMood, ShaftTuple>> = {
  warm_hearth: [[0.35, -0.72, 0.6], 0.42, 5.5, '#ffd89b'],
  zen_daylight: [[0.3, -0.75, 0.58], 0.48, 6.0, '#fff4d6'],
  minimal_bright: [[0.32, -0.76, 0.56], 0.38, 5.5, '#ffffff'],
  cyber_neon: [[0.4, -0.68, 0.61], 0.28, 4.5, '#7ae8ff'],
  arcane_dusk: [[0.38, -0.65, 0.65], 0.35, 5.0, '#b59cff'],
  sunbaked_ochre: [[0.25, -0.78, 0.57], 0.55, 6.0, '#ffe094'],
};

const INWARD_VEC: Readonly<Record<CardinalFacing, Vec3>> = {
  north: [0, 0, 1],
  south: [0, 0, -1],
  east: [-1, 0, 0],
  west: [1, 0, 0],
};
const TANGENT_VEC: Readonly<Record<CardinalFacing, Vec3>> = {
  north: [1, 0, 0],
  south: [1, 0, 0],
  east: [0, 0, 1],
  west: [0, 0, 1],
};

export interface TranslucentWindowPane {
  readonly id: string;
  readonly opening_id: string;
  readonly double_sided: true;
  readonly alpha: number;
  readonly color: string;
  readonly box: SubVoxelBoxIR;
}

export interface SunShaftMeshBatch {
  readonly positions: readonly number[];
  readonly normals: readonly number[];
  readonly uvs: readonly number[];
  readonly colors: readonly number[];
  readonly indices: readonly number[];
  readonly doubleSided: true;
  readonly alphaMode: 'BLEND';
}

const normalize = (v: Vec3): Vec3 => {
  const len = Math.hypot(v[0], v[1], v[2]);
  return len > 1e-6 ? [v[0] / len, v[1] / len, v[2] / len] : [0, -1, 0];
};

const addScaled = (a: Vec3, b: Vec3, s: number): Vec3 => [
  a[0] + b[0] * s,
  a[1] + b[1] * s,
  a[2] + b[2] * s,
];
const isLitOpening = (op: InteriorOpeningSpan): boolean =>
  op.kind === 'window' || op.kind === 'bay_window' || op.kind === 'arch' || op.kind === 'arcade';

const defaultSunForRoom = (room: InteriorRoomInput, cfg: InteriorSunShaftConfig): Vec3 => {
  const win = room.openings.find(isLitOpening);
  if (!win) return normalize(cfg.sun_dir);
  const inward = INWARD_VEC[win.wall];
  return normalize([inward[0] * 0.65 + 0.12, -0.72, inward[2] * 0.65 + 0.12]);
};

/** Builds a closed InteriorSunShaftConfig calibrated to style mood. */
export const defaultSunShaftConfig = (
  mood: StyleDnaMood,
  overrides?: Partial<InteriorSunShaftConfig>,
): InteriorSunShaftConfig => {
  const p = SHAFT_MOODS[mood];
  return { sun_dir: p[0], mood, intensity: p[1], shaft_length_b: p[2], ...overrides };
};

const buildShaftSliceQuad = (
  room: InteriorRoomInput,
  op: InteriorOpeningSpan,
  rayDir: Vec3,
  cfg: InteriorSunShaftConfig,
  sliceIdx: number,
): InteriorSunShaftQuad => {
  const inward = INWARD_VEC[op.wall];
  const tangent = TANGENT_VEC[op.wall];
  const cx = (op.from[0] + op.to[0] + 1) * 0.5;
  const cy = (op.from[1] + op.to[1] + 1) * 0.5;
  const cz = (op.from[2] + op.to[2] + 1) * 0.5;
  const span =
    op.wall === 'north' || op.wall === 'south'
      ? op.to[0] - op.from[0] + 1
      : op.to[2] - op.from[2] + 1;
  const halfW = Math.max(0.35, span * 0.42);
  const originCenter: Vec3 = [
    cx + inward[0] * 0.35,
    cy + (sliceIdx === 1 ? 0.25 : 0),
    cz + inward[2] * 0.35,
  ];
  const floorY = room.bounds_from[1] + 1.02;
  const distToFloor =
    rayDir[1] < -0.05 ? (floorY - originCenter[1]) / rayDir[1] : cfg.shaft_length_b;
  const endCenter = addScaled(
    originCenter,
    rayDir,
    Math.max(1.2, Math.min(cfg.shaft_length_b, distToFloor)),
  );
  const axis: Vec3 =
    sliceIdx === 0 ? tangent : normalize([tangent[0] * 0.65, 0.72, tangent[2] * 0.65]);
  const spread = halfW * 1.28;
  return {
    id: `${room.room_id}_shaft_${op.id}_${sliceIdx}`,
    opening_id: op.id,
    corners: [
      addScaled(originCenter, axis, -halfW),
      addScaled(originCenter, axis, halfW),
      addScaled(endCenter, axis, spread),
      addScaled(endCenter, axis, -spread),
    ],
    color: op.stained_glass_color ?? SHAFT_MOODS[cfg.mood][3],
    alpha_top: clamp01(cfg.intensity * (sliceIdx === 0 ? 0.55 : 0.38)),
    alpha_bottom: 0.02,
    floor_patch_center: [endCenter[0], floorY, endCenter[2]],
  };
};

/** Generates volumetric translucent sun_shaft god-ray quads aligned to sunlit openings + sun angle. */
export const generateInteriorSunShafts = (
  room: InteriorRoomInput,
  config?: Partial<InteriorSunShaftConfig>,
): readonly InteriorSunShaftQuad[] => {
  const cfg = defaultSunShaftConfig(room.style_dna.mood, config);
  const effectiveSun = config?.sun_dir ? normalize(config.sun_dir) : defaultSunForRoom(room, cfg);
  const quads: InteriorSunShaftQuad[] = [];
  for (const opening of room.openings) {
    if (!isLitOpening(opening)) continue;
    const inward = INWARD_VEC[opening.wall];
    if (
      effectiveSun[0] * inward[0] + effectiveSun[1] * inward[1] + effectiveSun[2] * inward[2] <=
      0.05
    )
      continue;
    quads.push(
      buildShaftSliceQuad(room, opening, effectiveSun, cfg, 0),
      buildShaftSliceQuad(room, opening, effectiveSun, cfg, 1),
    );
  }
  return quads;
};

/** Builds double-sided additive/translucent mesh buffers for sun_shaft god-ray quads. */
export const buildSunShaftMeshPrimitives = (
  shafts: readonly InteriorSunShaftQuad[],
): SunShaftMeshBatch => {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const uvCoords = [0, 0, 1, 0, 1, 1, 0, 1];
  for (const q of shafts) {
    const base = positions.length / 3;
    const rgb = parseHexRgb(q.color) ?? [1, 0.94, 0.78];
    const [p0, p1, , p3] = q.corners;
    const [e1x, e1y, e1z] = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
    const [e2x, e2y, e2z] = [p3[0] - p0[0], p3[1] - p0[1], p3[2] - p0[2]];
    const n = normalize([e1y * e2z - e1z * e2y, e1z * e2x - e1x * e2z, e1x * e2y - e1y * e2x]);
    for (let i = 0; i < 4; i += 1) {
      const c = q.corners[i]!;
      positions.push(c[0], c[1], c[2]);
      normals.push(n[0], n[1], n[2]);
      uvs.push(uvCoords[i * 2]!, uvCoords[i * 2 + 1]!);
      colors.push(rgb[0], rgb[1], rgb[2], i < 2 ? q.alpha_top : q.alpha_bottom);
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return { positions, normals, uvs, colors, indices, doubleSided: true, alphaMode: 'BLEND' };
};

const buildPaneForOpening = (roomId: string, op: InteriorOpeningSpan): TranslucentWindowPane => {
  const u = SUBVOXEL_UNITS_PER_BLOCK;
  const alongX = op.wall === 'north' || op.wall === 'south';
  const [x0, y0, z0, x1, y1, z1] = [
    op.from[0] * u,
    op.from[1] * u,
    op.from[2] * u,
    (op.to[0] + 1) * u,
    (op.to[1] + 1) * u,
    (op.to[2] + 1) * u,
  ];
  const from16: Vec3 = [alongX ? x0 + 1 : x0 + 7, y0 + 1, alongX ? z0 + 7 : z0 + 1];
  const to16: Vec3 = [alongX ? x1 - 1 : x0 + 9, y1 - 1, alongX ? z0 + 9 : z1 - 1];
  const color = op.stained_glass_color ?? '#9ad6eb';
  return {
    id: `${roomId}_pane_${op.id}`,
    opening_id: op.id,
    double_sided: true,
    alpha: op.stained_glass_color ? 0.48 : 0.28,
    color,
    box: {
      id: `${roomId}_pane_${op.id}_box`,
      from_16: from16,
      to_16: to16,
      tile_id: op.stained_glass_color ? 'stained_glass' : 'glass',
      layer: 'translucent',
      color_tint: color,
      semantic_tag: 'window_pane_double_sided',
    },
  };
};

/** Generates translucent double-sided window panes in 1/16 sub-voxel IR for window openings. */
export const generateTranslucentWindowPanes = (
  room: InteriorRoomInput,
): readonly TranslucentWindowPane[] =>
  room.openings
    .filter((op) => op.kind === 'window' || op.kind === 'bay_window')
    .map((op) => buildPaneForOpening(room.room_id, op));

const TIMBER_ARCHS = new Set(['japanese', 'rustic', 'nordic']);
const resolveAcousticSpace = (room: InteriorRoomInput): AcousticSpace => {
  if (room.kind === 'courtyard') return 'outdoor';
  const area =
    (room.bounds_to[0] - room.bounds_from[0] + 1) * (room.bounds_to[2] - room.bounds_from[2] + 1);
  if (room.style_dna.arch === 'gothic' || room.kind === 'tower') return 'stone_hall';
  if (TIMBER_ARCHS.has(room.style_dna.arch)) return area <= 20 ? 'small_chamber' : 'timber_room';
  return area <= 24 ? 'small_chamber' : 'stone_hall';
};

const SEAT_KINDS = new Set('chair,swivel_chair,cushion,cushions,sofa,sofas,dining_set'.split(','));
const STATION_KINDS = new Set(
  'terminal,terminals,console_terminal,fireplace,counter,l_counter,holo_screen,table,low_table,barrel_rack'.split(
    ',',
  ),
);
const SLIDE_PARTITIONS = new Set('sliding_shoji,fusuma,glass_wall'.split(','));
const TECH_KINDS = new Set('terminal,terminals,console_terminal,holo_screen'.split(','));

const emitSitHooks = (prop: InteriorPropSpec, hooks: PlayableInteriorHook[]): void => {
  if (!SEAT_KINDS.has(prop.kind)) return;
  const count =
    prop.seat_count ??
    (prop.kind === 'dining_set' ? 4 : prop.kind === 'sofa' || prop.kind === 'sofas' ? 2 : 1);
  const seatY =
    prop.kind === 'cushion' || prop.kind === 'cushions' ? 4 : prop.kind === 'swivel_chair' ? 9 : 8;
  const tangent = TANGENT_VEC[prop.facing];
  for (let i = 0; i < count; i += 1) {
    const off = count === 1 ? 0 : (i - (count - 1) * 0.5) * 0.85;
    const position: Vec3 = [
      prop.at[0] + tangent[0] * off,
      prop.at[1],
      prop.at[2] + tangent[2] * off,
    ];
    hooks.push({
      kind: 'sit',
      id: `sit_${prop.id}_${i}`,
      position,
      facing: prop.facing,
      seat_height_16: seatY,
      prop_id: prop.id,
    });
  }
};

const doorPivotFor = (op: InteriorOpeningSpan): Vec3 => {
  const left = op.hinge !== 'right';
  if (op.wall === 'north' || op.wall === 'south')
    return [left ? op.from[0] : op.to[0] + 1, op.from[1], (op.from[2] + op.to[2] + 1) * 0.5];
  return [(op.from[0] + op.to[0] + 1) * 0.5, op.from[1], left ? op.from[2] : op.to[2] + 1];
};

const emitDoorHooks = (room: InteriorRoomInput, hooks: PlayableInteriorHook[]): void => {
  const kind =
    room.style_dna.arch === 'japanese' || room.style_dna.arch === 'scifi' ? 'slide' : 'hinge';
  for (const op of room.openings) {
    if (op.kind !== 'door') continue;
    const position: Vec3 = [
      (op.from[0] + op.to[0] + 1) * 0.5,
      op.from[1],
      (op.from[2] + op.to[2] + 1) * 0.5,
    ];
    hooks.push({
      kind,
      id: `${kind}_${op.id}`,
      position,
      facing: op.wall,
      pivot: doorPivotFor(op),
      travel: kind === 'slide' ? 1 : 90,
      target_id: op.id,
    });
  }
};

const emitPartitionHooks = (room: InteriorRoomInput, hooks: PlayableInteriorHook[]): void => {
  for (const vol of room.volumes) {
    if (vol.kind !== 'partition' || !SLIDE_PARTITIONS.has(vol.style)) continue;
    const mid = vol.doorway_at ?? (vol.span_from + vol.span_to) * 0.5;
    const pos: Vec3 =
      vol.axis === 'x'
        ? [mid, room.bounds_from[1] + 1, vol.at_pos]
        : [vol.at_pos, room.bounds_from[1] + 1, mid];
    hooks.push({
      kind: 'slide',
      id: `slide_${vol.id}`,
      position: pos,
      facing: vol.axis === 'x' ? 'north' : 'west',
      pivot: pos,
      travel: vol.doorway_width ?? 1.5,
      target_id: vol.id,
    });
  }
};

const emitPropAndStoryHooks = (room: InteriorRoomInput, hooks: PlayableInteriorHook[]): void => {
  for (const prop of room.props ?? []) {
    emitSitHooks(prop, hooks);
    if (STATION_KINDS.has(prop.kind))
      hooks.push({
        kind: 'station',
        id: `station_${prop.id}`,
        position: prop.at,
        facing: prop.facing,
        station_kind: prop.kind,
      });
    if (prop.kind === 'cabinet' || prop.kind === 'display_case')
      hooks.push({
        kind: 'hinge',
        id: `hinge_${prop.id}`,
        position: prop.at,
        facing: prop.facing,
        pivot: prop.at,
        travel: 90,
        target_id: prop.id,
      });
  }
  const u = SUBVOXEL_UNITS_PER_BLOCK;
  for (const s of room.stories ?? []) {
    hooks.push({
      kind: 'station',
      id: `station_${s.id}`,
      position: [s.center_xz_16[0] / u, s.surface_y_16 / u, s.center_xz_16[1] / u],
      facing: s.facing,
      station_kind: s.kind,
    });
  }
};

const emitLightToggleHooks = (
  ir: InteriorSubVoxelIR,
  lights: readonly PlayableLight[],
  hooks: PlayableInteriorHook[],
): void => {
  const seen = new Set(hooks.filter((h) => h.kind === 'toggle_light').map((h) => h.light_id));
  for (const light of lights) {
    if (seen.has(light.id)) continue;
    seen.add(light.id);
    hooks.push({
      kind: 'toggle_light',
      id: `toggle_${light.id}`,
      position: light.position,
      color: light.color,
      default_on: true,
      light_id: light.id,
    });
  }
  if (lights.length > 0) return;
  const u = SUBVOXEL_UNITS_PER_BLOCK;
  for (const box of ir.boxes) {
    if (box.layer !== 'emissive' || seen.has(box.id)) continue;
    seen.add(box.id);
    const pos: Vec3 = [
      (box.from_16[0] + box.to_16[0]) / (2 * u),
      (box.from_16[1] + box.to_16[1]) / (2 * u),
      (box.from_16[2] + box.to_16[2]) / (2 * u),
    ];
    hooks.push({
      kind: 'toggle_light',
      id: `toggle_${box.id}`,
      position: pos,
      color: box.color_tint ?? '#ffd080',
      default_on: true,
      light_id: box.id,
    });
  }
};

const pushAudio = (
  hooks: PlayableInteriorHook[],
  id: string,
  pos: Vec3,
  [cue_kind, radius, gain_db]: readonly [InteriorAudioCueKind, number, number],
): void => {
  hooks.push({
    kind: 'audio_emitter',
    id: `audio_${id}`,
    cue_kind,
    sound_id: `ambient/${cue_kind}`,
    position: pos,
    radius,
    gain_db,
  });
};

const AUDIO_SPEC: Readonly<Record<string, readonly [InteriorAudioCueKind, number, number]>> = {
  tea_ceremony: ['chime', 7, -13],
  scholar_study: ['clock_tick', 6, -15],
  modern_workspace: ['clock_tick', 6, -15],
  alchemy_brew: ['water_drip', 6, -14],
  fireplace: ['hearth_crackle', 8, -8],
  tokonoma: ['chime', 8, -12],
  shrine: ['chime', 8, -12],
  cryo_pod: ['tech_hum', 6, -11],
};

const emitPropAudioHooks = (room: InteriorRoomInput, hooks: PlayableInteriorHook[]): void => {
  for (const prop of room.props ?? []) {
    if (prop.kind === 'fireplace') pushAudio(hooks, prop.id, prop.at, ['fire_loop', 9, -6]);
    else if (TECH_KINDS.has(prop.kind)) pushAudio(hooks, prop.id, prop.at, ['tech_hum', 7, -10]);
  }
};

const emitAudioHooks = (
  room: InteriorRoomInput,
  hooks: PlayableInteriorHook[],
  includeProps: boolean,
): void => {
  if (includeProps) emitPropAudioHooks(room, hooks);
  const center: Vec3 = [
    (room.bounds_from[0] + room.bounds_to[0] + 1) * 0.5,
    room.bounds_from[1] + 1,
    (room.bounds_from[2] + room.bounds_to[2] + 1) * 0.5,
  ];
  for (const vol of room.volumes) {
    const spec = vol.kind === 'alcove' ? AUDIO_SPEC[vol.alcove_kind] : undefined;
    if (spec) pushAudio(hooks, vol.id, center, spec);
  }
  const u = SUBVOXEL_UNITS_PER_BLOCK;
  for (const s of room.stories ?? []) {
    const sp = AUDIO_SPEC[s.kind];
    if (sp)
      pushAudio(
        hooks,
        s.id,
        [s.center_xz_16[0] / u, s.surface_y_16 / u, s.center_xz_16[1] / u],
        sp,
      );
  }
};

/** Emits playable_meta interior interaction hooks (sit, hinge/slide, toggle_light, station, spatial audio). */
export const emitPlayableInteriorMeta = (
  room: InteriorRoomInput,
  ir: InteriorSubVoxelIR,
  lights: readonly PlayableLight[] = [],
  resolvedHooks?: readonly PlayableInteriorHook[],
): PlayableInteriorMeta => {
  const hooks: PlayableInteriorHook[] = [];
  emitDoorHooks(room, hooks);
  emitPartitionHooks(room, hooks);
  if (resolvedHooks) hooks.push(...resolvedHooks);
  else emitPropAndStoryHooks(room, hooks);
  emitLightToggleHooks(ir, lights, hooks);
  emitAudioHooks(room, hooks, !resolvedHooks);
  const qualified = hooks.map((h) =>
    h.kind === 'toggle_light' ? { ...h, light_id: `${room.room_id}:${h.light_id}` } : h,
  );
  const w = Math.max(1, room.bounds_to[0] - room.bounds_from[0] + 1);
  const d = Math.max(1, room.bounds_to[2] - room.bounds_from[2] + 1);
  const uniqueXz = new Set(ir.clear_path_cells.map((c) => `${c[0]},${c[2]}`));
  return {
    schema_version: 1,
    room_id: room.room_id,
    acoustic_space: resolveAcousticSpace(room),
    hooks: qualified,
    clear_path_cells: ir.clear_path_cells,
    walkable_ratio: clamp01(uniqueXz.size / Math.max(1, w * d)),
  };
};
