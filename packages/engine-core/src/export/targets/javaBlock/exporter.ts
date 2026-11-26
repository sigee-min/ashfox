import { compareText } from '../../../stableOrder';
import {
  CUBE_FACE_DIRECTIONS,
  type CubeFaceDirection,
  type CubeNode,
  type PlaneNode,
  type Vec3,
} from '../../../model';
import type { ExportAdaptedDocument, ExportTextureAsset } from '../../adapter';
import type { AssetBuildIdentity } from '../../../project/asset';
import { createTextureExportFile } from '../../texture';
import { effectivelyVisibleSceneNodeIds } from '../../../sceneVisibility';
import { exportCompatibilityFor, exportTargetDescriptorForPreset } from '../../compatibility';
import { createCompactJsonExportFile } from '../../json';
import { createExportBundle } from '../../pipeline/bundle';
import { assertValidatedExportTargetDocument, validateExportTarget } from '../../pipeline/validate';
import type { ExportBundle } from '../../contract';
import { buildMinecraftJavaBlockState, buildMinecraftJavaPackMetadata } from './pack';

const javaBlockSupportsMultiAxisRotation =
  exportCompatibilityFor('java_block')?.supportsJavaBlockMultiAxisRotation ?? false;

export interface MinecraftJavaFace {
  uv: [number, number, number, number];
  texture: string;
  rotation?: 90 | 180 | 270;
  cullface?: CubeFaceDirection;
  tintindex?: number;
}

export interface MinecraftJavaAxisRotation {
  origin: [number, number, number];
  axis: 'x' | 'y' | 'z';
  angle: number;
  rescale?: boolean;
}

export interface MinecraftJavaEulerRotation {
  origin: [number, number, number];
  x?: number;
  y?: number;
  z?: number;
  rescale?: boolean;
}

export interface MinecraftJavaElement {
  name?: string;
  from: [number, number, number];
  to: [number, number, number];
  rotation?: MinecraftJavaAxisRotation | MinecraftJavaEulerRotation;
  shade?: boolean;
  light_emission?: number;
  faces: Partial<Record<CubeFaceDirection, MinecraftJavaFace>>;
}

export interface MinecraftJavaModel {
  parent?: string;
  ambientocclusion?: boolean;
  gui_light?: 'front';
  texture_size?: [number, number];
  textures: Record<string, string>;
  elements: MinecraftJavaElement[];
}

const addPosition = (value: Vec3, position: Vec3): [number, number, number] => [
  value[0] + position[0],
  value[1] + position[1],
  value[2] + position[2],
];

const compileJavaRotation = (
  cube: CubeNode,
): MinecraftJavaAxisRotation | MinecraftJavaEulerRotation | undefined => {
  const rotation = cube.transform.rotation;
  const activeAxes = rotation
    .map((angle, index) => ({ angle, index }))
    .filter(({ angle }) => Math.abs(angle) > 0.000001);

  if (activeAxes.length === 0 && !cube.rescale) return undefined;

  const origin = addPosition(cube.transform.pivot, cube.transform.position);
  const primary = activeAxes[0] ?? { angle: 0, index: 1 };
  const canUseAxisRotation = activeAxes.length <= 1 && Math.abs(primary.angle) <= 45;

  if (canUseAxisRotation || !javaBlockSupportsMultiAxisRotation) {
    const axes = ['x', 'y', 'z'] as const;
    return {
      origin,
      axis: axes[primary.index],
      angle: primary.angle,
      ...(cube.rescale ? { rescale: true } : {}),
    };
  }

  return {
    origin,
    ...(Math.abs(rotation[0]) > 0.000001 ? { x: rotation[0] } : {}),
    ...(Math.abs(rotation[1]) > 0.000001 ? { y: rotation[1] } : {}),
    ...(Math.abs(rotation[2]) > 0.000001 ? { z: rotation[2] } : {}),
    ...(cube.rescale ? { rescale: true } : {}),
  };
};

const textureBindingFor = (
  texture: ExportTextureAsset,
): NonNullable<ExportTextureAsset['minecraft']> => {
  if (!texture.minecraft) {
    throw new Error(`Texture "${texture.id}" has no Minecraft binding.`);
  }
  return texture.minecraft;
};

