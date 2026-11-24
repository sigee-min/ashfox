import { isDenseContractArray, isNonEmptyContractText } from '@ashfox/internal-contracts';

import type {
  ProjectDiff,
  ProjectDiffCounts,
  ProjectDiffCountsByKind,
  ProjectDiffSet,
} from './index';
import { isTrackedAnimationContract, isTrackedTextureContract } from './assets';
import { isTrackedBoneContract, isTrackedCubeContract, isTrackedMeshContract } from './geometry';
import {
  hasShape,
  isBoolean,
  isClosedContractRecord,
  isNonNegativeInteger,
  type ValueGuard,
} from './shared';

const isProjectDiffCountsContract = (value: unknown): value is ProjectDiffCounts =>
  isClosedContractRecord(value) &&
  hasShape(value, ['added', 'removed', 'changed']) &&
  isNonNegativeInteger(value.added) &&
  isNonNegativeInteger(value.removed) &&
  isNonNegativeInteger(value.changed);

export const isProjectDiffCountsByKindContract = (
  value: unknown,
): value is ProjectDiffCountsByKind =>
  isClosedContractRecord(value) &&
  hasShape(value, ['bones', 'cubes', 'textures', 'animations'], ['meshes']) &&
  isProjectDiffCountsContract(value.bones) &&
  isProjectDiffCountsContract(value.cubes) &&
  isProjectDiffCountsContract(value.textures) &&
  isProjectDiffCountsContract(value.animations) &&
  (value.meshes === undefined || isProjectDiffCountsContract(value.meshes));

const isProjectDiffSet = <T>(
  value: unknown,
  itemGuard: ValueGuard<T>,
): value is ProjectDiffSet<T> => {
  if (!isClosedContractRecord(value) || !hasShape(value, ['added', 'removed', 'changed']))
    return false;
  const added = value.added;
  const removed = value.removed;
  const changed = value.changed;
  const entryGuard = (entry: unknown): entry is { readonly key: string; readonly item: T } =>
    isClosedContractRecord(entry) &&
    hasShape(entry, ['key', 'item']) &&
    isNonEmptyContractText(entry.key) &&
    itemGuard(entry.item);
  const changeGuard = (
    entry: unknown,
  ): entry is { readonly key: string; readonly before: T; readonly after: T } =>
    isClosedContractRecord(entry) &&
    hasShape(entry, ['key', 'before', 'after']) &&
    isNonEmptyContractText(entry.key) &&
    itemGuard(entry.before) &&
    itemGuard(entry.after);
  if (
    !isDenseContractArray(added) ||
    !added.every(entryGuard) ||
    !isDenseContractArray(removed) ||
    !removed.every(entryGuard) ||
    !isDenseContractArray(changed) ||
    !changed.every(changeGuard)
  )
    return false;
  const keys = [
    ...added.map((entry) => entry.key),
    ...removed.map((entry) => entry.key),
    ...changed.map((entry) => entry.key),
  ];
  return new Set(keys).size === keys.length;
};

const matchesDiffCounts = (set: ProjectDiffSet<unknown>, counts: ProjectDiffCounts): boolean =>
  set.added.length === counts.added &&
  set.removed.length === counts.removed &&
  set.changed.length === counts.changed;

const readOptionalDiffSet = <T>(
  value: unknown,
  guard: ValueGuard<T>,
): ProjectDiffSet<T> | undefined | null => {
  if (value === undefined) return undefined;
  return isProjectDiffSet(value, guard) ? value : null;
};

export const isProjectDiffContract = (value: unknown): value is ProjectDiff => {
  if (
    !isClosedContractRecord(value) ||
    !hasShape(
      value,
      ['sinceRevision', 'currentRevision', 'counts'],
      ['baseMissing', 'bones', 'cubes', 'meshes', 'textures', 'animations'],
    ) ||
    !isNonEmptyContractText(value.sinceRevision) ||
    !isNonEmptyContractText(value.currentRevision) ||
    !isProjectDiffCountsByKindContract(value.counts) ||
    !(value.baseMissing === undefined || isBoolean(value.baseMissing))
  ) {
    return false;
  }
  const bones = readOptionalDiffSet(value.bones, isTrackedBoneContract);
  const cubes = readOptionalDiffSet(value.cubes, isTrackedCubeContract);
  const meshes = readOptionalDiffSet(value.meshes, isTrackedMeshContract);
  const textures = readOptionalDiffSet(value.textures, isTrackedTextureContract);
  const animations = readOptionalDiffSet(value.animations, isTrackedAnimationContract);
  if (
    bones === null ||
    cubes === null ||
    meshes === null ||
    textures === null ||
    animations === null
  )
    return false;
  return (
    (!bones || matchesDiffCounts(bones, value.counts.bones)) &&
    (!cubes || matchesDiffCounts(cubes, value.counts.cubes)) &&
    (!meshes ||
      (value.counts.meshes !== undefined && matchesDiffCounts(meshes, value.counts.meshes))) &&
    (!textures || matchesDiffCounts(textures, value.counts.textures)) &&
    (!animations || matchesDiffCounts(animations, value.counts.animations))
  );
};
