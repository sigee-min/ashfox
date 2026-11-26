import type { AuditPillarId } from '../../audit/contract';
import type { CompiledModel, ProjectDocument } from '../../model';
import type { CardinalFacing, IntVec3 } from '../../project/structure/contract';

export interface StructureAuditGate {
  readonly id: string;
  readonly passed: boolean;
  readonly message: string;
  readonly targets: readonly string[];
  readonly fix: string;
}

export interface StructureAuditPillar {
  readonly id: AuditPillarId;
  readonly label: string;
  readonly score: number;
  readonly maxScore: number;
  readonly metrics: readonly {
    readonly id: string;
    readonly label: string;
    readonly score: number;
    readonly maxScore: number;
    readonly value: number;
    readonly target: number;
    readonly detail: string;
  }[];
}

export interface StructureCustomPlacement {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly assetAlias: string;
  readonly fallbackState: string;
  readonly facing: CardinalFacing;
}

/** Qualifies a structure custom-model alias by its declaring unit path to prevent collisions. */
export const qualifyCustomAssetKey = (ownerPath: string, alias: string): string =>
  `${ownerPath}#${alias}`;

export interface StructureGrid {
  readonly id: string;
  readonly dataVersion: number;
  readonly size: IntVec3;
  /** Distinct canonical block states; index 0 is always "minecraft:air". */
  readonly states: readonly string[];
  /** Dense XYZ-indexed voxel buffer (-1 = untouched outside air, 0 = carved air, >=1 = state index). */
  readonly voxels: Int32Array;
  /** Asset alias tag per voxel index when placed via an `asset` palette entry, else null. */
  readonly customTags: readonly (string | null)[];
  readonly customPlacements: readonly StructureCustomPlacement[];
}

export interface DecodedStructureNbt {
  readonly dataVersion: number;
  readonly size: IntVec3;
  readonly palette: readonly {
    readonly Name: string;
    readonly Properties?: Readonly<Record<string, string>>;
  }[];
  readonly blocks: readonly { readonly pos: IntVec3; readonly state: number }[];
}

export interface StructureAuditMetrics {
  readonly blockCount: number;
  readonly interiorCells: number;
  readonly accessibleDoorways: number;
  readonly lightSources: number;
  readonly furnitureCount: number;
  readonly distinctMaterials: number;
  readonly shapeKinds: number;
  readonly prefabUses: number;
  readonly customAssetCount: number;
}

export interface StructureAuditReport {
  readonly schemaVersion: 1;
  readonly profile: 'structure';
  readonly threshold: number;
  readonly passed: boolean;
  readonly score: number;
  readonly grade: 'fail' | 'pass' | 'excellent';
  readonly hardGates: readonly StructureAuditGate[];
  readonly pillars: readonly StructureAuditPillar[];
  readonly metrics: StructureAuditMetrics;
}

export interface StructureProduct {
  readonly id: string;
  readonly grid: StructureGrid;
  readonly customModels: Readonly<Record<string, CompiledModel>>;
  readonly nbt: Uint8Array;
  readonly document: ProjectDocument;
  readonly audit: StructureAuditReport;
}
