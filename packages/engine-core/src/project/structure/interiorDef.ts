type CardinalFacing = 'north' | 'south' | 'east' | 'west';
type IntVec2 = readonly [number, number];

export type InteriorArchKind =
  'rustic' | 'japanese' | 'modern' | 'scifi' | 'gothic' | 'desert' | 'industrial' | 'nordic';

export type InteriorMoodKind =
  | 'warm_hearth'
  | 'zen_daylight'
  | 'minimal_bright'
  | 'cyber_neon'
  | 'arcane_dusk'
  | 'sunbaked_ochre';

export type InteriorAnchor =
  'north' | 'south' | 'east' | 'west' | 'nw' | 'ne' | 'sw' | 'se' | 'center';

export interface InteriorDnaAst {
  readonly arch: InteriorArchKind;
  readonly furn?: InteriorArchKind;
  readonly mood?: InteriorMoodKind;
  readonly organic?: number;
}

export interface InteriorArchAst {
  readonly floor_pattern?: string;
  readonly baseboard?: string;
  readonly wainscot?: string;
  readonly molding?: string;
  readonly ceiling?: string;
  readonly trim_tile?: string;
  readonly accent_color?: string;
  readonly strip_light_color?: string;
}

export type InteriorVolumeAst =
  | Readonly<{
      kind: 'platform' | 'sunken';
      id: string;
      on?: InteriorAnchor;
      from?: IntVec2;
      size?: IntVec2;
      height_16: number;
      step_facing?: CardinalFacing;
      floor_pattern?: string;
      trim_tile?: string;
      railing?: string;
      nested: readonly InteriorSubItemAst[];
    }>
  | Readonly<{
      kind: 'mezzanine';
      id: string;
      on: CardinalFacing;
      depth: number;
      y_offset_b?: number;
      railing: string;
      stair_at?: IntVec2;
      support_pillars?: boolean;
      nested: readonly InteriorSubItemAst[];
    }>
  | Readonly<{
      kind: 'open_truss';
      id: string;
      style: string;
      axis: 'x' | 'z';
      bay_spacing_b?: number;
      ridge_height_16?: number;
      chord_thickness_16?: number;
    }>
  | Readonly<{
      kind: 'alcove';
      id: string;
      alcove_kind: string;
      wall?: CardinalFacing;
      at_u?: number;
      width_b?: number;
      height_b?: number;
      depth_16?: number;
      y_offset_16?: number;
    }>
  | Readonly<{
      kind: 'partition';
      id: string;
      style: string;
      axis: 'x' | 'z';
      at_pos: number;
      span_from?: number;
      span_to?: number;
      doorway_at?: number;
      doorway_width?: number;
      open_ratio?: number;
    }>;

export interface InteriorPropAst {
  readonly id: string;
  readonly kind: string;
  readonly at?: readonly [number, number, number];
  readonly size?: IntVec2;
  readonly length?: number;
  readonly facing?: CardinalFacing;
  readonly style_override?: InteriorArchKind;
  readonly seat_count?: number;
  readonly auto_join?: boolean;
  readonly rotation_deg?: number;
  readonly organic_jitter?: number;
  readonly mount_on?: string;
  readonly asset_alias?: string;
  readonly variant?: string;
  readonly drop?: number;
  readonly color?: string;
  readonly on?: InteriorAnchor;
}

export interface InteriorDraperyAst {
  readonly id: string;
  readonly kind: string;
  readonly on_target: string;
  readonly from_16?: readonly [number, number, number];
  readonly to_16?: readonly [number, number, number];
  readonly facing?: CardinalFacing;
  readonly sag_16?: number;
  readonly pleats?: number;
  readonly tieback?: boolean;
  readonly split_panels?: number;
  readonly color?: string;
  readonly tile_id?: string;
}

export interface InteriorStoryAst {
  readonly id: string;
  readonly kind: string;
  readonly on_target?: string;
  readonly facing?: CardinalFacing;
  readonly seed?: number;
}

export interface InteriorLightingAst {
  readonly kind?: string;
  readonly along?: string;
  readonly color?: string;
  readonly bounces?: 1 | 2;
  readonly ambient_floor?: number;
  readonly stained_glass_boost?: number;
  readonly contact_ao_strength?: number;
}

export interface InteriorSunShaftAst {
  readonly enabled?: boolean;
  readonly sun_dir?: readonly [number, number, number];
  readonly intensity?: number;
  readonly shaft_length_b?: number;
}

export type InteriorSubItemAst =
  | Readonly<{ item: 'alcove'; spec: Extract<InteriorVolumeAst, { kind: 'alcove' }> }>
  | Readonly<{ item: 'prop'; spec: InteriorPropAst }>
  | Readonly<{ item: 'story'; spec: InteriorStoryAst }>;

export interface InteriorGroupAst {
  readonly kind: 'wall_line' | 'centerpiece' | 'corner';
  readonly id: string;
  readonly on: readonly InteriorAnchor[];
  readonly items: readonly InteriorSubItemAst[];
}

export interface InteriorRoomOp {
  readonly op: 'interior';
  readonly room?: string;
  readonly dna?: InteriorDnaAst;
  readonly architecture?: InteriorArchAst;
  readonly volumes: readonly InteriorVolumeAst[];
  readonly groups: readonly InteriorGroupAst[];
  readonly props: readonly InteriorPropAst[];
  readonly draperies: readonly InteriorDraperyAst[];
  readonly stories: readonly InteriorStoryAst[];
  readonly lighting?: InteriorLightingAst;
  readonly sunShaft?: InteriorSunShaftAst;
}
