import * as THREE from 'three';

import {
  PROJECT_DOCUMENT_SCHEMA_VERSION,
  type CompiledModel,
  type ProjectDocument,
  type StructureProduct,
} from '@ashfox/engine-core';

import { waitForProjectionTextures } from './captureSurface';
import { createObservationDiorama } from './diorama';
import { projectToThreeScene } from './projection';
import { createStructureTextureMap } from './sceneMaterials';

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

const VOXEL_MODEL_SCALE = 1 / 16;
const MAX_POINT_LIGHTS = 16;

const compiledModelToDocument = (model: CompiledModel): ProjectDocument => ({
  schemaVersion: PROJECT_DOCUMENT_SCHEMA_VERSION,
  id: model.id,
  name: model.name,
  revision: 'structure-prop',
  settings: {
    forward: model.forward,
    textureResolution: { width: model.textureResolution[0], height: model.textureResolution[1] },
    surfacePixelDensity: 1,
    coordinateSystem: {
      up: 'y',
      handedness: 'right',
      unit: 'pixel',
      rotationUnit: 'degree',
      rotationOrder: 'xyz',
    },
  },
  scene: model.scene,
  textures: model.textures,
  animations: model.animations,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

const buildBatchMaterial = (
  layer: BakedBatch['layer'],
  map: THREE.Texture | null,
  twilight: boolean,
  clipPlanes: THREE.Plane[] | null,
): THREE.MeshStandardMaterial => {
  const shared = {
    map,
    vertexColors: true,
    ...(clipPlanes ? { clippingPlanes: clipPlanes } : {}),
  };
  if (layer === 'cutout') {
    return new THREE.MeshStandardMaterial({
      ...shared,
      alphaTest: 0.5,
      transparent: false,
      depthWrite: true,
      roughness: 0.82,
      metalness: 0.04,
      side: THREE.DoubleSide,
    });
  }
  if (layer === 'emissive') {
    return new THREE.MeshStandardMaterial({
      ...shared,
      emissive: new THREE.Color('#ffbe66'),
      emissiveMap: map,
      emissiveIntensity: twilight ? 2.75 : 1.15,
      roughness: 0.45,
      metalness: 0.05,
      side: THREE.DoubleSide,
    });
  }
  return new THREE.MeshStandardMaterial({
    ...shared,
    roughness: 0.86,
    metalness: 0.04,
    side: THREE.FrontSide,
  });
};

const createBatchMesh = (
  batch: BakedBatch,
  material: THREE.MeshStandardMaterial,
  disposables: (() => void)[],
): THREE.Mesh => {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(batch.positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(batch.normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(batch.uvs, 2));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(batch.colors, 3));
  geometry.setIndex(batch.indices as number[]);
  geometry.computeBoundingSphere();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = batch.layer !== 'emissive';
  mesh.receiveShadow = true;
  disposables.push(() => geometry.dispose());
  return mesh;
};

const appendBakedBatches = (
  root: THREE.Group,
  bakedMesh: BakedMesh,
  twilight: boolean,
  clipPlanes: THREE.Plane[] | null,
  disposables: (() => void)[],
): void => {
  const texCache = new Map<string, THREE.Texture>();
  const matCache = new Map<string, THREE.MeshStandardMaterial>();
  for (const batch of bakedMesh.batches) {
    if (batch.positions.length === 0 || batch.indices.length === 0) continue;
    let map = texCache.get(batch.textureId) ?? null;
    if (!map && bakedMesh.textures[batch.textureId]) {
      map = createStructureTextureMap(bakedMesh.textures[batch.textureId]!);
      texCache.set(batch.textureId, map);
    }
    const matKey = `${batch.layer}:${batch.textureId}:${twilight ? 1 : 0}`;
    const material =
      matCache.get(matKey) ??
      (() => {
        const m = buildBatchMaterial(batch.layer, map, twilight, clipPlanes);
        matCache.set(matKey, m);
        return m;
      })();
    root.add(createBatchMesh(batch, material, disposables));
  }
  disposables.push(() => {
    for (const mat of matCache.values()) mat.dispose();
    for (const tex of texCache.values()) tex.dispose();
  });
};

const populateInstancedMesh = (
  templateMesh: THREE.Mesh,
  instances: readonly PropInstance[],
): THREE.InstancedMesh => {
  const instanced = new THREE.InstancedMesh(
    templateMesh.geometry,
    templateMesh.material,
    instances.length,
  );
  const scaleMat = new THREE.Matrix4().makeScale(
    VOXEL_MODEL_SCALE,
    VOXEL_MODEL_SCALE,
    VOXEL_MODEL_SCALE,
  );
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const unitScale = new THREE.Vector3(1, 1, 1);
  const worldMat = new THREE.Matrix4();
  const tint = new THREE.Color();
  const yAxis = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < instances.length; i += 1) {
    const inst = instances[i]!;
    pos.set(inst.translation[0], inst.translation[1], inst.translation[2]);
    quat.setFromAxisAngle(yAxis, THREE.MathUtils.degToRad(inst.rotation));
    worldMat.compose(pos, quat, unitScale).multiply(scaleMat).multiply(templateMesh.matrixWorld);
    instanced.setMatrixAt(i, worldMat);
    const [r, g, b] = inst.lightRgb;
    tint.setRGB(Math.max(0.28, r), Math.max(0.28, g), Math.max(0.28, b));
    instanced.setColorAt(i, tint);
  }
  instanced.instanceMatrix.needsUpdate = true;
  if (instanced.instanceColor) instanced.instanceColor.needsUpdate = true;
  instanced.castShadow = true;
  instanced.receiveShadow = true;
  return instanced;
};

const appendCustomInstances = async (
  root: THREE.Group,
  bakedMesh: BakedMesh,
  customModels: Readonly<Record<string, CompiledModel>>,
  clipY: number | undefined,
  disposables: (() => void)[],
  signal: AbortSignal,
): Promise<void> => {
  const grouped = new Map<string, PropInstance[]>();
  for (const inst of bakedMesh.instances) {
    if (clipY !== undefined && inst.translation[1] >= clipY) continue;
    const list = grouped.get(inst.assetKey);
    if (list) list.push(inst);
    else grouped.set(inst.assetKey, [inst]);
  }
  for (const [assetKey, list] of grouped) {
    const model = customModels[assetKey];
    if (!model || list.length === 0) continue;
    const projection = projectToThreeScene(compiledModelToDocument(model), {
      assets: {},
      showSkeleton: false,
      showTextures: true,
      showWireframe: false,
    });
    await waitForProjectionTextures(projection, signal);
    projection.root.updateMatrixWorld(true);
    projection.root.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        const instanced = populateInstancedMesh(obj, list);
        root.add(instanced);
        disposables.push(() => instanced.dispose());
      }
    });
    disposables.push(() => projection.dispose());
  }
};

