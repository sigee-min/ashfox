import * as THREE from 'three';

const LOD_NAME_RE = /(?:^|_)LOD([0-2])$/i;
const HYSTERESIS = 0.35;

const isObjectVisible = (obj) => {
  let curr = obj;
  while (curr) {
    if (!curr.visible) return false;
    curr = curr.parent;
  }
  return true;
};

export const measureVisibleGeometry = (root) => {
  if (!root) return { triangles: 0, vertices: 0 };
  let triangles = 0;
  let vertices = 0;
  root.traverse((obj) => {
    if (!obj.isMesh || !obj.geometry || !isObjectVisible(obj)) return;
    const pos = obj.geometry.attributes?.position;
    if (!pos) return;
    const count = obj.isInstancedMesh ? obj.count : 1;
    const meshVerts = pos.count * count;
    const meshTris = obj.geometry.index
      ? Math.round((obj.geometry.index.count / 3) * count)
      : Math.round((pos.count / 3) * count);
    vertices += meshVerts;
    triangles += meshTris;
  });
  return { triangles, vertices };
};

const collectLodGroups = (root) => {
  const tiers = new Map();
  if (!root) return tiers;
  root.traverse((obj) => {
    const match = LOD_NAME_RE.exec(obj.name || '');
    if (!match) return;
    const label = `LOD${match[1]}`;
    const list = tiers.get(label) || [];
    list.push(obj);
    tiers.set(label, list);
  });
  return tiers;
};

const normalizeMode = (mode) => {
  if (mode === 'auto' || mode == null) return 'auto';
  const upper = String(mode).toUpperCase();
  if (upper === 'LOD0' || upper === '0') return 'LOD0';
  if (upper === 'LOD1' || upper === '1') return 'LOD1';
  if (upper === 'LOD2' || upper === '2') return 'LOD2';
  return 'auto';
};

export const createLodController = () => {
  let modelRoot = null;
  let tiers = new Map();
  let availableLods = [];
  let lodMode = 'auto';
  let activeLod = null;
  let center = new THREE.Vector3();
  let radius = 1;
  let stats = { triangles: 0, vertices: 0 };

  const applyTierVisibility = (targetLabel) => {
    if (!availableLods.length) {
      activeLod = null;
      stats = measureVisibleGeometry(modelRoot);
      return false;
    }
    const resolved = tiers.has(targetLabel) ? targetLabel : availableLods[0];
    const changed = activeLod !== resolved;
    for (const [label, nodes] of tiers.entries()) {
      const visible = label === resolved;
      for (const node of nodes) node.visible = visible;
    }
    activeLod = resolved;
    stats = measureVisibleGeometry(modelRoot);
    return changed;
  };

  const resolveAutoTier = (cameraPos) => {
    if (availableLods.length <= 1) return availableLods[0] || null;
    const ratio = cameraPos.distanceTo(center) / Math.max(radius, 0.001);
    const has1 = tiers.has('LOD1');
    const has2 = tiers.has('LOD2');

    if (activeLod === 'LOD2' && has2) {
      if (ratio >= 8.5 - HYSTERESIS) return 'LOD2';
    } else if (has2 && ratio >= 8.5 + HYSTERESIS) {
      return 'LOD2';
    }

    if (activeLod === 'LOD1' && has1) {
      if (ratio >= 4.2 - HYSTERESIS) return 'LOD1';
    } else if (has1 && ratio >= 4.2 + HYSTERESIS) {
      return 'LOD1';
    }

    return availableLods[0];
  };

  const attachModel = (root, bounds) => {
    modelRoot = root;
    tiers = collectLodGroups(root);
    availableLods = ['LOD0', 'LOD1', 'LOD2'].filter((label) => tiers.has(label));
    center = bounds.getCenter(new THREE.Vector3());
    radius = Math.max(0.25, bounds.getSize(new THREE.Vector3()).length() * 0.5);
    lodMode = 'auto';
    activeLod = null;
    applyTierVisibility(availableLods[0] || null);
  };

  const setLod = (mode) => {
    lodMode = normalizeMode(mode);
    if (!availableLods.length) {
      lodMode = 'auto';
      return getState();
    }
    if (lodMode !== 'auto') {
      applyTierVisibility(lodMode);
    } else {
      applyTierVisibility(availableLods[0]);
    }
    return getState();
  };

  const update = (cameraPos) => {
    if (lodMode !== 'auto' || availableLods.length <= 1) return false;
    const next = resolveAutoTier(cameraPos);
    if (!next || next === activeLod) return false;
    return applyTierVisibility(next);
  };

  const getState = () => ({
    lodMode,
    activeLod,
    availableLods: [...availableLods],
    triangles: stats.triangles,
    vertices: stats.vertices,
  });

  const reset = () => {
    modelRoot = null;
    tiers = new Map();
    availableLods = [];
    lodMode = 'auto';
    activeLod = null;
    stats = { triangles: 0, vertices: 0 };
  };

  return {
    attachModel,
    setLod,
    update,
    getState,
    reset,
  };
};
