import { CUBE_FACE_DIRECTIONS, PLANE_FACE_DIRECTIONS, type ProjectDocument } from '../../model';
import type { ExportAdaptedDocument } from '../../export/adapter';
import { isSceneNodeEffectivelyVisible } from '../../sceneVisibility';
import type { FindingSink } from '../contract';
import { exportCompatibilityFor } from '../../export/compatibility';

const MODEL_PATH_PATTERN = /^[A-Za-z0-9_./-]+$/;

const validateProfile = (
  profile: Extract<ExportAdaptedDocument['formatProfile'], { id: 'gltf.2' }>,
  add: FindingSink,
): void => {
  const currentVersion = exportCompatibilityFor(profile.container)?.profile;
  const expectedVersion = currentVersion?.id === 'gltf.2' ? currentVersion.version : null;
  if (expectedVersion === null || profile.version !== expectedVersion) {
    add({
      code: 'format.unsupported_data',
      severity: 'error',
      message: `glTF target version must be ${expectedVersion ?? 'current'}.`,
      path: 'formatProfile.version',
    });
  }
  if (
    !MODEL_PATH_PATTERN.test(profile.modelPath) ||
    profile.modelPath.startsWith('/') ||
    profile.modelPath.endsWith('/') ||
    profile.modelPath.includes('..') ||
    /\.(?:gltf|glb|bin)$/i.test(profile.modelPath)
  ) {
    add({
      code: 'format.invalid_resource_path',
      severity: 'error',
      message: `glTF model path "${profile.modelPath}" is invalid.`,
      path: 'formatProfile.modelPath',
      fix: 'Use a safe relative path without a file extension or parent traversal.',
    });
  }
  if (profile.container !== 'gltf' && profile.container !== 'glb') {
    add({
      code: 'format.unsupported_data',
      severity: 'error',
      message: 'glTF container must be gltf or glb.',
      path: 'formatProfile.container',
    });
  }
  if (profile.imageStorage !== 'external' && profile.imageStorage !== 'embedded') {
    add({
      code: 'format.unsupported_data',
      severity: 'error',
      message: 'glTF image storage must be external or embedded.',
      path: 'formatProfile.imageStorage',
    });
  }
  if (profile.imageStorage === 'embedded' && profile.container !== 'glb') {
    add({
      code: 'format.unsupported_data',
      severity: 'error',
      message: 'Embedded glTF images require the GLB container.',
      path: 'formatProfile.imageStorage',
      fix: 'Use container "glb" or imageStorage "external".',
    });
  }
};

const validateTextures = (document: ExportAdaptedDocument, add: FindingSink): void => {
  for (const [assetId, texture] of Object.entries(document.textures)) {
    if (texture.source.contentType !== 'image/png' && texture.source.contentType !== 'image/jpeg') {
      add({
        code: 'format.texture_type_unsupported',
        severity: 'error',
        message: 'Core glTF 2.0 export supports PNG and JPEG textures.',
        path: `textures.${assetId}.source.contentType`,
        assetIds: [assetId],
      });
    }
    if (texture.pbrChannel !== undefined && texture.pbrChannel !== 'color') {
      add({
        code: 'format.unsupported_data',
        severity: 'error',
        message:
          'glTF material export currently accepts color textures; normal, height, and MER bindings require an explicit material channel map.',
        path: `textures.${assetId}.pbrChannel`,
        assetIds: [assetId],
      });
    }
    if (texture.renderMode === 'additive' || texture.renderMode === 'layered') {
      add({
        code: 'format.unsupported_data',
        severity: 'error',
        message: `glTF core cannot preserve the ${texture.renderMode} ashfox render mode.`,
        path: `textures.${assetId}.renderMode`,
        assetIds: [assetId],
      });
    }
    if (texture.colorSpace !== 'srgb') {
      add({
        code: 'format.unsupported_data',
        severity: 'error',
        message: 'glTF base-color and emissive texture export requires sRGB texture data.',
        path: `textures.${assetId}.colorSpace`,
        assetIds: [assetId],
      });
    }
  }
};

