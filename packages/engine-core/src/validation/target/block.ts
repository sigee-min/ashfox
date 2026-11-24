import { CUBE_FACE_DIRECTIONS, PLANE_FACE_DIRECTIONS, type ProjectDocument } from '../../model';
import type { ExportAdaptedDocument } from '../../export/adapter';
import { isSceneNodeEffectivelyVisible } from '../../sceneVisibility';
import { exportCompatibilityFor } from '../../export/compatibility';
import { RESOURCE_NAMESPACE_PATTERN, validateResourceLocation } from '../shared/location';
import { EPSILON, isIdentityPosition, isIdentityRotation, isIdentityScale } from '../shared/value';
import type { FindingSink } from '../contract';

const javaBlockSupportsMultiAxisRotation =
  exportCompatibilityFor('java_block')?.supportsJavaBlockMultiAxisRotation ?? false;

const TEXTURE_KEY_PATTERN = /^[a-z0-9_.-]+$/;
const JAVA_MODEL_PATH_PATTERN = /^[a-z0-9_./-]+$/;
const JAVA_ROTATION_ANGLES = [-45, -22.5, 0, 22.5, 45] as const;

const validateProfileIdentity = (document: ExportAdaptedDocument, add: FindingSink): void => {
  const profile = document.formatProfile;
  if (profile.id !== 'minecraft.java_block') return;
  if (String(profile.modelKind) !== 'block') {
    add({
      code: 'format.unsupported_data',
      severity: 'error',
      message: 'Java block export requires modelKind "block".',
      path: 'formatProfile.modelKind',
      fix: 'Select the Java block target again.',
    });
  }
  if (!RESOURCE_NAMESPACE_PATTERN.test(profile.namespace)) {
    add({
      code: 'format.invalid_namespace',
      severity: 'error',
      message: `Minecraft namespace "${profile.namespace}" is invalid.`,
      path: 'formatProfile.namespace',
    });
  }
  if (
    !JAVA_MODEL_PATH_PATTERN.test(profile.modelPath) ||
    profile.modelPath.startsWith('/') ||
    profile.modelPath.endsWith('/') ||
    profile.modelPath.includes('..') ||
    profile.modelPath.endsWith('.json')
  ) {
    add({
      code: 'format.invalid_resource_path',
      severity: 'error',
      message: `Java model path "${profile.modelPath}" is invalid.`,
      path: 'formatProfile.modelPath',
    });
  }
};

interface TextureBindingState {
  readonly textureKeys: Map<string, string>;
  readonly texturePaths: Map<string, string>;
  particleAssetId: string | undefined;
}

const validateTextureBindingKey = (
  assetId: string,
  minecraft: NonNullable<ExportAdaptedDocument['textures'][string]['minecraft']>,
  path: string,
  state: TextureBindingState,
  add: FindingSink,
): void => {
  if (!TEXTURE_KEY_PATTERN.test(minecraft.key)) {
    add({
      code: 'format.invalid_identifier',
      severity: 'error',
      message: `Minecraft texture key "${minecraft.key}" is invalid.`,
      path: `${path}.minecraft.key`,
      assetIds: [assetId],
      fix: 'Use lowercase letters, digits, underscore, dot, or hyphen.',
    });
  }
  const existing = state.textureKeys.get(minecraft.key);
  if (existing && existing !== assetId) {
    add({
      code: 'format.texture_key_duplicate',
      severity: 'error',
      message: `Minecraft texture key "${minecraft.key}" is used by multiple assets.`,
      path: `${path}.minecraft.key`,
      assetIds: [existing, assetId],
    });
  }
  state.textureKeys.set(minecraft.key, assetId);
};

const validateTextureBindingPath = (
  assetId: string,
  texture: ExportAdaptedDocument['textures'][string],
  minecraft: NonNullable<ExportAdaptedDocument['textures'][string]['minecraft']>,
  path: string,
  state: TextureBindingState,
  add: FindingSink,
): void => {
  const texturePath = `${minecraft.resource.namespace}:` + minecraft.resource.path;
  const existingPath = state.texturePaths.get(texturePath);
  if (existingPath && existingPath !== assetId) {
    add({
      code: 'format.texture_path_duplicate',
      severity: 'error',
      message: `Java texture output "${texturePath}.png" is used by multiple assets.`,
      path: `${path}.minecraft.resource`,
      assetIds: [existingPath, assetId],
    });
  }
  state.texturePaths.set(texturePath, assetId);
  if (minecraft.particle) {
    if (state.particleAssetId) {
      add({
        code: 'format.texture_key_duplicate',
        severity: 'error',
        message: 'Only one Java texture binding may define the particle alias.',
        path: `${path}.minecraft.particle`,
        assetIds: [state.particleAssetId, assetId],
      });
    }
    state.particleAssetId = assetId;
  }
  if (texture.source.contentType !== 'image/png' || minecraft.extension !== 'png') {
    add({
      code: 'format.texture_type_unsupported',
      severity: 'error',
      message: 'Java resource-pack textures must be PNG files.',
      path: `${path}.source.contentType`,
      assetIds: [assetId],
    });
  }
};

