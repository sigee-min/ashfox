import type { AuditQualityGrade, AuditSubmetricShape } from '@ashfox/internal-contracts';
import type { Vec2, Vec3 } from '../../../model/identity';
import type {
  AcousticSpace,
  CardinalFacing,
  IntVec2,
  IntVec3,
} from '../../../project/structure/contract';

export const SUBVOXEL_UNITS_PER_BLOCK = 16 as const;
export const VANILLA_NBT_DATA_VERSION = 3955 as const;
export const MIN_VANILLA_HEADROOM_BLOCKS = 2 as const;

export const STYLE_DNA_ARCHES = [
  'rustic',
  'japanese',
  'modern',
  'scifi',
  'gothic',
  'desert',
  'industrial',
  'nordic',
] as const;
export type StyleDnaArch = (typeof STYLE_DNA_ARCHES)[number];
export const STYLE_DNA_MOODS = [
  'warm_hearth',
  'zen_daylight',
  'minimal_bright',
  'cyber_neon',
  'arcane_dusk',
  'sunbaked_ochre',
] as const;
export type StyleDnaMood = (typeof STYLE_DNA_MOODS)[number];

export interface StyleDna {
  readonly arch: StyleDnaArch;
  readonly furn: StyleDnaArch;
  readonly mood: StyleDnaMood;
  readonly organic: number;
}

export type BaseboardStyle = 'none' | 'trim' | 'stone_plinth' | 'led_strip';
export type WainscotStyle =
  'none' | 'paneled' | 'shoji_lattice' | 'tech_ribbed' | 'stone_dado' | 'brick_dado';
export type CeilingStyle = 'flat' | 'beamed' | 'coffered' | 'vault' | 'slatted' | 'open_truss';
export type FloorPatternStyle =
  'plank' | 'tatami' | 'grate' | 'tile' | 'stone_slab' | 'herringbone';
export type MoldingStyle =
  'none' | 'timber_cornice' | 'stone_cornice' | 'strip_light' | 'neon_channel';

/** 5-layer interior shell spec: floor_pattern, baseboard, wainscot, molding, ceiling. */
export interface InteriorArchitectureSpec {
  readonly floor_pattern: FloorPatternStyle;
  readonly baseboard: BaseboardStyle;
  readonly wainscot: WainscotStyle;
  readonly molding?: MoldingStyle;
  readonly ceiling: CeilingStyle;
  readonly trim_tile?: string;
  readonly accent_color?: string;
  readonly strip_light_color?: string;
}

export type VolumeAnchor =
  'north' | 'south' | 'east' | 'west' | 'nw' | 'ne' | 'sw' | 'se' | 'center';
export type RailingStyle = 'none' | 'timber' | 'iron' | 'glass' | 'shoji' | 'cable';
export type TrussStyle = 'a_frame' | 'king_post' | 'steel_web';
export type AlcoveKind =
  'fireplace' | 'altar' | 'display' | 'bunk' | 'cryo_pod' | 'shrine' | 'tokonoma';
export type PartitionStyle =
  'colonnade' | 'sliding_shoji' | 'fusuma' | 'glass_wall' | 'booth' | 'screen';

export interface PlatformVolumeSpec {
  readonly kind: 'platform' | 'sunken';
  readonly id: string;
  readonly on?: VolumeAnchor;
  readonly from?: IntVec2;
  readonly size: IntVec2;
  /** Signed height offset in 1/16 sub-voxels: +4..+8 for platform, -4..-8 for sunken. */
  readonly height_16: number;
  readonly step_facing?: CardinalFacing;
  readonly floor_pattern?: FloorPatternStyle;
  readonly trim_tile?: string;
  readonly railing?: RailingStyle;
}

export interface MezzanineVolumeSpec {
  readonly kind: 'mezzanine';
  readonly id: string;
  readonly on: CardinalFacing;
  readonly depth: number;
  readonly y_offset_b?: number;
  readonly railing: RailingStyle;
  readonly stair_at?: IntVec2;
  readonly support_pillars?: boolean;
}

export interface OpenTrussVolumeSpec {
  readonly kind: 'open_truss';
  readonly id: string;
  readonly style: TrussStyle;
  readonly axis: 'x' | 'z';
  readonly bay_spacing_b?: number;
  readonly ridge_height_16?: number;
  readonly chord_thickness_16?: number;
}