const appendWarmPointLights = (
  root: THREE.Group,
  payload: StructureObservationPayload,
  bakedMesh: BakedMesh,
  options: StructureSceneBuildOptions,
): void => {
  const scale = options.twilight ? 2.8 : options.interiorFill ? 1.65 : 1.15;
  const sources =
    payload.playableMeta.lights.length > 0
      ? payload.playableMeta.lights
      : bakedMesh.instances
          .filter(
            (i) =>
              i.assetKey.includes('lantern') ||
              i.assetKey.includes('torch') ||
              i.assetKey.includes('rune'),
          )
          .map((i, idx) => ({
            id: `inst_${idx}`,
            position: [i.translation[0], i.translation[1] + 0.5, i.translation[2]] as const,
            color: i.assetKey.includes('rune') ? '#74f0e8' : '#ffb454',
            intensity: 3.5,
            radius: 10,
            kind: 'lantern' as const,
          }));
  const filtered = sources
    .filter((l) => options.clipY === undefined || l.position[1] < options.clipY + 0.5)
    .slice(0, MAX_POINT_LIGHTS);
  for (const light of filtered) {
    const point = new THREE.PointLight(
      light.color,
      Math.max(1.5, light.intensity) * scale,
      Math.max(6, light.radius),
      1.4,
    );
    point.position.set(light.position[0], light.position[1], light.position[2]);
    root.add(point);
  }
  if (options.interiorFill) {
    root.add(new THREE.HemisphereLight('#ffe5c2', '#4c3e34', 0.95));
  }
};

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
  appendWarmPointLights(root, payload, activeMesh, options);
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