const validateTextureBinding = (
  assetId: string,
  texture: ExportAdaptedDocument['textures'][string],
  state: TextureBindingState,
  add: FindingSink,
): void => {
  const path = `textures.${assetId}`;
  const minecraft = texture.minecraft;
  if (!minecraft) {
    add({
      code: 'format.texture_binding_missing',
      severity: 'error',
      message: 'Java export requires a Minecraft resource binding for every texture.',
      path: `${path}.minecraft`,
      assetIds: [assetId],
    });
    return;
  }
  validateResourceLocation(minecraft.resource, `${path}.minecraft.resource`, add);
  if (minecraft.resource.path.endsWith('.png')) {
    add({
      code: 'format.invalid_resource_path',
      severity: 'error',
      message: 'Minecraft texture resource paths must omit the .png extension.',
      path: `${path}.minecraft.resource.path`,
      assetIds: [assetId],
    });
  }
  validateTextureBindingKey(assetId, minecraft, path, state, add);
  validateTextureBindingPath(assetId, texture, minecraft, path, state, add);
};

const validateTextureBindings = (document: ExportAdaptedDocument, add: FindingSink): void => {
  const state: TextureBindingState = {
    textureKeys: new Map<string, string>(),
    texturePaths: new Map<string, string>(),
    particleAssetId: undefined,
  };
  for (const [assetId, texture] of Object.entries(document.textures)) {
    validateTextureBinding(assetId, texture, state, add);
  }
  const explicitParticleAsset = state.textureKeys.get('particle');
  if (state.particleAssetId && explicitParticleAsset) {
    add({
      code: 'format.texture_key_duplicate',
      severity: 'error',
      message: 'The generated particle alias conflicts with an explicit "particle" texture key.',
      path: `textures.${state.particleAssetId}.minecraft.particle`,
      assetIds: [explicitParticleAsset, state.particleAssetId],
    });
  }
};

const validateJavaRotation = (
  rotation: readonly [number, number, number],
  minecraftVersion: string,
  axisLabel: string,
  path: string,
  nodeId: string,
  add: FindingSink,
): void => {
  if (javaBlockSupportsMultiAxisRotation) return;
  const activeRotations = rotation.filter((value) => Math.abs(value) > EPSILON);
  const angle = activeRotations[0] ?? 0;
  if (
    activeRotations.length > 1 ||
    !JAVA_ROTATION_ANGLES.some((allowed) => Math.abs(allowed - angle) <= EPSILON)
  ) {
    add({
      code: 'format.rotation_unsupported',
      severity: 'error',
      message: `Java ${minecraftVersion} supports one ${axisLabel} at -45, -22.5, 0, 22.5, or 45 degrees.`,
      path: `${path}.transform.rotation`,
      entityIds: [nodeId],
    });
  }
};

const validateJavaFaces = <Direction extends string>(
  faces: Readonly<
    Record<
      Direction,
      { readonly enabled: boolean; readonly textureId: string | null; readonly uv?: unknown }
    >
  >,
  directions: readonly Direction[],
  faceLabel: string,
  path: string,
  nodeId: string,
  add: FindingSink,
): void => {
  for (const direction of directions) {
    const face = faces[direction];
    if (!face.enabled) continue;
    if (face.textureId === null) {
      add({
        code: 'format.texture_binding_missing',
        severity: 'error',
        message: `Enabled ${faceLabel} require a texture.`,
        path: `${path}.faces.${direction}.textureId`,
        entityIds: [nodeId],
      });
    }
    if (!face.uv) {
      add({
        code: 'format.uv_missing',
        severity: 'error',
        message: `Enabled ${faceLabel} require an explicit UV rectangle.`,
        path: `${path}.faces.${direction}.uv`,
        entityIds: [nodeId],
      });
    }
  }
};

