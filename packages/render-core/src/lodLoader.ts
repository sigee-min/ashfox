import * as THREE from 'three';

export interface AshfoxLodMetadata {
  readonly distances: readonly number[];
  readonly hysteresis?: number;
  readonly boundingSphere?: readonly [number, number, number, number];
}

export interface CreateAshfoxLodOptions {
  readonly distances?: readonly number[];
  readonly hysteresis?: number;
  readonly autoUpdate?: boolean;
}

export interface AshfoxLodState {
  currentLevel: number;
  lastDistance: number;
  readonly distances: readonly number[];
  readonly hysteresis: number;
  readonly boundingSphere?: readonly [number, number, number, number];
}

const DEFAULT_DISTANCES: readonly number[] = [0, 18, 45];
const DEFAULT_HYSTERESIS = 2.5;
const LOD_SUFFIX_RE = /_LOD([0-9]+)$/i;

const readAshfoxLodMetadata = (root: THREE.Object3D): AshfoxLodMetadata | undefined => {
  const direct = (root.userData as { ashfox?: { lod?: AshfoxLodMetadata } })?.ashfox?.lod;
  if (direct && Array.isArray(direct.distances)) return direct;
  for (const child of root.children) {
    const nested = (child.userData as { ashfox?: { lod?: AshfoxLodMetadata } })?.ashfox?.lod;
    if (nested && Array.isArray(nested.distances)) return nested;
  }
  return undefined;
};

const collectLodTiers = (root: THREE.Object3D): { tier: number; object: THREE.Object3D }[] => {
  const found: { tier: number; object: THREE.Object3D }[] = [];
  const scan = (parent: THREE.Object3D): void => {
    for (const child of parent.children) {
      const match = LOD_SUFFIX_RE.exec(child.name);
      if (match) {
        found.push({ tier: Number(match[1]), object: child });
      }
    }
  };
  scan(root);
  if (found.length === 0) {
    for (const child of root.children) scan(child);
  }
  return found.sort((a, b) => a.tier - b.tier);
};

export const createAshfoxLod = (
  gltfScene: THREE.Object3D,
  options: CreateAshfoxLodOptions = {},
): THREE.LOD => {
  const meta = readAshfoxLodMetadata(gltfScene);
  const distances = options.distances ?? meta?.distances ?? DEFAULT_DISTANCES;
  const hysteresis = options.hysteresis ?? meta?.hysteresis ?? DEFAULT_HYSTERESIS;
  const tiers = collectLodTiers(gltfScene);
  const lod = new THREE.LOD();
  lod.name = gltfScene.name ? `${gltfScene.name}_lod` : 'ashfox_lod';
  if (options.autoUpdate !== undefined) lod.autoUpdate = options.autoUpdate;

  if (tiers.length === 0) {
    lod.addLevel(gltfScene, distances[0] ?? 0);
  } else {
    const tierObjects = new Set(tiers.map((entry) => entry.object));
    const tierParent = tiers[0]!.object.parent ?? gltfScene;
    const nonTierSiblings = tierParent.children.filter((child) => !tierObjects.has(child));
    tiers.forEach((entry, index) => {
      const dist = distances[entry.tier] ?? distances[index] ?? index * 25;
      lod.addLevel(entry.object, dist, hysteresis);
      entry.object.visible = index === 0;
    });
    for (const sibling of nonTierSiblings) lod.add(sibling);
  }

  const state: AshfoxLodState = {
    currentLevel: 0,
    lastDistance: 0,
    distances: [...distances],
    hysteresis,
    ...(meta?.boundingSphere ? { boundingSphere: meta.boundingSphere } : {}),
  };
  (lod.userData as { ashfoxLodState?: AshfoxLodState }).ashfoxLodState = state;
  return lod;
};

const tmpWorldCenter = new THREE.Vector3();

const resolveNextLodLevel = (
  current: number,
  distance: number,
  thresholds: readonly number[],
  deadband: number,
): number => {
  let next = current;
  while (next + 1 < thresholds.length && distance >= thresholds[next + 1]!) {
    next += 1;
  }
  while (next > 0 && distance < thresholds[next]! - deadband) {
    next -= 1;
  }
  return next;
};

export const updateAshfoxLodWithHysteresis = (
  lod: THREE.LOD,
  cameraPos: THREE.Vector3,
  hysteresis?: number,
): number => {
  const state = (lod.userData as { ashfoxLodState?: AshfoxLodState }).ashfoxLodState;
  const thresholds = state?.distances.length
    ? state.distances
    : lod.levels.map((level) => level.distance);
  if (lod.levels.length === 0) return 0;

  lod.updateMatrixWorld();
  if (state?.boundingSphere) {
    const [cx, cy, cz] = state.boundingSphere;
    tmpWorldCenter.set(cx, cy, cz).applyMatrix4(lod.matrixWorld);
  } else {
    lod.getWorldPosition(tmpWorldCenter);
  }

  const distance = tmpWorldCenter.distanceTo(cameraPos);
  const deadband = Math.max(0, hysteresis ?? state?.hysteresis ?? DEFAULT_HYSTERESIS);
  const current = Math.min(state?.currentLevel ?? lod.getCurrentLevel(), lod.levels.length - 1);
  const next = resolveNextLodLevel(current, distance, thresholds, deadband);

  for (let i = 0; i < lod.levels.length; i += 1) {
    lod.levels[i]!.object.visible = i === next;
  }
  if (state) {
    state.currentLevel = next;
    state.lastDistance = distance;
  }
  return next;
};
