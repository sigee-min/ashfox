import type {
  ProjectDiff,
  ProjectDiffCountsByKind,
  ProjectState,
  TrackedAnimation,
  TrackedBone,
  TrackedCube,
  TrackedCubeFace,
  TrackedMesh,
  TrackedTexture,
} from './index';
import { isTrackedAnimationContract, isTrackedTextureContract } from './assets';
import { isProjectDiffContract, isProjectDiffCountsByKindContract } from './diff';
import {
  isTrackedBoneContract,
  isTrackedCubeContract,
  isTrackedCubeFaceContract,
  isTrackedMeshContract,
} from './geometry';
import {
  isProjectStateContract,
  isProjectStateCountsContract,
  isProjectTextureResolutionContract,
} from './state';

/** Stable reader surface for consumers that validate untrusted snapshots. */
export interface ProjectContractReader {
  readonly isBone: (value: unknown) => value is TrackedBone;
  readonly isCube: (value: unknown) => value is TrackedCube;
  readonly isCubeFace: (value: unknown) => value is TrackedCubeFace;
  readonly isMesh: (value: unknown) => value is TrackedMesh;
  readonly isTexture: (value: unknown) => value is TrackedTexture;
  readonly isAnimation: (value: unknown) => value is TrackedAnimation;
  readonly isDiffCounts: (value: unknown) => value is ProjectDiffCountsByKind;
  readonly isDiff: (value: unknown) => value is ProjectDiff;
  readonly isStateCounts: (value: unknown) => value is ProjectState['counts'];
  readonly isTextureResolution: (
    value: unknown,
  ) => value is NonNullable<ProjectState['textureResolution']>;
  readonly isState: (value: unknown) => value is ProjectState;
}

export const projectContractReader: ProjectContractReader = Object.freeze({
  isBone: isTrackedBoneContract,
  isCube: isTrackedCubeContract,
  isCubeFace: isTrackedCubeFaceContract,
  isMesh: isTrackedMeshContract,
  isTexture: isTrackedTextureContract,
  isAnimation: isTrackedAnimationContract,
  isDiffCounts: isProjectDiffCountsByKindContract,
  isDiff: isProjectDiffContract,
  isStateCounts: isProjectStateCountsContract,
  isTextureResolution: isProjectTextureResolutionContract,
  isState: isProjectStateContract,
});

export {
  isProjectDiffContract,
  isProjectDiffCountsByKindContract,
  isProjectStateContract,
  isProjectStateCountsContract,
  isProjectTextureResolutionContract,
  isTrackedAnimationContract,
  isTrackedBoneContract,
  isTrackedCubeContract,
  isTrackedCubeFaceContract,
  isTrackedMeshContract,
  isTrackedTextureContract,
};