const validateCube = (
  node: Extract<ProjectDocument['scene']['nodes'][string], { kind: 'cube' }>,
  nodeId: string,
  path: string,
  add: FindingSink,
): void => {
  if (node.mirror) {
    add({
      code: 'format.unsupported_data',
      severity: 'error',
      message: 'glTF cube export requires mirrored UVs to be baked into explicit face UVs.',
      path: `${path}.mirror`,
      entityIds: [nodeId],
    });
  }
  if (
    node.rescale ||
    node.shade === false ||
    (node.lightEmission !== undefined && node.lightEmission !== 0)
  ) {
    add({
      code: 'format.unsupported_data',
      severity: 'error',
      message:
        'glTF cannot preserve Java rescale, disabled shading, or per-cube light emission hints.',
      path,
      entityIds: [nodeId],
    });
  }
  for (const direction of CUBE_FACE_DIRECTIONS) {
    const face = node.faces[direction];
    if (!face.enabled) continue;
    if (face.textureId !== null && !face.uv) {
      add({
        code: 'format.uv_missing',
        severity: 'error',
        message: 'Textured glTF cube faces require explicit UV rectangles.',
        path: `${path}.faces.${direction}.uv`,
        entityIds: [nodeId],
        assetIds: [face.textureId],
      });
    }
    if (face.tintIndex !== undefined || face.materialInstance !== undefined) {
      add({
        code: 'format.unsupported_data',
        severity: 'error',
        message: 'glTF cannot preserve Minecraft tint indices or material-instance names.',
        path: `${path}.faces.${direction}`,
        entityIds: [nodeId],
      });
    }
  }
};

const validatePlane = (
  node: Extract<ProjectDocument['scene']['nodes'][string], { kind: 'plane' }>,
  nodeId: string,
  path: string,
  add: FindingSink,
): void => {
  for (const direction of PLANE_FACE_DIRECTIONS) {
    const face = node.faces[direction];
    if (!face.enabled) continue;
    if (face.textureId !== null && !face.uv) {
      add({
        code: 'format.uv_missing',
        severity: 'error',
        message: 'Textured glTF plane faces require explicit UV rectangles.',
        path: `${path}.faces.${direction}.uv`,
        entityIds: [nodeId],
        assetIds: [face.textureId],
      });
    }
    if (
      face.tintIndex !== undefined ||
      (face.materialInstance !== undefined && face.materialInstance !== 'cutout')
    ) {
      add({
        code: 'format.unsupported_data',
        severity: 'error',
        message:
          face.tintIndex !== undefined
            ? 'glTF cannot preserve Minecraft plane tint indices.'
            : 'glTF only maps the canonical cutout material instance to alpha MASK.',
        path: `${path}.faces.${direction}`,
        entityIds: [nodeId],
      });
    }
  }
};

const validateScene = (document: ExportAdaptedDocument, add: FindingSink): void => {
  for (const [nodeId, node] of Object.entries(document.scene.nodes)) {
    const path = `scene.nodes.${nodeId}`;
    if (!isSceneNodeEffectivelyVisible(document, nodeId)) continue;
    if (node.kind === 'cube') validateCube(node, nodeId, path, add);
    else if (node.kind === 'plane') validatePlane(node, nodeId, path, add);
  }
};

const validateAnimationChannels = (document: ExportAdaptedDocument, add: FindingSink): void => {
  for (const [clipId, clip] of Object.entries(document.animations)) {
    const clipPath = `animations.${clipId}`;
    const targetProperties = new Map<string, string>();
    for (const [channelId, channel] of Object.entries(clip.channels)) {
      const channelPath = `${clipPath}.channels.${channelId}`;
      if (!isSceneNodeEffectivelyVisible(document, channel.targetNodeId)) {
        continue;
      }
      const targetProperty = `${channel.targetNodeId}:${channel.property}`;
      if (targetProperties.has(targetProperty)) {
        add({
          code: 'animation.channel_duplicate',
          severity: 'error',
          message: 'glTF allows one animation channel per node transform path.',
          path: channelPath,
          clipIds: [clipId],
        });
      }
      targetProperties.set(targetProperty, channelId);
    }
  }
};

export const validateGltfProfile = (document: ExportAdaptedDocument, add: FindingSink): void => {
  const profile = document.formatProfile;
  if (profile.id !== 'gltf.2') return;
  validateProfile(profile, add);
  validateTextures(document, add);
  validateScene(document, add);
  validateAnimationChannels(document, add);
};