export interface AlcoveVolumeSpec {
  readonly kind: 'alcove';
  readonly id: string;
  readonly alcove_kind: AlcoveKind;
  readonly wall: CardinalFacing;
  readonly at_u: number;
  readonly width_b: number;
  readonly height_b: number;
  readonly depth_16?: number;
  readonly y_offset_16?: number;
}

export interface PartitionVolumeSpec {
  readonly kind: 'partition';
  readonly id: string;
  readonly style: PartitionStyle;
  readonly axis: 'x' | 'z';
  readonly at_pos: number;
  readonly span_from: number;
  readonly span_to: number;
  readonly doorway_at?: number;
  readonly doorway_width?: number;
  readonly open_ratio?: number;
}

export type InteriorVolumeSpec =
  | PlatformVolumeSpec
  | MezzanineVolumeSpec
  | OpenTrussVolumeSpec
  | AlcoveVolumeSpec
  | PartitionVolumeSpec;

export type InteriorPropKind =
  | 'table'
  | 'tables'
  | 'l_counter'
  | 'sofa'
  | 'sofas'
  | 'shelving'
  | 'terminal'
  | 'terminals'
  | 'console_terminal'
  | 'dining_set'
  | 'low_table'
  | 'cushion'
  | 'cushions'
  | 'chair'
  | 'swivel_chair'
  | 'fireplace'
  | 'barrel_rack'
  | 'display_case'
  | 'cabinet'
  | 'holo_screen'
  | 'counter'
  | 'wall_shelf'
  | 'custom_prop';
export type MountSurface = 'floor' | 'wall' | 'ceiling' | 'counter_top' | 'alcove';

export interface InteriorPropSpec {
  readonly id: string;
  readonly kind: InteriorPropKind;
  readonly zone_id?: string;
  readonly at: Vec3;
  readonly size?: IntVec2;
  readonly facing: CardinalFacing;
  readonly style_override?: StyleDnaArch;
  readonly seat_count?: number;
  readonly auto_join?: boolean;
  readonly rotation_deg?: number;
  readonly organic_jitter?: number;
  readonly mount_on?: MountSurface;
  readonly asset_alias?: string;
}

export type InteriorStoryKind =
  | 'tavern_meal'
  | 'tea_ceremony'
  | 'scholar_study'
  | 'modern_workspace'
  | 'scifi_diagnostics'
  | 'hearth_prep'
  | 'alchemy_brew';

export interface InteriorStorySpec {
  readonly id: string;
  readonly kind: InteriorStoryKind;
  readonly on_target: string;
  readonly surface_y_16: number;
  readonly center_xz_16: Vec2;
  readonly facing: CardinalFacing;
  readonly seed?: number;
}

export type InteriorDraperyKind =
  'curtains' | 'noren' | 'trailing_vine' | 'tapestry' | 'banner' | 'chains' | 'cables' | 'pipes';
export type InteriorDraperyTarget = 'windows' | 'doors' | 'ceiling_span' | 'wall' | 'shelf';

export interface InteriorDraperySpec {
  readonly id: string;
  readonly kind: InteriorDraperyKind;
  readonly on_target: InteriorDraperyTarget;
  readonly from_16: Vec3;
  readonly to_16: Vec3;
  readonly facing?: CardinalFacing;
  readonly sag_16: number;
  readonly pleats?: number;
  readonly tieback?: boolean;
  readonly split_panels?: number;
  readonly color?: string;
  readonly tile_id?: string;
}

export interface InteriorOpeningSpan {
  readonly id: string;
  readonly kind: 'door' | 'window' | 'arch' | 'bay_window' | 'arcade';
  readonly wall: CardinalFacing;
  readonly from: IntVec3;
  readonly to: IntVec3;
  readonly hinge?: 'left' | 'right';
  readonly stained_glass_color?: string;
}

