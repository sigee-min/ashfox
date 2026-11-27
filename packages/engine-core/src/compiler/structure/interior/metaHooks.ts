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
  type PlayableInteriorHook,
  type PlayableInteriorMeta,
} from './contract';

const TANGENT_VEC: Readonly<Record<CardinalFacing, Vec3>> = {
  north: [1, 0, 0],
  south: [1, 0, 0],
  east: [0, 0, 1],
  west: [0, 0, 1],
};

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
