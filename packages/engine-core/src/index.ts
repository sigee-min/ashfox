export {
  hasExactContractKeys,
  isCanonicalIsoDate,
  isClosedContractRecord,
  isNonEmptyContractText,
  isUniqueContractTextArray
} from '@ashfox/internal-contracts';

export {
  CUBE_FACE_DIRECTIONS,
  IDENTITY_TRANSFORM,
  PLANE_FACE_DIRECTIONS,
  PROJECT_DOCUMENT_SCHEMA_VERSION,
  SURFACE_PIXEL_DENSITIES,
  cubeGeometryPivot,
  cubeGeometryCorners,
  cubeGeometryRotation,
  cubeUnrotatedBounds,
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
  type PlaneFaceDirection,
  type PlaneFaces,
  type PlaneNode,
  type ProjectDocument,
  type CompiledForwardDirection,
  type CompiledModel,
  type ProjectForwardDirection,
  type SceneNode,
  type SurfacePixelDensity,
  type TextureAsset,
  type TextureAlphaMask,
  type Transform,
  type TransformChannel,
  type Vec3
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
  type WorkspacePackage
} from './project/workspace';
export {
  compileAssetWorkspaceEntry,
  type CompileAssetWorkspaceEntryResult
} from './compiler/program/asset/compile';
export type {
  AssetBuildIdentity,
  AssetProject,
  AssetProjectIdentitySeed
} from './project/asset';
export {
  isAssetProjectAuthorityValid,
  openAssetProject,
  type OpenAssetProjectInput,
  type OpenAssetProjectResult
} from './commands/workspace/open';
export {
  applyWorkspaceChangeSet,
  type ApplyWorkspaceChangeSetResult
} from './compiler/program/asset/workspaceChange';
export {
  ASHFOX_WORKSPACE_FILE_CONTENT_TYPE,
  ASHFOX_WORKSPACE_FILE_EXTENSION,
  readWorkspaceFile,
  writeWorkspaceFile,
  type ReadWorkspaceFileOptions,
  type ReadWorkspaceFileResult,
  type WorkspaceFileInput,
  type WriteWorkspaceFileResult
} from './project/container';
export {
  sha256ByteDigest, sha256Digest
} from './provenance/digest';
export {
  effectivelyVisibleSceneNodeIds,
  isSceneNodeEffectivelyVisible
} from './sceneVisibility';

export {
  PROJECT_SIGNED_VIEWS,
  projectSignedViewFrame,
  projectWorldBasis,
  type ProjectAxisVector,
  type ProjectSignedView,
  type ProjectViewFrame
} from './project/frame';

export {
  AGENT_ACCESSIBLE_COMMAND_NAMES, COMMAND_RECEIPT_SCHEMA_VERSION,
  commandAllowedForSource,
  executeAgentCommandBatch,
  executeSystemCommandBatch,
  executeWebCommandBatch,
  getAgentCommandDefinition,
  isValidCommandReceipt,
  isValidCommandReceiptLedger,
  listAgentCommandDefinitions,
  type CommandBatch,
  type CommandBatchResult,
  type CommandEffects,
  type CommandError,
  type CommandReceipt,
  type CommandReceiptLedgerOptions,
  type CommandSource,
  type ProjectCommandOperation,
  type WorkspaceApplyInput
} from './commands';

export {
  ProjectInvariantError,
  assertProjectDocument,
  validateProjectDocument,
  type InvariantFinding,
  type ValidationReport
} from './validation';
export {
  CANONICAL_IDLE_CLIP_NAME,
  evaluateProductionReadiness,
  type ProductionReadinessCode,
  type ProductionReadinessCounts,
  type ProductionReadinessFinding,
  type ProductionReadinessReport
} from './readiness';

export {
  AnimationExportCapabilityError,
  analyzeAnimationPreview,
  analyzeProjectAnimationCapabilities,
  animationPreviewIssues,
  blockingCanonicalAnimationPreviewIssues,
  blockingAnimationPreviewIssues,
  type AnimationPreviewIssue
} from './animation/capability';
export {
  sampleComposedNumericTransformChannel,
  sampleNumericTransformChannel,
  type NumericAnimationVec3
} from './animation/numericChannel';

export {
  cubeFaceDimensions,
  faceTexelSize,
  packUvAtlas,
  reduceAtlasPixelsPerBlock
} from './textures/uvAtlas';
export {
  composeTextureRaster, rasterizeCanonicalTexture, rasterizeTexture,
  canonicalPngDigest, canonicalRgbaDigest, encodeCanonicalPng,
  type CanonicalRgbaBytes, type CanonicalTextureRaster,
  type TextureComposition
} from './textures/textureRecipe';

export {
  BlobResolutionError,
  EXPORT_BUNDLE_SCHEMA_VERSION,
  ExportMaterializationRequiredError,
  type ExportAdaptationReceipt,
  type ExportBundle,
  type ExportFile,
  type JsonExportFile,
  type ResolvedBlob
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
  type ExportPreset
} from './export/compatibility';
export {
  ProductionExportError,
  exportProductionProject,
  exportProductionProjectResolved
} from './export/project';
export {
  compileProjectBundle,
  compileProjectBundleResolved,
  verifyExportBundleForProject
} from './export/pipeline/compile';
export { validateAssetProjectExportTarget } from './export/pipeline/validate';
export {
  verifyExportBundleLineage
} from './export/pipeline/bundle';
export {
  adaptProjectForExport,
  readExportAdapterInput,
  resolveExportAdapter,
  ExportAdapterInputError,
  type ExportAdaptedDocument,
  type ExportAdapterInput,
  type ExportTextureAsset,
  type ResolvedExportAdapter
} from './export/adapter';
export type {
  ExportFormatProfile
} from './export/adapter/contract';
export { measureSceneGeometry } from './model/measurement/geometry';
export { inspectNodeSurface } from './model/measurement/surface';
export type { GeometryMeasurementRequest, GeometryMeasurement, MeasurementResult } from './model/measurement/contract';
export { readItemStudy } from './project/sprite/read';
export { compileItemStudy, spritePreviewPng } from './compiler/sprite/compile';
export { SPRITE_POLICY } from './project/sprite/contract';
export type { ItemStudy, SpriteDiagnostic } from './project/sprite/contract';
export type { SpriteBuild, SpriteProduct, SpriteReceipt } from './compiler/sprite/contract';
export { spriteSheetPng } from './compiler/sprite/preview';
export { parseSpriteSource } from './project/sprite/source';
export { inspectNativeSource } from './project/directory/source';
export { readDirectoryWorkspace, isDirectorySource, matchDirectoryPattern } from './project/directory/read';
export { compileDirectoryWorkspace } from './compiler/directory/compile';
export type { DirectoryWorkspace, DirectoryFile } from './project/directory/contract';
export type { DirectoryCompilation, DirectoryProduct } from './compiler/directory/compile';

export type { JavaResourcePack, GameAssetPack, DirectoryPack } from './project/directory/pack';