const compileJavaFace = (
  document: ExportAdaptedDocument,
  face: CubeNode['faces'][CubeFaceDirection],
): MinecraftJavaFace | undefined => {
  if (!face.enabled || face.textureId === null || !face.uv) return undefined;
  const binding = textureBindingFor(document.textures[face.textureId]);
  const resolution = document.settings.textureResolution;
  const uv: [number, number, number, number] = [
    (face.uv[0] * 16) / resolution.width,
    (face.uv[1] * 16) / resolution.height,
    (face.uv[2] * 16) / resolution.width,
    (face.uv[3] * 16) / resolution.height,
  ];
  return {
    uv,
    texture: `#${binding.key}`,
    ...(face.rotation ? { rotation: face.rotation } : {}),
    ...(face.cullFace ? { cullface: face.cullFace } : {}),
    ...(face.tintIndex !== undefined ? { tintindex: face.tintIndex } : {}),
  };
};

const compileJavaElement = (
  document: ExportAdaptedDocument,
  cube: CubeNode,
): MinecraftJavaElement => {
  if (cube.geometryMode !== 'axis-box') {
    throw new RangeError('Minecraft Java block export does not accept oriented entity boxes.');
  }
  const from = addPosition(cube.bounds.from, cube.transform.position);
  const to = addPosition(cube.bounds.to, cube.transform.position);
  for (let axis = 0; axis < 3; axis += 1) {
    from[axis] -= cube.inflate;
    to[axis] += cube.inflate;
  }

  const faces: Partial<Record<CubeFaceDirection, MinecraftJavaFace>> = {};
  for (const direction of CUBE_FACE_DIRECTIONS) {
    const compiled = compileJavaFace(document, cube.faces[direction]);
    if (compiled !== undefined) faces[direction] = compiled;
  }
  const rotation = compileJavaRotation(cube);

  return {
    ...(cube.name !== 'cube' ? { name: cube.name } : {}),
    from,
    to,
    ...(rotation ? { rotation } : {}),
    ...(cube.shade === false ? { shade: false } : {}),
    ...(cube.lightEmission ? { light_emission: cube.lightEmission } : {}),
    faces,
  };
};

const compileJavaPlaneRotation = (
  plane: PlaneNode,
): MinecraftJavaAxisRotation | MinecraftJavaEulerRotation | undefined => {
  const rotation = plane.transform.rotation;
  const activeAxes = rotation
    .map((angle, index) => ({ angle, index }))
    .filter(({ angle }) => Math.abs(angle) > 0.000001);
  if (activeAxes.length === 0) return undefined;
  const origin = addPosition(plane.transform.pivot, plane.transform.position);
  const primary = activeAxes[0]!;
  if (activeAxes.length <= 1 || !javaBlockSupportsMultiAxisRotation) {
    const axes = ['x', 'y', 'z'] as const;
    return { origin, axis: axes[primary.index]!, angle: primary.angle };
  }
  return {
    origin,
    ...(Math.abs(rotation[0]) > 0.000001 ? { x: rotation[0] } : {}),
    ...(Math.abs(rotation[1]) > 0.000001 ? { y: rotation[1] } : {}),
    ...(Math.abs(rotation[2]) > 0.000001 ? { z: rotation[2] } : {}),
  };
};

const compileJavaPlaneElement = (
  document: ExportAdaptedDocument,
  plane: PlaneNode,
): MinecraftJavaElement => {
  const from = [...plane.transform.position] as [number, number, number];
  const to: [number, number, number] = [from[0] + plane.size[0], from[1] + plane.size[1], from[2]];
  const faces: Partial<Record<CubeFaceDirection, MinecraftJavaFace>> = {};
  const entries = [
    ['south', plane.faces.front],
    ['north', plane.faces.back],
  ] as const;
  for (const [direction, face] of entries) {
    if (!face.enabled || face.textureId === null || !face.uv) continue;
    const binding = textureBindingFor(document.textures[face.textureId]);
    const resolution = document.settings.textureResolution;
    faces[direction] = {
      uv: [
        (face.uv[0] * 16) / resolution.width,
        (face.uv[1] * 16) / resolution.height,
        (face.uv[2] * 16) / resolution.width,
        (face.uv[3] * 16) / resolution.height,
      ],
      texture: `#${binding.key}`,
      ...(face.rotation ? { rotation: face.rotation } : {}),
      ...(face.tintIndex !== undefined ? { tintindex: face.tintIndex } : {}),
    };
  }
  const rotation = compileJavaPlaneRotation(plane);
  return {
    ...(plane.name !== 'plane' ? { name: plane.name } : {}),
    from,
    to,
    ...(rotation ? { rotation } : {}),
    faces,
  };
};

