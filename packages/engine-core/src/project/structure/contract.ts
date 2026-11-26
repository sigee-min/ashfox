import type { ProgramToken } from '../program/syntax/lex';

export const MAX_STRUCTURE_DIM = 64;
export const MAX_STRUCTURE_VOLUME = 65_536;
export const MAX_STRUCTURE_OPS = 16_384;
export const DEFAULT_DATA_VERSION = 3955;

export type CardinalFacing = 'north' | 'south' | 'east' | 'west';
export type BlockRotation = 0 | 90 | 180 | 270;
export type MirrorAxis = 'x' | 'z';
export type RepeatAxis = 'x' | 'y' | 'z';
export type RoofStyle = 'gable' | 'hip' | 'pyramid';

export type IntVec3 = readonly [number, number, number];
export type IntVec2 = readonly [number, number];

export interface StructureImport {
  readonly path: string;
  readonly alias: string;
}

export type StructurePaletteEntry =
  | Readonly<{ kind: 'block'; state: string }>
  | Readonly<{ kind: 'asset'; alias: string; fallback: string }>;

export type StructureOp =
  | Readonly<{
      op: 'set';
      at: IntVec3;
      block: string;
      facing?: CardinalFacing;
    }>
  | Readonly<{
      op: 'box' | 'hollow' | 'walls' | 'frame';
      from: IntVec3;
      to: IntVec3;
      block: string;
    }>
  | Readonly<{
      op: 'carve';
      from: IntVec3;
      to: IntVec3;
    }>
  | Readonly<{
      op: 'roof';
      style: RoofStyle;
      axis: MirrorAxis;
      from: IntVec3;
      to: IntVec3;
      stair: string;
      ridge: string;
      gable?: string;
    }>
  | Readonly<{
      op: 'layer';
      y: number;
      origin: IntVec2;
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
      at: IntVec3;
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
}

export class StructureInputError extends Error {
  constructor(readonly detail: StructureDiagnosticDetail) {
    super(`${detail.pointer}: expected ${detail.expected}; got ${detail.actual}`);
    this.name = 'StructureInputError';
  }
}

export interface Cursor {
  readonly tokens: readonly ProgramToken[];
  readonly file: string;
  offset: number;
}
