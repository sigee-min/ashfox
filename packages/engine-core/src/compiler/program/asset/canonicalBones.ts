import { compareText } from '../../../stableOrder';
import { deepFreeze, freeze } from '../../../immutable';
import type { EntityId, Vec3 } from '../../../model/identity';
import {
  boneTransformMatchesCanonicalFrame,
  sealCanonicalBoneFrame,
  type BoneNode,
} from '../../../model/scene';
import type { AssetDiagnostic } from '../../../project/program/asset/contract';
import type { AssetExactFrame } from './frame';
import { createBoneLayouts } from './canonicalLayout';
import { lowerAssetFrameToBoneTransform } from './frameLower';
import type { InstantiatedBone } from './ir';
import { addIssue, vector, type Location } from './canonicalSupport';

export interface BonePlan {
  readonly bones: readonly BoneNode[];
  readonly roots: readonly EntityId[];
  readonly semanticToId: ReadonlyMap<string, string>;
}

interface BoneIndex {
  readonly byId: Map<string, InstantiatedBone>;
  readonly semantic: Map<string, InstantiatedBone>;
}

type BoneParents = Map<string, string | null>;

const boneLocation = (bone: InstantiatedBone): Location => ({
  path: bone.sourcePath,
  span: bone.span,
});

const axis = (source: Vec3): Vec3 => vector(source[0], source[1], source[2]);

const makeCanonicalFrame = (
  bone: InstantiatedBone,
  rotation: Vec3,
  origin: Vec3,
): Readonly<NonNullable<BoneNode['canonicalFrame']>> =>
  freeze({
    origin,
    xAxis: axis(bone.parentRestFrame.xAxis),
    yAxis: axis(bone.parentRestFrame.yAxis),
    zAxis: axis(bone.parentRestFrame.zAxis),
    determinant: bone.parentRestFrame.determinant,
    rotation,
  });

const lowerBone = (
  bone: InstantiatedBone,
  parentId: string | null,
  canonicalLayout: AssetExactFrame,
  diagnostics: AssetDiagnostic[],
): BoneNode | null => {
  const location = boneLocation(bone);
  const transform = lowerAssetFrameToBoneTransform(canonicalLayout);
  if (transform === null) {
    addIssue(
      diagnostics,
      location,
      'asset.invalid-rest-frame',
      `Bone "${bone.semanticJoint}" has no canonical transform.`,
    );
    return null;
  }
  const origin = vector(transform.pivot[0], transform.pivot[1], transform.pivot[2]);
  const rotation = vector(transform.rotation[0], transform.rotation[1], transform.rotation[2]);
  const node: BoneNode = {
    id: bone.id as EntityId,
    kind: 'bone',
    name: bone.semanticJoint,
    parentId: parentId as EntityId | null,
    transform,
    visible: true,
    canonicalFrame: makeCanonicalFrame(bone, rotation, origin),
  };
  sealCanonicalBoneFrame(node);
  const frozen = deepFreeze(node);
  if (!boneTransformMatchesCanonicalFrame(frozen)) {
    addIssue(
      diagnostics,
      location,
      'asset.canonical-frame',
      `Bone "${bone.semanticJoint}" failed canonical frame sealing.`,
    );
    return null;
  }
  return frozen;
};

const hasBoneIdentity = (bone: InstantiatedBone): boolean =>
  typeof bone.id === 'string' &&
  bone.id.length > 0 &&
  typeof bone.semanticJoint === 'string' &&
  bone.semanticJoint.length > 0;

const indexBone = (
  bone: InstantiatedBone,
  index: BoneIndex,
  diagnostics: AssetDiagnostic[],
): void => {
  const location = boneLocation(bone);
  if (index.byId.has(bone.id)) {
    addIssue(
      diagnostics,
      location,
      'asset.duplicate-bone-id',
      `Bone identifier "${bone.id}" is declared more than once.`,
    );
  } else index.byId.set(bone.id, bone);
  if (index.semantic.has(bone.semanticJoint)) {
    addIssue(
      diagnostics,
      location,
      'asset.duplicate-semantic-joint',
      `Semantic joint "${bone.semanticJoint}" is ambiguous.`,
    );
  } else index.semantic.set(bone.semanticJoint, bone);
};