const compileTextureMap = (document: ExportAdaptedDocument): Record<string, string> => {
  const textures: Record<string, string> = {};
  const orderedTextures = Object.values(document.textures).sort((left, right) =>
    compareText(left.id, right.id),
  );
  for (const texture of orderedTextures) {
    const binding = textureBindingFor(texture);
    textures[binding.key] = `${binding.resource.namespace}:${binding.resource.path}`;
    if (binding.particle) {
      textures.particle = `#${binding.key}`;
    }
  }
  return textures;
};

const createTextureCopy = (document: ExportAdaptedDocument, texture: ExportTextureAsset) => {
  const binding = textureBindingFor(texture);
  return createTextureExportFile(
    document,
    texture,
    `assets/${binding.resource.namespace}/textures/${binding.resource.path}.${binding.extension}`,
  );
};

export const buildMinecraftJavaModel = (document: ExportAdaptedDocument): MinecraftJavaModel => {
  assertValidatedExportTargetDocument(document, 'java_block');
  const profile = document.formatProfile;
  if (profile.id !== 'minecraft.java_block') {
    throw new Error('Project does not use the minecraft.java_block profile.');
  }

  const visibleNodeIds = effectivelyVisibleSceneNodeIds(document);
  const cubes = Object.values(document.scene.nodes)
    .filter((node): node is CubeNode => node.kind === 'cube' && visibleNodeIds.has(node.id))
    .sort((left, right) => compareText(left.id, right.id));
  const planes = Object.values(document.scene.nodes)
    .filter((node): node is PlaneNode => node.kind === 'plane' && visibleNodeIds.has(node.id))
    .sort((left, right) => compareText(left.id, right.id));
  const model: MinecraftJavaModel = {
    ...(profile.parent ? { parent: profile.parent } : {}),
    ...(profile.ambientOcclusion === false ? { ambientocclusion: false } : {}),
    ...(profile.guiLight === 'front' ? { gui_light: 'front' as const } : {}),
    ...(document.settings.textureResolution.width !== 16 ||
    document.settings.textureResolution.height !== 16
      ? {
          texture_size: [
            document.settings.textureResolution.width,
            document.settings.textureResolution.height,
          ] as [number, number],
        }
      : {}),
    textures: compileTextureMap(document),
    elements: [
      ...cubes.map((cube) => compileJavaElement(document, cube)),
      ...planes.map((plane) => compileJavaPlaneElement(document, plane)),
    ],
  };
  return model;
};

export const exportMinecraftJavaBlock = (
  document: ExportAdaptedDocument,
  build: AssetBuildIdentity,
): ExportBundle => {
  const validation = validateExportTarget(document, {
    profileId: 'minecraft.java_block',
    errorMessage: 'Minecraft Java export validation failed.',
  });
  const validatedDocument = validation.document;
  const profile = validation.profile;
  const packMetadataPath = 'pack.mcmeta';
  const modelPath = `assets/${profile.namespace}/models/block/${profile.modelPath}.json`;
  const blockstatePath = `assets/${profile.namespace}/blockstates/${profile.modelPath}.json`;
  const model = buildMinecraftJavaModel(validatedDocument);
  const textureFiles = Object.values(validatedDocument.textures)
    .sort((left, right) => compareText(left.id, right.id))
    .map((texture) => createTextureCopy(validatedDocument, texture));

  return createExportBundle(validatedDocument, build, validation.findings, {
    target: exportTargetDescriptorForPreset('java_block').target,
    rootPath: 'resource-pack',
    entrypoints: [packMetadataPath, blockstatePath, modelPath],
    files: [
      createCompactJsonExportFile(
        'manifest',
        packMetadataPath,
        buildMinecraftJavaPackMetadata(validatedDocument),
      ),
      createCompactJsonExportFile(
        'blockstate',
        blockstatePath,
        buildMinecraftJavaBlockState(validatedDocument),
      ),
      createCompactJsonExportFile('model', modelPath, model),
      ...textureFiles,
    ],
  });
};
