import { evaluateStructureQuality } from './audit/structure/evaluate';
import {
  compileDirectoryWorkspace as compileDirectoryWorkspaceWithAudit,
  type DirectoryCompilation,
} from './compiler/directory/compile';
import {
  compileStructureUnits as compileStructureUnitsWithAudit,
  type StructureProduct,
} from './compiler/structure';
import type { CompiledModel } from './model/compiled';
import type { DirectoryFile } from './project/directory/contract';
import type { StructureSourceUnit } from './project/structure';

export {
  hasExactContractKeys,
  isCanonicalIsoDate,
  isClosedContractRecord,
  isNonEmptyContractText,
  isUniqueContractTextArray,
} from '@ashfox/internal-contracts';

export {
  CUBE_FACE_DIRECTIONS,
  IDENTITY_TRANSFORM,
  PLANE_FACE_DIRECTIONS,
  PROJECT_DOCUMENT_SCHEMA_VERSION,
  SURFACE_PIXEL_DENSITIES,
  buildPrimitivePolygons,
  compileExpressionChannels,
  computeModelColliders,
  cubeGeometryPivot,
  cubeGeometryCorners,
  cubeGeometryRotation,
  cubeUnrotatedBounds,
  evalPolygonFaceUvs,
  expressionSlotName,
  expressionVariantName,
  isExpressionVariantNode,
  type ModelAabb,
  type ModelBoxCollider,
  type ModelCapsuleCollider,
  type ModelCollider,
  type ModelColliderSet,
  type AnimationClip,
  type AnimationEffectValue,
  type AnimationLoopMode,
  type AnimationTriggerTrack,
  type AxisCubeNode,
  type BlobRef,
  type BoneNode,
  type CubeFace,
  type CubeFaces,
  type CubeNode,
  type OrientedCubeNode,
  type CylinderNode,
  type PlaneFaceDirection,
  type PlaneFaces,
  type PlaneNode,
  type ProjectDocument,
  type AssetQualityProfile,
  type CompiledForwardDirection,
  type CompiledModel,
  type ProjectForwardDirection,
  type SceneNode,
  type SurfacePixelDensity,
  type TaperNode,
  type TextureAsset,
  type TextureAlphaMask,
  type TexturePbrMaterial,
  type Transform,
  type TransformChannel,
  type Vec3,
  type WedgeNode,
} from './model';

export { canonicalJsonString } from './canonicalJson';
export {
  ASHFOX_LOCK_FORMAT,
  ASHFOX_MODEL_GRAMMAR,
  ASHFOX_PACKAGE_FORMAT,
  ASHFOX_WORKSPACE_COMPILER_FINGERPRINT,
  ASHFOX_WORKSPACE_FORMAT,
  ASHFOX_WORKSPACE_VERSION,
  computePackageContentHash,
  computePackageInterfaceHash,
  computePackageManifestHash,
  computeSourceContentHash,
  computeWorkspaceHash,
  readWorkspaceLock,
  readWorkspaceManifest,
  resolveWorkspaceEntry,
  type AssetEntry,
  type AuthoredAssetWorkspace,
  type LockedPackage,
  type PackageManifest,
  type Sha256Digest,
  type WorkspaceChangeSet,
  type WorkspaceDiagnostic,
  type WorkspaceEntrySelector,
  type WorkspaceFile,
  type WorkspaceLock,
  type WorkspaceManifest,
  type WorkspacePackage,
} from './project/workspace';
export {
  compileAssetWorkspaceEntry,
  type CompileAssetWorkspaceDetailedResult,
  type CompileAssetWorkspaceEntryResult,
} from './compiler/program/asset/compile';
export type {
  AssetAuthoringTelemetry,
  ChartAuthoringTelemetry,
  TextureAuthoringTelemetry,
} from './compiler/program/asset/texture/telemetry';
export type { AssetBuildIdentity, AssetProject, AssetProjectIdentitySeed } from './project/asset';
export {
  isAssetProjectAuthorityValid,
  openAssetProject,
  type OpenAssetProjectInput,
  type OpenAssetProjectResult,
} from './commands/workspace/open';
export {
  applyWorkspaceChangeSet,
  type ApplyWorkspaceChangeSetResult,
} from './compiler/program/asset/workspaceChange';
export {
  ASHFOX_WORKSPACE_FILE_CONTENT_TYPE,
  ASHFOX_WORKSPACE_FILE_EXTENSION,
  readWorkspaceFile,
  writeWorkspaceFile,
  type ReadWorkspaceFileOptions,
  type ReadWorkspaceFileResult,
  type WorkspaceFileInput,
  type WriteWorkspaceFileResult,
} from './project/container';
export { sha256ByteDigest, sha256Digest } from './provenance/digest';
export { effectivelyVisibleSceneNodeIds, isSceneNodeEffectivelyVisible } from './sceneVisibility';

export {
  PROJECT_SIGNED_VIEWS,
  projectSignedViewFrame,
  projectWorldBasis,
  type ProjectAxisVector,
  type ProjectSignedView,
  type ProjectViewFrame,
} from './project/frame';

