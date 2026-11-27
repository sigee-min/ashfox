import type { ProgramToken } from '../program/syntax/lex';
import type { RawDeclaredOutput, RawDeclaredPreview } from '../directory/declarations';
import type { InteriorRoomOp } from './interiorDef';

export const MAX_STRUCTURE_DIM = 96;
export const MAX_STRUCTURE_VOLUME = 131_072;
export const MAX_STRUCTURE_OPS = 16_384;
export const DEFAULT_DATA_VERSION = 3955;

export type CardinalFacing = 'north' | 'south' | 'east' | 'west';
export type BlockRotation = 0 | 90 | 180 | 270;
export type MirrorAxis = 'x' | 'z';
export type RepeatAxis = 'x' | 'y' | 'z';
export type RoofStyle = 'gable' | 'hip' | 'pyramid' | 'spire';
export type RoofPitch = 'shallow' | 'standard' | 'steep';
export type StairStyle = 'straight' | 'l_turn' | 'u_turn' | 'spiral';
export type AcousticSpace = 'stone_hall' | 'timber_room' | 'small_chamber' | 'outdoor';
export type StructureDensity = 1 | 2;
export const DEFAULT_STRUCTURE_DENSITY: StructureDensity = 2;

export type IntVec3 = readonly [number, number, number];
export type IntVec2 = readonly [number, number];
export type StructureScalarExpr = number | string;
export type ExprVec2 = readonly [StructureScalarExpr, StructureScalarExpr];
export type ExprVec3 = readonly [StructureScalarExpr, StructureScalarExpr, StructureScalarExpr];
export type StructureParamValue = number | boolean | string;

export interface StructureImport {
  readonly path: string;
  readonly alias: string;
}

export type StructurePaletteEntry =
  | Readonly<{ kind: 'block'; state: string }>
  | Readonly<{ kind: 'asset'; alias: string; fallback: string }>
  | Readonly<{
      kind: 'mix';
      entries: readonly Readonly<{ readonly state: string; readonly weight: number }>[];
    }>;

export interface PorchSpec {
  readonly depth: number;
  readonly floor: string;
  readonly pillars?: string;
  readonly lamps?: string;
  readonly steps?: string;
}

export type OpeningPlacement =
  | Readonly<{ mode: 'at'; at: 'center' | number; offset?: number }>
  | Readonly<{ mode: 'repeat'; count: number; margin: number }>
  | Readonly<{ mode: 'symmetric'; offset: number }>;

export interface FacadeOpeningSpec {
  readonly kind: 'door' | 'window' | 'arch' | 'bay_window' | 'arcade';
  readonly placement: OpeningPlacement;
  readonly width: number;
  readonly height: number;
  readonly yOffset?: number;
  readonly block?: string;
  readonly glass?: string;
  readonly frame?: string;
  readonly recess?: number;
  readonly sill?: string;
  readonly shutter?: string;
  readonly lintel?: string;
  readonly stainedGlassColor?: string;
  readonly hinge?: 'left' | 'right';
  readonly porch?: PorchSpec;
}

export interface RoofChimneySpec {
  readonly room?: string;
  readonly corner: 'nw' | 'ne' | 'sw' | 'se' | 'center';
  readonly offset: IntVec2;
  readonly width: number;
  readonly rise: number;
  readonly block: string;
  readonly cap?: boolean;
}

export interface RoofDormerSpec {
  readonly wall: CardinalFacing;
  readonly offset: number;
  readonly width: number;
  readonly height: number;
  readonly windowBlock?: string;
}

export type FurnishItem =
  | Readonly<{
      kind: 'place_anchor';
      prefab: string;
      on: CardinalFacing | 'nw' | 'ne' | 'sw' | 'se' | 'center';
      offset?: IntVec2;
      rotate?: BlockRotation;
    }>
  | Readonly<{
      kind: 'hang';
      block: string;
      at: 'ceiling_center' | CardinalFacing;
      drop: number;
    }>;

export type WeatheringRule =
  | Readonly<{ kind: 'ground_moss'; height: number; target: string; into: string; rate: number }>
  | Readonly<{ kind: 'corner_quoin'; target: string; corners: string }>
  | Readonly<{ kind: 'chimney_soot'; radius: number; rate: number }>
  | Readonly<{ kind: 'eave_shadow'; target: string; into: string; rate: number }>
  | Readonly<{
      kind: 'rust_streak';
      target?: string;
      into?: string;
      rate: number;
      length: number;
    }>
  | Readonly<{
      kind: 'wall_breach';
      target?: string;
      rubble?: string;
      rate: number;
      maxWidth: number;
      height: number;
    }>
  | Readonly<{ kind: 'shattered_glass'; target?: string; shard?: string; rate: number }>
  | Readonly<{
      kind: 'vine_overgrowth';
      target?: string;
      into?: string;
      rate: number;
      height: number;
    }>;