const validateJavaCubeBounds = (
  node: Extract<
    ProjectDocument['scene']['nodes'][string],
    { kind: 'cube'; geometryMode: 'axis-box' }
  >,
  nodeId: string,
  path: string,
  add: FindingSink,
): void => {
  const inflatedFrom = node.bounds.from.map(
    (value, index) => value + node.transform.position[index] - node.inflate,
  );
  const inflatedTo = node.bounds.to.map(
    (value, index) => value + node.transform.position[index] + node.inflate,
  );
  if (inflatedFrom.some((value, index) => value > inflatedTo[index])) {
    add({
      code: 'cube.invalid_bounds',
      severity: 'error',
      message: 'Java element bounds become reversed after applying inflate.',
      path: `${path}.inflate`,
      entityIds: [nodeId],
    });
  }
  if ([...inflatedFrom, ...inflatedTo].some((value) => value < -16 || value > 32)) {
    add({
      code: 'format.coordinate_overflow',
      severity: 'error',
      message: 'Java block element coordinates must remain between -16 and 32 after inflate.',
      path: `${path}.bounds`,
      entityIds: [nodeId],
    });
  }
};

const validateJavaCube = (
  node: Extract<ProjectDocument['scene']['nodes'][string], { kind: 'cube' }>,
  nodeId: string,
  path: string,
  document: ExportAdaptedDocument,
  add: FindingSink,
): void => {
  const profile = document.formatProfile;
  if (profile.id !== 'minecraft.java_block') return;
  if (node.geometryMode !== 'axis-box') {
    add({
      code: 'format.unsupported_data',
      severity: 'error',
      message: 'Minecraft Java block output does not support oriented entity boxes.',
      path: `${path}.geometryMode`,
      entityIds: [nodeId],
    });
    return;
  }
  if (!isIdentityScale(node.transform.scale)) {
    add({
      code: 'format.unbaked_transform',
      severity: 'error',
      message: 'Java block export requires cube scale to be baked into bounds.',
      path: `${path}.transform.scale`,
      entityIds: [nodeId],
    });
  }
  validateJavaCubeBounds(node, nodeId, path, add);
  validateJavaRotation(
    node.transform.rotation,
    profile.minecraftVersion,
    'rotation axis',
    path,
    nodeId,
    add,
  );
  validateJavaFaces(node.faces, CUBE_FACE_DIRECTIONS, 'Java faces', path, nodeId, add);
};

const validateJavaPlane = (
  node: Extract<ProjectDocument['scene']['nodes'][string], { kind: 'plane' }>,
  nodeId: string,
  path: string,
  document: ExportAdaptedDocument,
  add: FindingSink,
): void => {
  const profile = document.formatProfile;
  if (profile.id !== 'minecraft.java_block') return;
  if (!isIdentityScale(node.transform.scale))
    add({
      code: 'format.unbaked_transform',
      severity: 'error',
      message: 'Java block export requires plane scale to be baked into size.',
      path: `${path}.transform.scale`,
      entityIds: [nodeId],
    });
  const maximum: readonly [number, number, number] = [
    node.transform.position[0] + node.size[0],
    node.transform.position[1] + node.size[1],
    node.transform.position[2],
  ];
  if ([...node.transform.position, ...maximum].some((value) => value < -16 || value > 32))
    add({
      code: 'format.coordinate_overflow',
      severity: 'error',
      message: 'Java block plane coordinates must remain between -16 and 32.',
      path: `${path}.size`,
      entityIds: [nodeId],
    });
  validateJavaRotation(
    node.transform.rotation,
    profile.minecraftVersion,
    'plane rotation axis',
    path,
    nodeId,
    add,
  );
  validateJavaFaces(node.faces, PLANE_FACE_DIRECTIONS, 'Java plane faces', path, nodeId, add);
};

const validateSceneNodes = (document: ExportAdaptedDocument, add: FindingSink): void => {
  for (const [nodeId, node] of Object.entries(document.scene.nodes)) {
    const path = `scene.nodes.${nodeId}`;
    if (!isSceneNodeEffectivelyVisible(document, nodeId)) continue;
    if (node.kind === 'locator') continue;
    if (node.kind === 'bone') {
      if (
        !isIdentityPosition(node.transform.position) ||
        !isIdentityRotation(node.transform.rotation) ||
        !isIdentityScale(node.transform.scale)
      ) {
        add({
          code: 'format.unbaked_transform',
          severity: 'error',
          message: 'Java block export requires bone transforms to be baked into cubes.',
          path: `${path}.transform`,
          entityIds: [nodeId],
        });
      }
      continue;
    }
    if (node.kind === 'plane') {
      validateJavaPlane(node, nodeId, path, document, add);
      continue;
    }
    validateJavaCube(node, nodeId, path, document, add);
  }
};

export const validateJavaBlockProfile = (
  document: ExportAdaptedDocument,
  add: FindingSink,
): void => {
  if (document.formatProfile.id !== 'minecraft.java_block') return;
  validateProfileIdentity(document, add);
  validateTextureBindings(document, add);
  validateSceneNodes(document, add);
};
