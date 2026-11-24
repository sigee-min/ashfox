import {
  SessionState,
  TrackedAnimation,
  TrackedBone,
  TrackedCube,
  TrackedMesh,
  TrackedTexture,
} from '../../session';
import {
  ProjectDiffChange,
  ProjectDiffCounts,
  ProjectDiffCountsByKind,
  ProjectDiffEntry,
  ProjectDiffSet,
} from '@ashfox/blockbench-contracts/types/internal';
import {
  cloneTrackedAnimation,
  cloneTrackedBone,
  cloneTrackedCube,
  cloneTrackedMesh,
  cloneTrackedTexture,
} from './snapshotClone';
import {
  trackedAnimationProjection,
  trackedBoneProjection,
  trackedCubeProjection,
  trackedMeshProjection,
  trackedTextureProjection,
} from './snapshotProjection';

type MutableDiffSet<T> = {
  added: ProjectDiffEntry<T>[];
  removed: ProjectDiffEntry<T>[];
  changed: ProjectDiffChange<T>[];
};

type MutableCountsByKind = {
  -readonly [TKey in keyof ProjectDiffCountsByKind]: ProjectDiffCountsByKind[TKey];
};

type DiffOutput<T> = {
  counts: ProjectDiffCounts;
  items?: MutableDiffSet<T>;
};

const emptyCounts = (): ProjectDiffCounts => ({ added: 0, removed: 0, changed: 0 });

const cloneCounts = (counts: ProjectDiffCounts): ProjectDiffCounts => ({ ...counts });

const buildCounts = (added: number, removed: number, changed: number): ProjectDiffCounts => ({
  added,
  removed,
  changed,
});

const defaultCountsByKind = (): MutableCountsByKind => ({
  bones: emptyCounts(),
  cubes: emptyCounts(),
  meshes: emptyCounts(),
  textures: emptyCounts(),
  animations: emptyCounts(),
});

type KeyFn<T> = (item: T) => string;
type SigFn<T> = (item: T) => string;
type CloneFn<T> = (item: T) => T;

const diffByKey = <T>(
  previous: readonly T[],
  current: readonly T[],
  keyFn: KeyFn<T>,
  sigFn: SigFn<T>,
  cloneFn: CloneFn<T>,
  includeItems: boolean,
): DiffOutput<T> => {
  const prevMap = new Map<string, { item: T; sig: string }>();
  const currMap = new Map<string, { item: T; sig: string }>();
  previous.forEach((item) => {
    const key = keyFn(item);
    prevMap.set(key, { item, sig: sigFn(item) });
  });
  current.forEach((item) => {
    const key = keyFn(item);
    currMap.set(key, { item, sig: sigFn(item) });
  });

  let added = 0;
  let removed = 0;
  let changed = 0;

  const items: MutableDiffSet<T> | undefined = includeItems
    ? { added: [], removed: [], changed: [] }
    : undefined;

  currMap.forEach((entry, key) => {
    const prev = prevMap.get(key);
    if (!prev) {
      added += 1;
      if (items) items.added.push({ key, item: cloneFn(entry.item) });
      return;
    }
    if (prev.sig !== entry.sig) {
      changed += 1;
      if (items) {
        items.changed.push({
          key,
          before: cloneFn(prev.item),
          after: cloneFn(entry.item),
        });
      }
    }
  });

  prevMap.forEach((entry, key) => {
    if (!currMap.has(key)) {
      removed += 1;
      if (items) items.removed.push({ key, item: cloneFn(entry.item) });
    }
  });

  return { counts: buildCounts(added, removed, changed), items };
};

const boneKey = (bone: TrackedBone) => bone.id ?? bone.name;
const cubeKey = (cube: TrackedCube) => cube.id ?? `${cube.name}::${cube.bone}`;
const textureKey = (texture: TrackedTexture) => texture.id ?? texture.name;
const animationKey = (anim: TrackedAnimation) => anim.id ?? anim.name;
const meshKey = (mesh: TrackedMesh) => mesh.id ?? mesh.name;

const boneSig = (bone: TrackedBone) => JSON.stringify(trackedBoneProjection(bone));
const cubeSig = (cube: TrackedCube) => JSON.stringify(trackedCubeProjection(cube));
const textureSig = (texture: TrackedTexture) => JSON.stringify(trackedTextureProjection(texture));
const animationSig = (animation: TrackedAnimation) =>
  JSON.stringify(trackedAnimationProjection(animation));
const meshSig = (mesh: TrackedMesh) => JSON.stringify(trackedMeshProjection(mesh));

export const diffSnapshots = (
  previous: SessionState,
  current: SessionState,
  includeItems: boolean,
): {
  counts: ProjectDiffCountsByKind;
  sets?: {
    bones: ProjectDiffSet<TrackedBone>;
    cubes: ProjectDiffSet<TrackedCube>;
    meshes: ProjectDiffSet<TrackedMesh>;
    textures: ProjectDiffSet<TrackedTexture>;
    animations: ProjectDiffSet<TrackedAnimation>;
  };
} => {
  const counts = defaultCountsByKind();

  const bones = diffByKey(
    previous.bones,
    current.bones,
    boneKey,
    boneSig,
    cloneTrackedBone,
    includeItems,
  );
  const cubes = diffByKey(
    previous.cubes,
    current.cubes,
    cubeKey,
    cubeSig,
    cloneTrackedCube,
    includeItems,
  );
  const meshes = diffByKey(
    previous.meshes ?? [],
    current.meshes ?? [],
    meshKey,
    meshSig,
    cloneTrackedMesh,
    includeItems,
  );
  const textures = diffByKey(
    previous.textures,
    current.textures,
    textureKey,
    textureSig,
    cloneTrackedTexture,
    includeItems,
  );
  const animations = diffByKey(
    previous.animations,
    current.animations,
    animationKey,
    animationSig,
    cloneTrackedAnimation,
    includeItems,
  );

  counts.bones = cloneCounts(bones.counts);
  counts.cubes = cloneCounts(cubes.counts);
  counts.meshes = cloneCounts(meshes.counts);
  counts.textures = cloneCounts(textures.counts);
  counts.animations = cloneCounts(animations.counts);

  if (!includeItems) return { counts };

  const boneItems = bones.items;
  const cubeItems = cubes.items;
  const meshItems = meshes.items;
  const textureItems = textures.items;
  const animationItems = animations.items;
  if (!boneItems || !cubeItems || !meshItems || !textureItems || !animationItems) {
    return { counts };
  }
  return {
    counts,
    sets: {
      bones: boneItems,
      cubes: cubeItems,
      meshes: meshItems,
      textures: textureItems,
      animations: animationItems,
    },
  };
};