const indexBones = (
  bones: readonly InstantiatedBone[],
  diagnostics: AssetDiagnostic[],
): BoneIndex => {
  const index: BoneIndex = { byId: new Map(), semantic: new Map() };
  for (const bone of bones) {
    if (hasBoneIdentity(bone)) {
      indexBone(bone, index, diagnostics);
      continue;
    }
    addIssue(
      diagnostics,
      boneLocation(bone),
      'asset.invalid-bone-id',
      'Canonical bones require non-empty semantic and emitted identifiers.',
    );
  }
  return index;
};

const resolveParent = (
  bone: InstantiatedBone,
  index: BoneIndex,
  diagnostics: AssetDiagnostic[],
): string | null => {
  if (bone.parentId === null) return null;
  const parent = index.semantic.get(bone.parentId) ?? index.byId.get(bone.parentId);
  if (parent !== undefined) return parent.id;
  addIssue(
    diagnostics,
    boneLocation(bone),
    'asset.missing-bone-parent',
    `Bone "${bone.id}" names missing parent "${bone.parentId}".`,
  );
  return null;
};

const resolveParents = (index: BoneIndex, diagnostics: AssetDiagnostic[]): BoneParents => {
  const parents: BoneParents = new Map();
  for (const bone of index.byId.values()) {
    if (bone.parentId !== null && typeof bone.parentId !== 'string') {
      addIssue(
        diagnostics,
        boneLocation(bone),
        'asset.invalid-bone-parent',
        `Bone "${bone.id}" has an invalid parent identifier.`,
      );
      continue;
    }
    parents.set(bone.id, resolveParent(bone, index, diagnostics));
  }
  return parents;
};

const visitBoneAncestry = (
  id: string,
  state: Map<string, 0 | 1 | 2>,
  byId: ReadonlyMap<string, InstantiatedBone>,
  parents: BoneParents,
  diagnostics: AssetDiagnostic[],
): void => {
  const current = state.get(id);
  if (current === 1) {
    addIssue(
      diagnostics,
      boneLocation(byId.get(id)!),
      'asset.bone-cycle',
      'Canonical bone parents must form an acyclic tree.',
    );
    return;
  }
  if (current === 2) return;
  state.set(id, 1);
  const parent = parents.get(id);
  if (parent !== null && parent !== undefined) {
    visitBoneAncestry(parent, state, byId, parents, diagnostics);
  }
  state.set(id, 2);
};

const reportBoneCycles = (
  byId: ReadonlyMap<string, InstantiatedBone>,
  parents: BoneParents,
  diagnostics: AssetDiagnostic[],
): void => {
  const state = new Map<string, 0 | 1 | 2>();
  for (const id of [...byId.keys()].sort(compareText)) {
    visitBoneAncestry(id, state, byId, parents, diagnostics);
  }
};

const lowerBoneNodes = (
  byId: ReadonlyMap<string, InstantiatedBone>,
  parents: BoneParents,
  diagnostics: AssetDiagnostic[],
): BoneNode[] => {
  // Canonical runtimes subtract parent pivots to recover the local translation.
  // Accumulate offsets without rotating them here; parent rotation/scale is
  // applied exactly once by the runtime hierarchy, just as in socket frames.
  const layout = createBoneLayouts(byId, parents);
  const lowered: BoneNode[] = [];
  for (const id of [...byId.keys()].sort(compareText)) {
    const bone = byId.get(id)!;
    const canonicalLayout = layout(id);
    if (canonicalLayout === null) {
      addIssue(
        diagnostics,
        boneLocation(bone),
        'asset.invalid-rest-frame',
        `Bone "${id}" has an invalid parent-relative rest frame.`,
      );
      continue;
    }
    const node = lowerBone(bone, parents.get(id) ?? null, canonicalLayout, diagnostics);
    if (node !== null) lowered.push(node);
  }
  return lowered;
};

/** Lower validated instantiated bones into sealed canonical bone nodes. */
export const lowerBones = (
  bones: readonly InstantiatedBone[],
  diagnostics: AssetDiagnostic[],
): BonePlan | null => {
  const index = indexBones(bones, diagnostics);
  const parents = resolveParents(index, diagnostics);
  reportBoneCycles(index.byId, parents, diagnostics);
  if (diagnostics.length > 0) return null;
  const lowered = lowerBoneNodes(index.byId, parents, diagnostics);
  lowered.sort((left, right) => compareText(left.id, right.id));
  const roots = lowered
    .filter((bone) => bone.parentId === null)
    .map((bone) => bone.id)
    .sort(compareText);
  return deepFreeze({
    bones: deepFreeze(lowered),
    roots: deepFreeze(roots),
    semanticToId: new Map([...index.semantic.entries()].map(([name, bone]) => [name, bone.id])),
  });
};