export {
  ProjectInvariantError,
  assertProjectDocument,
  validateProjectDocument,
  type InvariantFinding,
  type ValidationReport,
} from './validation';
export {
  CANONICAL_IDLE_CLIP_NAME,
  evaluateProductionReadiness,
  type ProductionReadinessCode,
  type ProductionReadinessCounts,
  type ProductionReadinessFinding,
  type ProductionReadinessReport,
} from './readiness';

export {
  AnimationExportCapabilityError,
  analyzeAnimationPreview,
  analyzeProjectAnimationCapabilities,
  animationPreviewIssues,
  blockingCanonicalAnimationPreviewIssues,
  blockingAnimationPreviewIssues,
  type AnimationPreviewIssue,
} from './animation/capability';
export {
  sampleComposedNumericTransformChannel,
  sampleNumericTransformChannel,
  type NumericAnimationVec3,
} from './animation/numericChannel';

export {
  composeTextureRaster,
  rasterizeCanonicalTexture,
  rasterizeTexture,
  canonicalPngDigest,
  canonicalRgbaDigest,
  encodeCanonicalPng,
  type CanonicalRgbaBytes,
  type CanonicalTextureRaster,
  type TextureComposition,
} from './textures/textureRecipe';

export {
  BlobResolutionError,
  EXPORT_BUNDLE_SCHEMA_VERSION,
  ExportMaterializationRequiredError,
  type ExportAdaptationReceipt,
  type ExportBundle,
  type ExportFile,
  type JsonExportFile,
  type ResolvedBlob,
} from './export/contract';
export {
  EXPORT_PRESETS,
  exportCompatibilityFor,
  exportCompatibilityOptions,
  exportPresetForBundle,
  exportTargetDescriptorForPreset,
  isExportModelPathValid,
  isExportNamespaceValid,
  normalizeExportModelPath,
  type ExportCompatibilityOption,
  type CurrentExportTargetDescriptor,
  type ExportPreset,
} from './export/compatibility';
export {
  ProductionExportError,
  exportProductionProject,
  exportProductionProjectResolved,
} from './export/project';
export {
  compileProjectBundle,
  compileProjectBundleResolved,
  verifyExportBundleForProject,
} from './export/pipeline/compile';
export { validateAssetProjectExportTarget } from './export/pipeline/validate';
export { verifyExportBundleLineage } from './export/pipeline/bundle';
export {
  adaptProjectForExport,
  readExportAdapterInput,
  resolveExportAdapter,
  ExportAdapterInputError,
  type ExportAdaptedDocument,
  type ExportAdapterInput,
  type ExportTextureAsset,
  type ResolvedExportAdapter,
} from './export/adapter';
export type { ExportFormatProfile } from './export/adapter/contract';
export { measureSceneGeometry } from './model/measurement/geometry';
export { inspectNodeSurface } from './model/measurement/surface';
export type {
  GeometryMeasurementRequest,
  GeometryMeasurement,
  MeasurementResult,
} from './model/measurement/contract';
export { readSpriteDocument } from './project/sprite/read';
export { compileSpriteDocument, spritePreviewPng } from './compiler/sprite/compile';
export { SPRITE_POLICY, SPRITE_PROFILES, SpriteInputError } from './project/sprite/contract';
export type { SpriteDiagnostic, SpriteDocument, SpriteProfile } from './project/sprite/contract';
export type {
  SpriteAuthoringTelemetry,
  SpriteBuild,
  SpriteProduct,
  SpriteReceipt,
} from './compiler/sprite/contract';
export { encodeRgbaBufferPng, spriteInspectSheetPng } from './audit/sprite/sheet';
export { parseSpriteSource } from './project/sprite/source';
export {
  DEFAULT_SPRITE_THRESHOLD,
  evaluateSpriteQuality,
  formatSpriteGateFailure,
  type SpriteAuditDeduction,
  type SpriteAuditGateId,
  type SpriteAuditGateResult,
  type SpriteAuditOptions,
  type SpriteAuditPillarId,
  type SpriteAuditPillarReport,
  type SpriteAuditReport,
} from './audit/sprite';
export { inspectNativeSource } from './project/directory/source';
export {
  readDirectoryWorkspace,
  isDirectorySource,
  matchDirectoryPattern,
} from './project/directory/read';
export {
  defaultOutputsForKind,
  validateAssetDeclarations,
  type AssetDeclarations,
  type DeclaredAssetKind,
  type DeclaredOutputFormat,
  type DeclaredOutputSpec,
  type DeclaredPreviewSpec,
} from './project/directory/declarations';
export const compileDirectoryWorkspace = (
  configuration: string,
  files: readonly DirectoryFile[],
  virtualLibraries?: ReadonlyMap<string, string>,
): DirectoryCompilation =>
  compileDirectoryWorkspaceWithAudit(
    configuration,
    files,
    evaluateStructureQuality,
    true,
    virtualLibraries,
  );
