import * as THREE from 'three';

export const BACKDROP_PRESETS = Object.freeze(['obsidian', 'slate', 'light']);

const BACKDROP_CONFIG = Object.freeze({
  obsidian: { background: null, fogColor: null, gridMain: 0x3b4352, gridSub: 0x252b36 },
  slate: { background: '#1e2531', fogColor: '#1e2531', gridMain: 0x4c586b, gridSub: 0x2f3847 },
  light: { background: '#e3e8f0', fogColor: '#e3e8f0', gridMain: 0x8e99aa, gridSub: 0xc2cbd8 },
});

const disposeObjectResources = (root) => {
  if (!root) return;
  const textureKeys = [
    'map',
    'normalMap',
    'roughnessMap',
    'metalnessMap',
    'emissiveMap',
    'aoMap',
    'alphaMap',
    'bumpMap',
    'specularMap',
  ];
  root.traverse((obj) => {
    if (obj.geometry) obj.geometry.dispose();
    const mats = Array.isArray(obj.material) ? obj.material : obj.material ? [obj.material] : [];
    for (const mat of mats) {
      for (const key of textureKeys) {
        if (mat[key]?.dispose) mat[key].dispose();
      }
      mat.dispose?.();
    }
  });
};

const createRadialContactTexture = () => {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const grad = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(6, 9, 14, 0.28)');
  grad.addColorStop(0.55, 'rgba(6, 9, 14, 0.11)');
  grad.addColorStop(1, 'rgba(6, 9, 14, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  return tex;
};

export const createStudioStage = (scene, renderer, host) => {
  const hemi = new THREE.HemisphereLight('#e2eaf8', '#464e5c', 0.85);
  const key = new THREE.DirectionalLight('#fff5e6', 1.85);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.bias = -0.0005;
  key.shadow.normalBias = 0.02;

  const fill = new THREE.DirectionalLight('#b8d0f4', 0.75);
  const rim = new THREE.DirectionalLight('#f29b68', 1.15);

  scene.add(hemi, key, key.target, fill, fill.target, rim, rim.target);

  let groundGroup = null;
  let gridHelper = null;
  let activeBounds = null;
  let activeDomain = 'model';
  let activeBackdrop = 'obsidian';
  let gridVisible = false;
  let wireframeEnabled = false;
  let activeModelRoot = null;
  const originalWireframes = new WeakMap();

  const applyBackdrop = (preset) => {
    const next = BACKDROP_CONFIG[preset] ? preset : 'obsidian';
    activeBackdrop = next;
    const cfg = BACKDROP_CONFIG[next];
    host.dataset.viewerBackdrop = next;

    if (cfg.background === null) {
      scene.background = null;
      scene.fog = null;
      renderer.setClearColor(0x000000, 0);
    } else {
      scene.background = new THREE.Color(cfg.background);
      renderer.setClearColor(cfg.background, 1);
      const radius = activeBounds
        ? Math.max(1, activeBounds.getSize(new THREE.Vector3()).length() * 0.5)
        : 4;
      scene.fog = new THREE.Fog(cfg.fogColor, radius * 10, radius * 28);
    }
    rebuildGrid();
    return activeBackdrop;
  };

  const rebuildGround = (bounds) => {
    if (groundGroup) {
      scene.remove(groundGroup);
      disposeObjectResources(groundGroup);
      groundGroup = null;
    }
    if (!bounds || bounds.isEmpty()) return;

    const center = bounds.getCenter(new THREE.Vector3());
    const size = bounds.getSize(new THREE.Vector3());
    const footprint = Math.max(size.x, size.z, 1.4);
    const y = bounds.min.y - 0.002;

    const group = new THREE.Group();
    group.name = 'ashfoxStudioGround';
    group.visible = activeDomain !== 'vfx';

    const contactTex = createRadialContactTexture();
    if (contactTex) {
      const discGeo = new THREE.CircleGeometry(footprint * 0.75, 48);
      const discMat = new THREE.MeshBasicMaterial({
        map: contactTex,
        transparent: true,
        depthWrite: false,
        toneMapped: false,
      });
      const disc = new THREE.Mesh(discGeo, discMat);
      disc.rotation.x = -Math.PI / 2;
      disc.position.set(center.x, y - 0.001, center.z);
      group.add(disc);
    }

    const catcherGeo = new THREE.PlaneGeometry(footprint * 3.4, footprint * 3.4);
    const catcherMat = new THREE.ShadowMaterial({
      color: 0x05080d,
      opacity: 0.32,
      depthWrite: false,
    });
    const catcher = new THREE.Mesh(catcherGeo, catcherMat);
    catcher.rotation.x = -Math.PI / 2;
    catcher.position.set(center.x, y, center.z);
    catcher.receiveShadow = true;
    group.add(catcher);

    groundGroup = group;
    scene.add(groundGroup);
  };

  const rebuildGrid = () => {
    if (gridHelper) {
      scene.remove(gridHelper);
      disposeObjectResources(gridHelper);
      gridHelper = null;
    }
    if (!activeBounds || activeBounds.isEmpty()) return;

    const center = activeBounds.getCenter(new THREE.Vector3());
    const size = activeBounds.getSize(new THREE.Vector3());
    const footprint = Math.max(size.x, size.z, 1);
    const gridSize = Math.max(2, Math.ceil(footprint * 2.4));
    const divisions = Math.min(24, Math.max(8, Math.round(gridSize * 2)));
    const cfg = BACKDROP_CONFIG[activeBackdrop];
    const grid = new THREE.GridHelper(gridSize, divisions, cfg.gridMain, cfg.gridSub);
    grid.position.set(center.x, activeBounds.min.y - 0.001, center.z);
    grid.visible = gridVisible;
    const mats = Array.isArray(grid.material) ? grid.material : [grid.material];
    for (const mat of mats) {
      mat.transparent = true;
      mat.opacity = activeBackdrop === 'light' ? 0.5 : 0.65;
    }
    gridHelper = grid;
    scene.add(gridHelper);
  };

  const applyWireframe = (enabled) => {
    wireframeEnabled = Boolean(enabled);
    if (!activeModelRoot) return wireframeEnabled;
    activeModelRoot.traverse((obj) => {
      if (!obj.isMesh || !obj.material) return;
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const mat of mats) {
        if (!originalWireframes.has(mat)) {
          originalWireframes.set(mat, Boolean(mat.wireframe));
        }
        mat.wireframe = wireframeEnabled ? true : originalWireframes.get(mat);
      }
    });
    return wireframeEnabled;
  };

  const calibrateLighting = (bounds) => {
    const center = bounds.getCenter(new THREE.Vector3());
    const radius = Math.max(0.25, bounds.getSize(new THREE.Vector3()).length() * 0.5);
    const span = Math.max(radius * 1.45, 1.5);

    key.position.set(center.x + span * 0.85, center.y + span * 1.4, center.z - span * 0.95);
    key.target.position.copy(center);
    key.target.updateMatrixWorld();
    key.shadow.camera.left = -span;
    key.shadow.camera.right = span;
    key.shadow.camera.top = span;
    key.shadow.camera.bottom = -span;
    key.shadow.camera.near = Math.max(0.05, span * 0.1);
    key.shadow.camera.far = Math.max(12, span * 5);
    key.shadow.camera.updateProjectionMatrix();

    fill.position.set(center.x - span * 1.1, center.y + span * 0.7, center.z - span * 0.65);
    fill.target.position.copy(center);
    fill.target.updateMatrixWorld();

    rim.position.set(center.x - span * 0.75, center.y + span * 1.1, center.z + span * 1.15);
    rim.target.position.copy(center);
    rim.target.updateMatrixWorld();
  };

  const attachModel = (modelRoot, domain = 'model') => {
    activeModelRoot = modelRoot;
    activeDomain = domain || 'model';
    const isVfx = activeDomain === 'vfx';

    modelRoot.updateMatrixWorld(true);
    modelRoot.traverse((obj) => {
      if (!obj.isMesh) return;
      const mats = Array.isArray(obj.material) ? obj.material : obj.material ? [obj.material] : [];
      const isAdditive = mats.some((m) => m.blending === THREE.AdditiveBlending);
      obj.castShadow = !isVfx && !isAdditive;
      obj.receiveShadow = !isVfx && !isAdditive;
    });

    const bounds = new THREE.Box3().setFromObject(modelRoot);
    activeBounds = bounds.isEmpty()
      ? new THREE.Box3(new THREE.Vector3(-0.5, 0, -0.5), new THREE.Vector3(0.5, 1, 0.5))
      : bounds;

    calibrateLighting(activeBounds);
    rebuildGround(activeBounds);
    applyBackdrop(activeBackdrop);
    applyWireframe(wireframeEnabled);
    return activeBounds;
  };

  const setGrid = (visible) => {
    gridVisible = Boolean(visible);
    if (gridHelper) gridHelper.visible = gridVisible;
    return gridVisible;
  };

  const disposeModel = (root) => {
    if (root === activeModelRoot) activeModelRoot = null;
    disposeObjectResources(root);
  };

  applyBackdrop('obsidian');

  return {
    attachModel,
    disposeModel,
    setBackdrop: applyBackdrop,
    setGrid,
    setWireframe: applyWireframe,
    getState: () => ({
      backdrop: activeBackdrop,
      grid: gridVisible,
      wireframe: wireframeEnabled,
    }),
    dispose: () => {
      if (groundGroup) {
        scene.remove(groundGroup);
        disposeObjectResources(groundGroup);
        groundGroup = null;
      }
      if (gridHelper) {
        scene.remove(gridHelper);
        disposeObjectResources(gridHelper);
        gridHelper = null;
      }
      activeModelRoot = null;
      activeBounds = null;
    },
  };
};
