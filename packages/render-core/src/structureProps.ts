import * as THREE from 'three';

import {
  compiledModelToProjectDocument,
  type CompiledModel,
  type StructureProduct,
} from '@ashfox/engine-core';

import { waitForProjectionTextures } from './captureSurface';
import { projectToThreeScene } from './projection';

type BakedMesh = StructureProduct['bakedMesh'];
type PropInstance = BakedMesh['instances'][number];
type PlayableMeta = StructureProduct['playableMeta'];

const VOXEL_MODEL_SCALE = 1 / 16;
const MAX_POINT_LIGHTS = 16;

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

/** Projects and instances custom structure prop models into the Three.js scene group. */
export const appendCustomInstances = async (
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
    const projection = projectToThreeScene(
      compiledModelToProjectDocument(model, { revision: 'structure-prop' }),
      {
        assets: {},
        showSkeleton: false,
        showTextures: true,
        showWireframe: false,
      },
    );
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

/** Appends bounded warm point lights and optional interior fill lighting for structures. */
export const appendWarmPointLights = (
  root: THREE.Group,
  playableMeta: PlayableMeta,
  bakedMesh: BakedMesh,
  options: {
    readonly twilight?: boolean;
    readonly interiorFill?: boolean;
    readonly clipY?: number;
  },
): void => {
  const scale = options.twilight ? 2.8 : options.interiorFill ? 1.65 : 1.15;
  const sources =
    playableMeta.lights.length > 0
      ? playableMeta.lights
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
