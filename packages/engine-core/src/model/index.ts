export {
  isSurfacePixelDensity,
  PROJECT_DOCUMENT_SCHEMA_VERSION,
  SURFACE_PIXEL_DENSITIES,
  type AssetId,
  type EntityId,
  type JsonValue,
  type ProjectId,
  type ProjectForwardDirection,
  type Revision,
  type SurfacePixelDensity,
  type Vec2,
  type Vec3,
} from './identity';
export {
  CUBE_FACE_DIRECTIONS,
  IDENTITY_TRANSFORM,
  PLANE_FACE_DIRECTIONS,
  boneTransformMatchesCanonicalFrame,
  cubeGeometryPivot,
  cubeGeometryCorners,
  cubeGeometryRotation,
  cubeUnrotatedBounds,
  isCanonicalBoneFrame,
  sealCanonicalBoneFrame,
  type BoneNode,
  type AxisCubeNode,
  type CubeFace,
  type CubeFaceDirection,
  type CubeFaces,
  type CubeNode,
  type OrientedCubeNode,
  type CylinderNode,
  type LocatorNode,
  type PlaneFaceDirection,
  type PlaneFaces,
  type PlaneNode,
  type SceneNode,
  type TaperNode,
  type Transform,
  type WedgeNode,
} from './scene';
export { buildPrimitivePolygons, evalPolygonFaceUvs, primitiveLocalVertices } from './primitives';
export {
  compileExpressionChannels,
  expressionSlotName,
  expressionSlotPlacement,
  expressionVariantName,
  isExpressionVariantNode,
  type ExpressionPlacement,
} from './expression';
export {
  type BlobRef,
  type TextureAsset,
  type TextureCanvasDetail,
  type TextureAlphaMask,
  type TexturePbrMaterial,
} from './texture';
export {
  type AnimationClip,
  type AnimationEffect,
  type AnimationEffectValue,
  type AnimationLoopMode,
  type AnimationScalar,
  type AnimationTriggerTrack,
  type AnimationVec3,
  type KeyframeEasing,
  type MotionCue,
  type TransformChannel,
  type TransformKeyframe,
} from './motion';
export type { ProjectDocument } from './document';
export type { AssetQualityProfile, CompiledForwardDirection, CompiledModel } from './compiled';
export type {
  AssetAuthoringTelemetry,
  ChartAuthoringTelemetry,
  TextureAuthoringTelemetry,
} from './telemetry';
export { canonicalMinecraftRotation } from './transform';
export {
  computeModelColliders,
  type ModelAabb,
  type ModelBoxCollider,
  type ModelCapsuleCollider,
  type ModelCollider,
  type ModelColliderSet,
} from './collider';
export {
  type CompiledHitZone,
  type DamageStateKind,
  type HitZoneShape,
  type ModelDamageStateMeta,
  type ModelHitZone,
} from './hitzone';
