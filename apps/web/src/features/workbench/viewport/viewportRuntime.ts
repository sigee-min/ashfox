import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

import type { ProjectSceneProjection } from '@ashfox/render-core/sceneTypes';
import type { CameraCommand } from './viewportTypes';
import { applyCameraPreset } from '@ashfox/render-core/cameraPresets';
import type { ProjectForwardDirection } from '@ashfox/engine-core';
import {
  addViewportLighting,
  createViewportEnvironment,
  type ViewportEnvironment,
  type ViewportEnvironmentId
} from '@ashfox/render-core/viewportEnvironment';

export interface ViewportRuntime {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  orbit: OrbitControls;
  projection: ProjectSceneProjection | null;
  environment: ViewportEnvironment;
  grid: THREE.GridHelper;
  pointerStart: THREE.Vector2;
}

export const createViewportRuntime = (
  canvas: HTMLCanvasElement,
  environmentId: ViewportEnvironmentId = 'studio'
): ViewportRuntime => {
  const scene = new THREE.Scene();
  const environment = createViewportEnvironment(environmentId);
  scene.background = environment.background;
  scene.fog = environment.fog;

  const camera = new THREE.PerspectiveCamera(42, 1, 0.05, 300);
  camera.position.set(30, 23, -35);

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
    powerPreference: 'high-performance'
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  const orbit = new OrbitControls(camera, canvas);
  orbit.target.set(0, 12, 0);
  orbit.enableDamping = true;
  orbit.dampingFactor = 0.08;
  orbit.minDistance = 8;
  orbit.maxDistance = 240;
  orbit.update();

  const grid = new THREE.GridHelper(64, 64, '#49515a', '#2b3138');
  grid.material.transparent = true;
  grid.material.opacity = 0.62;
  scene.add(grid);

  addViewportLighting(scene);

  return {
    renderer,
    scene,
    camera,
    orbit,
    projection: null,
    environment,
    grid,
    pointerStart: new THREE.Vector2()
  };
};

const disposeMaterials = (
  material: THREE.Material | THREE.Material[]
): void => {
  const materials = Array.isArray(material) ? material : [material];
  for (const entry of materials) entry.dispose();
};

export const disposeViewportRuntime = (
  runtime: ViewportRuntime
): void => {
  runtime.orbit.dispose();
  runtime.projection?.dispose();
  runtime.grid.geometry.dispose();
  disposeMaterials(runtime.grid.material);
  runtime.environment.dispose();
  runtime.renderer.dispose();
};

export const applyViewportEnvironment = (
  runtime: ViewportRuntime,
  environmentId: ViewportEnvironmentId
): void => {
  if (runtime.environment.id === environmentId) return;
  runtime.environment.dispose();
  runtime.environment = createViewportEnvironment(environmentId);
  runtime.scene.background = runtime.environment.background;
  runtime.scene.fog = runtime.environment.fog;
  runtime.grid.material.opacity = environmentId === 'studio' ? 0.62 : 0.14;
};

export const applyCameraCommand = (
  runtime: ViewportRuntime,
  command: CameraCommand,
  forward: ProjectForwardDirection = 'north'
): void => {
  const target = applyCameraPreset(
    runtime.camera,
    command.mode,
    runtime.projection?.root,
    forward
  );
  runtime.orbit.target.copy(target);
  runtime.orbit.update();
};
