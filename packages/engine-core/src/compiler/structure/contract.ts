import type { AuditQualityGrade, AuditSubmetricShape } from '@ashfox/internal-contracts';
import type { Vec3 } from '../../model/identity';
import type { CompiledModel } from '../../model/compiled';
import type { ProjectDocument } from '../../model/document';
import type { TextureAsset } from '../../model/texture';
import type { HooksDocument } from '../../hooks/contract';
import type {
  AcousticSpace,
  BlockRotation,
  CardinalFacing,
  IntVec3,
  StructureDensity,
} from '../../project/structure/contract';

export type StructureAuditPillarId = 'architecture' | 'facade' | 'interior' | 'craft';

export interface StructureAuditGate {
  readonly id: string;
  readonly passed: boolean;
  readonly message: string;
  readonly targets: readonly string[];
  readonly fix: string;
}

export interface StructureAuditPillar {
  readonly id: StructureAuditPillarId;
  readonly label: string;
  readonly score: number;
  readonly maxScore: number;
  readonly metrics: readonly AuditSubmetricShape[];
}

export interface StructureAuditDeduction {
  readonly metricId: string;
  readonly pillar: StructureAuditPillarId | 'gate';
  readonly lostPoints: number;
  readonly summary: string;
  readonly targets: readonly string[];
  readonly fix: string;
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

export interface StructureFloorMeta {
  readonly name: string;
  readonly y: number;
  readonly height: number;
  readonly jetty?: Readonly<Partial<Record<CardinalFacing, number>>>;
}

export interface StructureRoomMeta {
  readonly name: string;
  readonly kind: string;
  readonly acousticSpace: AcousticSpace;
  readonly from: IntVec3;
  readonly to: IntVec3;
  readonly enclosed: boolean;
  readonly shape?: 'rect' | 'octagon';
}

export interface StructureOpeningMeta {
  readonly kind: 'door' | 'window' | 'arch' | 'bay_window' | 'arcade';
  readonly room: string;
  readonly wall: CardinalFacing;
  readonly from: IntVec3;
  readonly to: IntVec3;
  readonly hinge?: 'left' | 'right';
  readonly connectsRooms?: readonly [string, string];
}

export interface StructureSocketMeta {
  readonly id: string;
  readonly position: Vec3;
  readonly normal: CardinalFacing;
  readonly schema: string;
  readonly pool?: string;
  readonly target?: string;
}

export interface StructureSemanticStats {
  readonly roomCount: number;
  readonly facadeCount: number;
  readonly stairCount: number;
  readonly furnishCount: number;
  readonly weatheringCount: number;
  readonly rawSetCount: number;
}

export interface StructureGrid {
  readonly id: string;
  readonly dataVersion: number;
  readonly density: StructureDensity;
  readonly seed: number;
  readonly size: IntVec3;
  /** Distinct canonical block states; index 0 is always "minecraft:air". */
  readonly states: readonly string[];
  /** Dense XYZ-indexed voxel buffer (-1 = untouched outside air, 0 = carved air, >=1 = state index). */
  readonly voxels: Int32Array;
  /** Asset alias tag per voxel index when placed via an `asset` palette entry, else null. */
  readonly customTags: readonly (string | null)[];
  readonly customPlacements: readonly StructureCustomPlacement[];
  readonly floors: readonly StructureFloorMeta[];
  readonly rooms: readonly StructureRoomMeta[];
  readonly openings: readonly StructureOpeningMeta[];
  readonly sockets: readonly StructureSocketMeta[];
  readonly hasRoofTrim: boolean;
  readonly roofCount: number;
  readonly dormerCount: number;
  readonly chimneyCount: number;
  readonly semanticStats: StructureSemanticStats;
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

export interface StructureLightingField {
  readonly size: IntVec3;
  readonly sky: Uint8Array;
  readonly blockR: Uint8Array;
  readonly blockG: Uint8Array;
  readonly blockB: Uint8Array;
}

export interface StructureBakedBatch {
  readonly layer: 'opaque' | 'cutout' | 'emissive';
  readonly textureId: string;
  readonly positions: readonly number[];
  readonly normals: readonly number[];
  readonly uvs: readonly number[];
  /** Normalized 0..1 RGB vertex colors (3 components per vertex) encoding Voxel AO * lightmap. */
  readonly colors: readonly number[];
  readonly indices: readonly number[];
}

export interface StructurePropInstance {
  readonly assetKey: string;
  readonly translation: Vec3;
  readonly rotation: BlockRotation;
  readonly lightRgb: readonly [number, number, number];
}

export interface StructureBakedMesh {
  readonly batches: readonly StructureBakedBatch[];
  readonly textures: Readonly<Record<string, TextureAsset>>;
  readonly instances: readonly StructurePropInstance[];
  readonly rawFaceCount: number;
  readonly mergedQuadCount: number;
  readonly trimCount?: number;
}

export interface StructureLodLevels {
  readonly lod1: StructureBakedMesh;
  readonly lod2: StructureBakedMesh;
}

export interface PlayableCollider {
  readonly from: Vec3;
  readonly to: Vec3;
  readonly material: 'stone' | 'wood' | 'metal' | 'glass' | 'foliage';
}

export interface PlayableZone {
  readonly id: string;
  readonly kind: string;
  readonly from: Vec3;
  readonly to: Vec3;
  readonly enclosed: boolean;
  readonly acousticSpace: AcousticSpace;
}

export interface PlayableLight {
  readonly id: string;
  readonly position: Vec3;
  readonly color: string;
  readonly intensity: number;
  readonly radius: number;
  readonly kind: 'lantern' | 'torch' | 'hearth' | 'soul_lantern' | 'emissive_prop';
}

export interface PlayableInteractable {
  readonly id: string;
  readonly kind: 'door' | 'chest' | 'furnace' | 'anvil' | 'bed' | 'workstation';
  readonly position: Vec3;
  readonly facing: CardinalFacing;
  readonly hingePivot?: Vec3;
  readonly connectsZones?: readonly [string, string];
}

export interface PlayableStructureMeta {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly unitsPerBlock: 1;
  readonly bounds: { readonly min: Vec3; readonly max: Vec3 };
  readonly colliders: readonly PlayableCollider[];
  readonly zones: readonly PlayableZone[];
  readonly lights: readonly PlayableLight[];
  readonly interactables: readonly PlayableInteractable[];
  readonly sockets: readonly StructureSocketMeta[];
  readonly navigation: {
    readonly entryCells: readonly IntVec3[];
    readonly walkableCellCount: number;
    readonly floorLevels: readonly number[];
  };
}

export interface StructureAuditMetrics {
  readonly blockCount: number;
  readonly interiorCells: number;
  readonly walkableCells: number;
  readonly walkableReachRatio: number;
  readonly avgInteriorHeadroom: number;
  readonly skyLeakRate: number;
  readonly litInteriorRatio: number;
  readonly facadeReliefRatio: number;
  readonly openingRatio: number;
  readonly accessibleDoorways: number;
  readonly lightSources: number;
  readonly furnitureCount: number;
  readonly distinctMaterials: number;
  readonly shapeKinds: number;
  readonly prefabUses: number;
  readonly customAssetCount: number;
  readonly greedyCompressionRatio: number;
  readonly semanticRatio: number;
}

export interface StructureAuditReport {
  readonly schemaVersion: 1;
  readonly profile: 'structure';
  readonly threshold: number;
  readonly passed: boolean;
  readonly score: number;
  readonly grade: AuditQualityGrade;
  readonly hardGates: readonly StructureAuditGate[];
  readonly pillars: readonly StructureAuditPillar[];
  readonly topDeductions: readonly StructureAuditDeduction[];
  readonly metrics: StructureAuditMetrics;
}

export type StructureAuditEvaluator = (
  grid: StructureGrid,
  prefabUses: number,
  lighting: StructureLightingField,
  mesh: StructureBakedMesh,
) => StructureAuditReport;

export interface CompoundChildPlacement {
  readonly unitPath: string;
  readonly alias: string;
  readonly origin: IntVec3;
  readonly rotate: BlockRotation;
  readonly grid: StructureGrid;
  readonly compoundChildren?: readonly CompoundChildPlacement[];
}

export interface EvaluatedStructureResult {
  readonly grid: StructureGrid;
  readonly prefabUses: number;
  readonly compoundChildren?: readonly CompoundChildPlacement[];
}

export interface StructureProduct {
  readonly id: string;
  readonly grid: StructureGrid;
  readonly customModels: Readonly<Record<string, CompiledModel>>;
  readonly nbt: Uint8Array;
  readonly lighting: StructureLightingField;
  readonly bakedMesh: StructureBakedMesh;
  readonly lodLevels?: StructureLodLevels;
  readonly playableMeta: PlayableStructureMeta;
  readonly hooks?: HooksDocument;
  readonly document: ProjectDocument;
  readonly audit: StructureAuditReport;
}