export interface InteriorRoomInput {
  readonly room_id: string;
  readonly kind: string;
  readonly style_dna: StyleDna;
  readonly architecture: InteriorArchitectureSpec;
  readonly bounds_from: IntVec3;
  readonly bounds_to: IntVec3;
  readonly openings: readonly InteriorOpeningSpan[];
  readonly volumes: readonly InteriorVolumeSpec[];
  readonly props?: readonly InteriorPropSpec[];
  readonly stories?: readonly InteriorStorySpec[];
  readonly draperies?: readonly InteriorDraperySpec[];
  readonly seed: number;
}

export type InteriorRenderLayer = 'opaque' | 'cutout' | 'emissive' | 'translucent';

export interface SubVoxelBoxIR {
  readonly id: string;
  readonly from_16: Vec3;
  readonly to_16: Vec3;
  readonly tile_id: string;
  readonly layer: InteriorRenderLayer;
  readonly color_tint?: string;
  readonly rotation_y_deg?: number;
  readonly pivot_16?: Vec3;
  readonly skip_mask?: number;
  readonly contact_ao?: number;
  readonly semantic_tag?: string;
  readonly zone_id?: string;
}

export interface InteriorSubVoxelIR {
  readonly room_id: string;
  readonly units_per_block: typeof SUBVOXEL_UNITS_PER_BLOCK;
  readonly boxes: readonly SubVoxelBoxIR[];
  readonly clear_path_cells: readonly IntVec3[];
  readonly corbel_blocked_cells: readonly IntVec3[];
}

export interface VanillaNbtBlockCell {
  readonly pos: IntVec3;
  readonly state: string;
}

export interface VanillaNbtClearanceReport {
  readonly min_headroom_b: number;
  readonly floating_block_count: number;
  readonly blocked_opening_count: number;
  readonly passed: boolean;
}

export interface VanillaNbtLoweringIR {
  readonly data_version: typeof VANILLA_NBT_DATA_VERSION;
  readonly size: IntVec3;
  readonly palette: readonly string[];
  readonly blocks: readonly VanillaNbtBlockCell[];
  readonly clearance: VanillaNbtClearanceReport;
}

export interface InteriorRadiosityConfig {
  readonly bounces: 1 | 2;
  readonly mood: StyleDnaMood;
  readonly ambient_floor: number;
  readonly stained_glass_boost: number;
  readonly contact_ao_strength: number;
}

export interface InteriorRadiosityField {
  readonly size: IntVec3;
  readonly bounce_r: Uint8Array;
  readonly bounce_g: Uint8Array;
  readonly bounce_b: Uint8Array;
  readonly sun_patch_r: Uint8Array;
  readonly sun_patch_g: Uint8Array;
  readonly sun_patch_b: Uint8Array;
  readonly contact_ao: Uint8Array;
  readonly compute_ms: number;
}

export interface InteriorSunShaftConfig {
  readonly sun_dir: Vec3;
  readonly mood: StyleDnaMood;
  readonly intensity: number;
  readonly shaft_length_b: number;
}

export interface InteriorSunShaftQuad {
  readonly id: string;
  readonly opening_id: string;
  readonly corners: readonly [Vec3, Vec3, Vec3, Vec3];
  readonly color: string;
  readonly alpha_top: number;
  readonly alpha_bottom: number;
  readonly floor_patch_center: Vec3;
}

export type InteriorAudioCueKind =
  'fire_loop' | 'tech_hum' | 'clock_tick' | 'water_drip' | 'chime' | 'hearth_crackle';

export type PlayableInteriorHook =
  | Readonly<{
      kind: 'sit';
      id: string;
      position: Vec3;
      facing: CardinalFacing;
      seat_height_16: number;
      prop_id: string;
    }>
  | Readonly<{
      kind: 'hinge' | 'slide';
      id: string;
      position: Vec3;
      facing: CardinalFacing;
      pivot: Vec3;
      travel: number;
      target_id: string;
    }>
  | Readonly<{
      kind: 'toggle_light';
      id: string;
      position: Vec3;
      color: string;
      default_on: boolean;
      light_id: string;
    }>
  | Readonly<{
      kind: 'station';
      id: string;
      position: Vec3;
      facing: CardinalFacing;
      station_kind: InteriorPropKind | InteriorStoryKind;
    }>
  | Readonly<{
      kind: 'audio_emitter';
      id: string;
      cue_kind: InteriorAudioCueKind;
      sound_id: string;
      position: Vec3;
      radius: number;
      gain_db: number;
    }>;

