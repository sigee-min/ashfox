import * as THREE from 'three';

import type { CompiledModel, StructureProduct } from '@ashfox/engine-core';

import { createObservationDiorama } from './diorama';
import { appendBakedBatches } from './structureMaterials';
import { appendCustomInstances, appendWarmPointLights } from './structureProps';

export type BakedMesh = StructureProduct['bakedMesh'];
export type BakedBatch = BakedMesh['batches'][number];
export type PropInstance = BakedMesh['instances'][number];
export type PlayableMeta = StructureProduct['playableMeta'];
export type FloorMeta = StructureProduct['grid']['floors'][number];
export type RoomMeta = StructureProduct['grid']['rooms'][number];

export interface StructureObservationSlice {
  readonly label: string;
  readonly cutY: number;
  readonly bakedMesh?: BakedMesh;
}

export interface StructureObservationPayload {
  readonly id: string;
  readonly size: readonly [number, number, number];
  readonly bakedMesh: BakedMesh;
  readonly customModels: Readonly<Record<string, CompiledModel>>;
  readonly playableMeta: PlayableMeta;
  readonly floors: readonly FloorMeta[];
  readonly rooms: readonly RoomMeta[];
  readonly cutSlices?: readonly StructureObservationSlice[];
}

export interface StructureSceneBuildOptions {
  readonly bakedMesh?: BakedMesh;
  readonly twilight?: boolean;
  readonly interiorFill?: boolean;
  readonly clipY?: number;
  readonly dioramaBase?: boolean;
}

export interface StructureSceneHandle {
  readonly root: THREE.Group;
  readonly bounds: THREE.Box3;
  readonly dispose: () => void;
}

const appendStructureGeometry = async (
  root: THREE.Group,
  payload: StructureObservationPayload,
  activeMesh: BakedMesh,
  options: StructureSceneBuildOptions,
  disposables: (() => void)[],
  signal: AbortSignal,
): Promise<void> => {
  const clipPlanes =
    options.clipY !== undefined && options.bakedMesh === undefined
      ? [new THREE.Plane(new THREE.Vector3(0, -1, 0), options.clipY - 0.05)]
      : null;
  if (activeMesh.batches.length > 0) {
    appendBakedBatches(root, activeMesh, options.twilight ?? false, clipPlanes, disposables);
  }
  if (activeMesh.instances.length > 0) {
    await appendCustomInstances(
      root,
      activeMesh,
      payload.customModels,
      options.clipY,
      disposables,
      signal,
    );
  }
};

/** Builds a Three.js renderable group for StructureBakedMesh. */
export const buildStructureScene = async (
  payload: StructureObservationPayload,
  options: StructureSceneBuildOptions,
  signal: AbortSignal,
): Promise<StructureSceneHandle> => {
  const root = new THREE.Group();
  root.name = 'ashfoxStructureScene';
  const disposables: (() => void)[] = [];
  const activeMesh = options.bakedMesh ?? payload.bakedMesh;
  await appendStructureGeometry(root, payload, activeMesh, options, disposables, signal);
  appendWarmPointLights(root, payload.playableMeta, activeMesh, options);
  root.updateMatrixWorld(true);
  const [w, h, d] = payload.size;
  const bounds = new THREE.Box3().setFromObject(root);
  if (bounds.isEmpty()) {
    bounds.set(new THREE.Vector3(-w / 2, 0, -d / 2), new THREE.Vector3(w / 2, h, d / 2));
  }
  const attachDiorama =
    options.dioramaBase ?? (options.clipY === undefined && !options.interiorFill);
  if (attachDiorama) {
    root.add(
      createObservationDiorama(
        payload.size,
        payload.playableMeta,
        options.twilight ?? false,
        disposables,
      ),
    );
    root.updateMatrixWorld(true);
  }
  return {
    root,
    bounds,
    dispose: () => {
      for (const fn of disposables) fn();
    },
  };
};

const updateCastingShadowLight = (
  child: THREE.DirectionalLight,
  center: THREE.Vector3,
  halfExtent: number,
  twilight: boolean,
): void => {
  child.intensity = twilight ? 1.35 : 2.15;
  child.color.set(twilight ? '#c0d6ff' : '#fff5e6');
  if (child.shadow.mapSize.width !== 2048) {
    child.shadow.mapSize.set(2048, 2048);
    child.shadow.map?.dispose();
    child.shadow.map = null;
  }
  child.shadow.camera.left = -halfExtent;
  child.shadow.camera.right = halfExtent;
  child.shadow.camera.top = halfExtent;
  child.shadow.camera.bottom = -halfExtent;
  child.shadow.camera.near = 0.5;
  child.shadow.camera.far = Math.max(96, halfExtent * 4.5);
  child.shadow.bias = -0.0008;
  child.shadow.normalBias = 0.025;
  child.shadow.camera.updateProjectionMatrix();
  child.position
    .copy(center)
    .add(new THREE.Vector3(halfExtent * 0.65, halfExtent * 1.15, -halfExtent * 0.75));
  child.target.position.copy(center);
  child.target.updateMatrixWorld();
};

/** Creates a deep evening dusk gradient sky texture for twilight exterior renders. */
export const createTwilightSkyTexture = (): THREE.CanvasTexture => {
  const canvas = window.document.createElement('canvas');
  canvas.width = 16;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Sky canvas is unavailable.');
  const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
  grad.addColorStop(0, '#262b4f');
  grad.addColorStop(0.58, '#5d446c');
  grad.addColorStop(1, '#d98c58');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  return texture;
};

const applyAmbientOrFillLight = (child: THREE.Object3D, twilight: boolean): void => {
  if (child instanceof THREE.HemisphereLight) {
    child.color.set(twilight ? '#7a96dc' : '#edf3ff');
    child.groundColor.set(twilight ? '#4c3e61' : '#6c7686');
    child.intensity = twilight ? 1.65 : 1.55;
  } else if (child instanceof THREE.DirectionalLight && !child.castShadow) {
    child.color.set(twilight ? '#809ad8' : '#d8e6ff');
    child.intensity = twilight ? 0.95 : 0.95;
  }
};

/** Configures directional shadow frustum dynamically for structures up to 96m. */
export const frameStructureShadows = (
  scene: THREE.Scene,
  bounds: THREE.Box3,
  twilight: boolean,
): void => {
  const sphere = bounds.getBoundingSphere(new THREE.Sphere());
  const halfExtent = Math.min(96, Math.max(8, sphere.radius * 1.15));
  for (const child of scene.children) {
    if (child instanceof THREE.DirectionalLight && child.castShadow) {
      updateCastingShadowLight(child, sphere.center, halfExtent, twilight);
    } else {
      applyAmbientOrFillLight(child, twilight);
    }
  }
};