export type StructureOp =
  | Readonly<{
      op: 'set';
      at: ExprVec3;
      block: string;
      facing?: CardinalFacing;
    }>
  | Readonly<{
      op: 'box' | 'hollow' | 'walls' | 'frame';
      from: ExprVec3;
      to: ExprVec3;
      block: string;
    }>
  | Readonly<{
      op: 'carve';
      from: ExprVec3;
      to: ExprVec3;
    }>
  | Readonly<{
      op: 'roof';
      on?: string;
      style: RoofStyle;
      axis: MirrorAxis;
      from?: ExprVec3;
      to?: ExprVec3;
      overhang?: number;
      pitch?: RoofPitch;
      stair: string;
      trim?: string;
      ridge: string;
      gable?: string;
      underEave?: boolean;
      readonly battlement?: boolean;
      dormers?: readonly RoofDormerSpec[];
      chimneys?: readonly RoofChimneySpec[];
    }>
  | Readonly<{
      op: 'layer';
      y: StructureScalarExpr;
      origin: ExprVec2;
      rows: readonly string[];
      map: Readonly<Record<string, string>>;
    }>
  | Readonly<{
      op: 'repeat';
      axis: RepeatAxis;
      count: number;
      step: number;
      ops: readonly StructureOp[];
    }>
  | Readonly<{
      op: 'mirror';
      axis: MirrorAxis;
      center: number;
      ops: readonly StructureOp[];
    }>
  | Readonly<{
      op: 'place';
      prefab: string;
      at: ExprVec3;
      rotate: BlockRotation;
    }>
  | Readonly<{
      op: 'floor';
      name: string;
      y: StructureScalarExpr;
      height: StructureScalarExpr;
      jetty?: Readonly<Partial<Record<CardinalFacing, number>>>;
      ops: readonly StructureOp[];
    }>
  | Readonly<{
      op: 'room';
      name: string;
      from: ExprVec2;
      size: ExprVec2;
      kind: string;
      schema?: string;
      shape?: 'rect' | 'octagon';
      plinth?: string;
      floor?: string;
      wall?: string;
      frame?: string;
      ceiling?: string;
      interior?: InteriorRoomOp;
    }>
  | InteriorRoomOp
  | Readonly<{
      op: 'facade';
      targets: readonly Readonly<{ readonly room: string; readonly wall: CardinalFacing }>[];
      openings: readonly FacadeOpeningSpec[];
    }>
  | Readonly<{
      op: 'staircase';
      inRoom?: string;
      style: StairStyle;
      at: ExprVec2;
      yFrom?: StructureScalarExpr;
      yTo?: StructureScalarExpr;
      facing: CardinalFacing;
      width?: number;
      stair: string;
      landing?: string;
      rail?: string;
      headroom?: number;
    }>
  | Readonly<{
      op: 'furnish';
      room: string;
      items: readonly FurnishItem[];
    }>
  | Readonly<{
      op: 'weathering';
      rules: readonly WeatheringRule[];
    }>
  | Readonly<{
      op: 'anchor';
      name: string;
      schema: string;
      at?: ExprVec3;
      room?: string;
      wall?: CardinalFacing;
      facing?: CardinalFacing;
      pool?: string;
      target?: string;
    }>
  | Readonly<{
      op: 'hook_decl';
    }>
  | Readonly<{
      op: 'compound_place';
      alias: string;
      at: ExprVec3;
      rotate: BlockRotation;
    }>;

export interface StructurePrefab {
  readonly id: string;
  readonly exported: boolean;
  readonly ops: readonly StructureOp[];
}

export interface StructureSourceUnit {
  readonly kind: 'structure' | 'module';
  readonly id: string;
  readonly imports: readonly StructureImport[];
  readonly hookAliases?: readonly string[];
  readonly outputs: readonly RawDeclaredOutput[];
  readonly previews: readonly RawDeclaredPreview[];
  readonly params: Readonly<Record<string, StructureParamValue>>;
  readonly density: StructureDensity;
  readonly seed: number;
  readonly size: IntVec3 | null;
  readonly dataVersion: number;
  readonly palette: Readonly<Record<string, StructurePaletteEntry>>;
  readonly prefabs: readonly StructurePrefab[];
  readonly ops: readonly StructureOp[];
}

export interface StructureDiagnosticDetail {
  readonly code: string;
  readonly file: string;
  readonly pointer: string;
  readonly expected: string;
  readonly actual: string;
  readonly hint?: string;
}

export class StructureInputError extends Error {
  constructor(readonly detail: StructureDiagnosticDetail) {
    super(
      `${detail.pointer}: expected ${detail.expected}; got ${detail.actual}` +
        (detail.hint ? ` ${detail.hint}` : ''),
    );
    this.name = 'StructureInputError';
  }
}

export interface Cursor {
  readonly tokens: readonly ProgramToken[];
  readonly file: string;
  offset: number;
}