export {
  STD_LIBRARY_PREFIX,
  STD_LOGICAL_ROOT,
  buildStdPackageEntry,
  describeVirtualModule,
  extractSourceImports,
  filterVirtualLibraries,
  isStdLibraryLogicalPath,
  isVirtualLibrarySpecifier,
  listVirtualLibraries,
  mergeVirtualLibraryFiles,
  resolveImportPath,
  resolveSourceImport,
  virtualLibraryLogicalPath,
  virtualLibrarySpecifierFromPath,
  type VirtualFileLookup,
  type VirtualLibraryDescriptor,
  type VirtualLibraryDomain,
  type VirtualModuleDescription,
  type VirtualModuleExport,
  type VirtualModuleParam,
} from './project/stdlib';
export type {
  DirectoryExport,
  DirectoryWorkspace,
  DirectoryFile,
} from './project/directory/contract';
export type { DirectoryCompilation, DirectoryProduct } from './compiler/directory/compile';
export { prepareDirectorySound } from './compiler/directory/sound';

export type { JavaResourcePack, GameAssetPack, DirectoryPack } from './project/directory/pack';

export {
  DEFAULT_AUDIT_THRESHOLD,
  evaluateAssetQuality,
  formatDeliveryGateFailure,
  type AuditDeduction,
  type AuditGateId,
  type AuditGateResult,
  type AuditModelInput,
  type AuditOptions,
  type AuditPillarId,
  type AuditPillarReport,
  type AuditProfileSource,
  type AuditReport,
  type AuditSubmetric,
  type QualityGrade,
} from './audit';
export {
  buildStructureGlbBytes,
  exportStructureGltfResolved,
  type StructureGltfOptions,
} from './export/pipeline/structure';
export {
  parseStructureSource,
  StructureInputError,
  type StructureDiagnosticDetail,
  type StructureSourceUnit,
} from './project/structure';
export { evaluateStructureQuality } from './audit/structure/evaluate';
export type { StructureAuditMetrics, StructureAuditReport } from './audit/structure/contract';
export {
  buildStructureBakedMesh,
  collectStructureCutBands,
  compileStructureUnits as compileStructureUnitsRaw,
  decodeStructureNbt,
  encodeStructureNbt,
  type DecodedStructureNbt,
  type PlayableStructureMeta,
  type StructureBakedBatch,
  type StructureBakedMesh,
  type StructureCustomPlacement,
  type StructureGrid,
  type StructureLightingField,
  type StructureProduct,
  type StructurePropInstance,
} from './compiler/structure';

export const compileStructureUnits = (
  rootPath: string,
  units: ReadonlyMap<string, StructureSourceUnit>,
  customModels: Readonly<Record<string, CompiledModel>>,
  relative: (owner: string, specifier: string) => string,
): StructureProduct =>
  compileStructureUnitsWithAudit(rootPath, units, customModels, relative, evaluateStructureQuality);

export {
  evaluateGlbPerformance,
  inspectGlbPerformance,
  type GlbPerformanceBudget,
  type GlbPerformanceKind,
  type GlbPerformanceMetrics,
  type GlbPerformanceOptions,
  type GlbPerformanceReport,
  type GlbPerformanceViolation,
} from './audit/performance';
export * from './hooks/index';
export { evaluateMotionQuality, type MotionAuditInput } from './audit/motion';
export { bakeClip } from './animation/bake';
export type {
  BakedClip,
  ClipSpec,
  MotionAuditMetric,
  MotionAuditReport,
  RigJoint,
  RigSpec,
} from './animation/contract';
export {
  DEFAULT_VFX_BUDGET,
  VFX_KIND,
  VFX_SCHEMA_VERSION,
  type CompiledVfx,
  type CompiledVfxElement,
  type VfxBakedBurst,
  type VfxBlendMode,
  type VfxBudget,
  type VfxFlipbookManifest,
  type VfxLifeStop,
  type VfxPalette,
  type VfxRecipe,
  type VfxRuntimeStats,
} from './vfx/contract';
export { compileVfxRecipe, readVfxRecipe } from './vfx/compile';
export { auditVfx, type VfxAuditReport } from './vfx/audit';
export { emitVfxGlb } from './export/targets/gltf/vfxGltf';
export {
  emitBedrockParticleSpecs,
  emitVfxRuntimeSpec,
  type BedrockParticleSpec,
  type VfxRuntimeSpec,
} from './vfx/specEmit';
export { VFX_PALETTES, VFX_SHOWCASE_PRESETS } from './vfx/presets';
export { VfxInputError, type VfxSourceUnit } from './project/vfx/contract';
export { parseVfxSource } from './project/vfx/source';
export type { SourceDiagnostic, SourcePosition, SourceSpan } from './project/source/contract';
export {
  ASHFOX_UNITS,
  damerauLevenshtein,
  docsHint,
  formatDidYouMean,
  suggestClosest,
  suggestUnit,
  toSnakeCaseTrap,
  withSuggestion,
} from './project/source/suggest';
export { collectInspectRefs, type SourceInspectRef } from './project/source/inspect';