export interface PlayableInteriorMeta {
  readonly schema_version: 1;
  readonly room_id: string;
  readonly acoustic_space: AcousticSpace;
  readonly hooks: readonly PlayableInteriorHook[];
  readonly clear_path_cells: readonly IntVec3[];
  readonly walkable_ratio: number;
}

export interface InteriorAuditMetrics {
  readonly volume_feature_count: number;
  readonly shell_layer_count: number;
  readonly bounce_color_contrast: number;
  readonly sun_shaft_count: number;
  readonly organic_calibration_delta: number;
  readonly clear_path_ratio: number;
  readonly min_headroom_b: number;
  readonly floating_block_count: number;
  readonly blocked_opening_count: number;
  readonly playable_hook_count: number;
}

export interface InteriorAuditGate {
  readonly id: string;
  readonly passed: boolean;
  readonly message: string;
  readonly fix: string;
}

export interface InteriorAuditReport {
  readonly schema_version: 1;
  readonly passed: boolean;
  readonly score: number;
  readonly grade: AuditQualityGrade;
  readonly hard_gates: readonly InteriorAuditGate[];
  readonly submetrics: readonly AuditSubmetricShape[];
  readonly metrics: InteriorAuditMetrics;
}

export class InteriorContractError extends Error {
  constructor(readonly detail: Readonly<{ pointer: string; expected: string; actual: string }>) {
    super(`${detail.pointer}: expected ${detail.expected}; got ${detail.actual}`);
    this.name = 'InteriorContractError';
  }
}

export const DEFAULT_ORGANIC_BY_ARCH: Readonly<Record<StyleDnaArch, number>> = {
  rustic: 0.75,
  japanese: 0.1,
  modern: 0.15,
  scifi: 0.2,
  gothic: 0.45,
  desert: 0.35,
  industrial: 0.4,
  nordic: 0.25,
};

export const DEFAULT_MOOD_BY_ARCH: Readonly<Record<StyleDnaArch, StyleDnaMood>> = {
  rustic: 'warm_hearth',
  japanese: 'zen_daylight',
  modern: 'minimal_bright',
  scifi: 'cyber_neon',
  gothic: 'arcane_dusk',
  desert: 'sunbaked_ochre',
  industrial: 'warm_hearth',
  nordic: 'minimal_bright',
};

const failContract = (pointer: string, expected: string, actual: unknown): never => {
  throw new InteriorContractError({ pointer, expected, actual: String(actual) });
};

export const isClosedEnum = <T extends string>(value: unknown, allowed: readonly T[]): value is T =>
  typeof value === 'string' && (allowed as readonly string[]).includes(value);

export const assertClosedKeys = (
  record: Readonly<Record<string, unknown>>,
  allowed: readonly string[],
  pointer: string,
): void => {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(record)) {
    if (!allowedSet.has(key))
      failContract(`${pointer}.${key}`, `one of [${allowed.join(', ')}]`, key);
  }
};

const readEnumField = <T extends string>(
  value: unknown,
  allowed: readonly T[],
  pointer: string,
): T => (isClosedEnum(value, allowed) ? value : failContract(pointer, allowed.join(' | '), value));

export const parseClosedStyleDna = (input: unknown, pointer = 'style_dna'): StyleDna => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return failContract(pointer, 'object', input);
  }
  const rec = input as Record<string, unknown>;
  assertClosedKeys(rec, ['arch', 'furn', 'mood', 'organic'], pointer);
  const arch = readEnumField(rec.arch, STYLE_DNA_ARCHES, `${pointer}.arch`);
  const furn = readEnumField(rec.furn ?? arch, STYLE_DNA_ARCHES, `${pointer}.furn`);
  const mood = readEnumField(
    rec.mood ?? DEFAULT_MOOD_BY_ARCH[arch],
    STYLE_DNA_MOODS,
    `${pointer}.mood`,
  );
  const organic = rec.organic ?? DEFAULT_ORGANIC_BY_ARCH[arch];
  if (typeof organic !== 'number' || !Number.isFinite(organic) || organic < 0 || organic > 1) {
    return failContract(`${pointer}.organic`, 'number in [0, 1]', organic);
  }
  return { arch, furn, mood, organic };
};
