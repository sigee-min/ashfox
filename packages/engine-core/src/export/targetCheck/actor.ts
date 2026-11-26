import { CUBE_FACE_DIRECTIONS, PLANE_FACE_DIRECTIONS, type ProjectDocument } from '../../model';
import type { ExportAdaptedDocument } from '../adapter';
import { isSceneNodeEffectivelyVisible } from '../../sceneVisibility';
import {
  RESOURCE_NAMESPACE_PATTERN,
  RESOURCE_PATH_PATTERN,
  validateResourceLocation,
} from '../../validation/shared/location';
import {
  isFiniteNumber,
  isIdentityPosition,
  isIdentityScale,
  validateVec,
} from '../../validation/shared/value';
import type { FindingSink } from '../../validation/contract';

const BEDROCK_GEOMETRY_IDENTIFIER_PATTERN = /^geometry\.[a-z0-9_.-]+$/;

type ActorProfile = Extract<
  ExportAdaptedDocument['formatProfile'],
  { id: 'minecraft.bedrock' | 'minecraft.java.geckolib5' }
>;

const targetNameFor = (profile: ActorProfile): 'Bedrock' | 'GeckoLib 5' =>
  profile.id === 'minecraft.bedrock' ? 'Bedrock' : 'GeckoLib 5';

const validateProfileKind = (profile: ActorProfile, add: FindingSink): void => {
  if (
    profile.id === 'minecraft.java.geckolib5' &&
    !['entity', 'block', 'item'].includes(profile.assetKind)
  ) {
    add({
      code: 'format.unsupported_data',
      severity: 'error',
      message: 'GeckoLib assetKind must be entity, block, or item.',
      path: 'formatProfile.assetKind',
    });
  }
  if (profile.id === 'minecraft.bedrock' && !['entity', 'block'].includes(profile.geometryKind)) {
    add({
      code: 'format.unsupported_data',
      severity: 'error',
      message: 'Bedrock geometryKind must be entity or block.',
      path: 'formatProfile.geometryKind',
    });
  }
};

const isInvalidResourcePath = (value: string): boolean =>
  !RESOURCE_PATH_PATTERN.test(value) ||
  value.startsWith('/') ||
  value.endsWith('/') ||
  value.includes('..') ||
  value.endsWith('.json');

const validateProfilePaths = (profile: ActorProfile, add: FindingSink): void => {
  const targetName = targetNameFor(profile);
  for (const [field, value] of [
    ['modelPath', profile.modelPath],
    ['animationPath', profile.animationPath],
  ] as const) {
    if (!isInvalidResourcePath(value)) continue;
    add({
      code: 'format.invalid_resource_path',
      severity: 'error',
      message: `${targetName} ${field === 'modelPath' ? 'model' : 'animation'} path "${value}" is invalid.`,
      path: `formatProfile.${field}`,
    });
  }
};

const validateVisibleBounds = (
  bounds: NonNullable<ActorProfile['visibleBounds']>,
  add: FindingSink,
): void => {
  if (
    !isFiniteNumber(bounds.width) ||
    bounds.width <= 0 ||
    !isFiniteNumber(bounds.height) ||
    bounds.height <= 0
  ) {
    add({
      code: 'value.not_finite',
      severity: 'error',
      message: 'Visible bounds width and height must be finite and positive.',
      path: 'formatProfile.visibleBounds',
    });
  }
  validateVec(bounds.offset, 3, 'formatProfile.visibleBounds.offset', add);
};

const validateProfile = (profile: ActorProfile, add: FindingSink): void => {
  const targetName = targetNameFor(profile);
  validateProfileKind(profile, add);
  if (!RESOURCE_NAMESPACE_PATTERN.test(profile.namespace)) {
    add({
      code: 'format.invalid_namespace',
      severity: 'error',
      message: `${targetName} namespace "${profile.namespace}" is invalid.`,
      path: 'formatProfile.namespace',
    });
  }
  validateProfilePaths(profile, add);
  if (!BEDROCK_GEOMETRY_IDENTIFIER_PATTERN.test(profile.geometryIdentifier)) {
    add({
      code: 'format.invalid_identifier',
      severity: 'error',
      message: `${targetName} geometry identifiers must start with "geometry." and use lowercase resource characters.`,
      path: 'formatProfile.geometryIdentifier',
    });
  }
  if (profile.visibleBounds) validateVisibleBounds(profile.visibleBounds, add);
};

const validateActorCube = (
  node: Extract<ProjectDocument['scene']['nodes'][string], { kind: 'cube' }>,
  nodeId: string,
  path: string,
  targetName: string,
  textureCount: number,
  add: FindingSink,
): void => {
  if (!isIdentityScale(node.transform.scale)) {
    add({
      code: 'format.unbaked_transform',
      severity: 'error',
      message: `${targetName} cube scale must be baked into bounds.`,
      path: `${path}.transform.scale`,
      entityIds: [nodeId],
    });
  }
  if (node.boxUv && !node.uvOffset) {
    add({
      code: 'format.uv_missing',
      severity: 'error',
      message: `${targetName} box-UV cubes require uvOffset.`,
      path: `${path}.uvOffset`,
      entityIds: [nodeId],
    });
  }
  if (!node.boxUv) {
    for (const direction of CUBE_FACE_DIRECTIONS) {
      const face = node.faces[direction];
      if (face.enabled && !face.uv) {
        add({
          code: 'format.uv_missing',
          severity: 'error',
          message: `Enabled ${targetName} per-face UVs require an explicit rectangle.`,
          path: `${path}.faces.${direction}.uv`,
          entityIds: [nodeId],
        });
      }
    }
  }
  const hasTexturedFace = CUBE_FACE_DIRECTIONS.some((direction) => {
    const face = node.faces[direction];
    return face.enabled && face.textureId !== null;
  });
  if (textureCount > 0 && !hasTexturedFace) {
    add({
      code: 'format.texture_missing',
      severity: 'warning',
      message: `${targetName} cube "${node.name}" has no texture and will export without visible surface art.`,
      path: `${path}.faces`,
      entityIds: [nodeId],
      fix: 'Author a texture and bind it to the enabled cube faces.',
    });
  }
};

const validateActorPlane = (
  node: Extract<ProjectDocument['scene']['nodes'][string], { kind: 'plane' }>,
  nodeId: string,
  path: string,
  targetName: string,
  textureCount: number,
  add: FindingSink,
): void => {
  if (!isIdentityScale(node.transform.scale)) {
    add({
      code: 'format.unbaked_transform',
      severity: 'error',
      message: `${targetName} plane scale must be baked into size.`,
      path: `${path}.transform.scale`,
      entityIds: [nodeId],
    });
  }
  let textured = false;
  for (const direction of PLANE_FACE_DIRECTIONS) {
    const face = node.faces[direction];
    if (!face.enabled) continue;
    if (!face.uv)
      add({
        code: 'format.uv_missing',
        severity: 'error',
        message: `Enabled ${targetName} plane faces require an explicit UV rectangle.`,
        path: `${path}.faces.${direction}.uv`,
        entityIds: [nodeId],
      });
    if (face.textureId !== null) textured = true;
    if (
      node.tags?.includes('canonical-presentation') === true &&
      face.materialInstance !== 'cutout'
    ) {
      add({
        code: 'format.unsupported_data',
        severity: 'error',
        message: `${targetName} canonical alpha planes require the cutout material instance.`,
        path: `${path}.faces.${direction}.materialInstance`,
        entityIds: [nodeId],
      });
    }
  }
  if (textureCount > 0 && !textured)
    add({
      code: 'format.texture_missing',
      severity: 'warning',
      message: `${targetName} plane "${node.name}" has no texture.`,
      path: `${path}.faces`,
      entityIds: [nodeId],
    });
};

const validateActorBone = (
  node: Extract<ProjectDocument['scene']['nodes'][string], { kind: 'bone' }>,
  nodeId: string,
  path: string,
  targetName: string,
  boneNames: Map<string, string>,
  add: FindingSink,
): void => {
  const existing = boneNames.get(node.name);
  if (existing) {
    add({
      code: 'format.invalid_identifier',
      severity: 'error',
      message: `${targetName} bone name "${node.name}" is duplicated.`,
      path: `${path}.name`,
      entityIds: [existing, nodeId],
    });
  }
  boneNames.set(node.name, nodeId);
  if (!isIdentityPosition(node.transform.position) || !isIdentityScale(node.transform.scale)) {
    add({
      code: 'format.unbaked_transform',
      severity: 'error',
      message: `${targetName} bone position and scale must be baked; pivot and rotation remain supported.`,
      path: `${path}.transform`,
      entityIds: [nodeId],
    });
  }
};

const validateActorLocator = (
  node: Extract<ProjectDocument['scene']['nodes'][string], { kind: 'locator' }>,
  nodeId: string,
  path: string,
  targetName: string,
  locatorNames: Map<string, string>,
  add: FindingSink,
): void => {
  const existing = locatorNames.get(node.name);
  if (existing) {
    add({
      code: 'format.invalid_identifier',
      severity: 'error',
      message: `${targetName} locator name "${node.name}" is duplicated.`,
      path: `${path}.name`,
      entityIds: [existing, nodeId],
    });
  }
  locatorNames.set(node.name, nodeId);
  if (node.parentId === null) {
    add({
      code: 'format.unsupported_data',
      severity: 'error',
      message: `${targetName} locators must be parented to a bone.`,
      path: `${path}.parentId`,
      entityIds: [nodeId],
    });
  }
  if (!isIdentityScale(node.transform.scale)) {
    add({
      code: 'format.unbaked_transform',
      severity: 'error',
      message: `${targetName} locators cannot carry scale.`,
      path: `${path}.transform.scale`,
      entityIds: [nodeId],
    });
  }
};

const validateScene = (
  document: ExportAdaptedDocument,
  profile: ActorProfile,
  textureCount: number,
  add: FindingSink,
): void => {
  const targetName = targetNameFor(profile);
  const boneNames = new Map<string, string>();
  const locatorNames = new Map<string, string>();
  for (const [nodeId, node] of Object.entries(document.scene.nodes)) {
    const path = `scene.nodes.${nodeId}`;
    if (!isSceneNodeEffectivelyVisible(document, nodeId)) continue;
    if (node.kind === 'bone') {
      validateActorBone(node, nodeId, path, targetName, boneNames, add);
      continue;
    }
    if (node.kind === 'locator') {
      validateActorLocator(node, nodeId, path, targetName, locatorNames, add);
      continue;
    }
    if (node.kind === 'plane') {
      validateActorPlane(node, nodeId, path, targetName, textureCount, add);
      continue;
    }
    validateActorCube(node, nodeId, path, targetName, textureCount, add);
  }

  const hasVisibleLooseCube = Object.values(document.scene.nodes).some(
    (node) => node.kind === 'cube' && node.visible && node.parentId === null,
  );
  const syntheticCollision = boneNames.get('ashfox_root');
  if (hasVisibleLooseCube && syntheticCollision) {
    add({
      code: 'format.invalid_identifier',
      severity: 'error',
      message: `${targetName} reserves bone name "ashfox_root" when visible root cubes exist.`,
      path: `scene.nodes.${syntheticCollision}.name`,
      entityIds: [syntheticCollision],
    });
  }
};

const validateTextures = (
  document: ExportAdaptedDocument,
  profile: ActorProfile,
  add: FindingSink,
): void => {
  const targetName = targetNameFor(profile);
  const texturePaths = new Map<string, string>();
  for (const [assetId, texture] of Object.entries(document.textures)) {
    if (!texture.minecraft) {
      add({
        code: 'format.texture_binding_missing',
        severity: 'error',
        message: `${targetName} bundles require a Minecraft resource binding for every texture.`,
        path: `textures.${assetId}.minecraft`,
        assetIds: [assetId],
      });
      continue;
    }
    validateResourceLocation(
      texture.minecraft.resource,
      `textures.${assetId}.minecraft.resource`,
      add,
    );
    if (texture.minecraft.resource.path.endsWith('.png')) {
      add({
        code: 'format.invalid_resource_path',
        severity: 'error',
        message: 'Minecraft texture resource paths must omit the .png extension.',
        path: `textures.${assetId}.minecraft.resource.path`,
        assetIds: [assetId],
      });
    }
    const outputTexturePath =
      profile.id === 'minecraft.java.geckolib5'
        ? `${texture.minecraft.resource.namespace}:${texture.minecraft.resource.path}`
        : texture.minecraft.resource.path;
    const existingPath = texturePaths.get(outputTexturePath);
    if (existingPath && existingPath !== assetId) {
      add({
        code: 'format.texture_path_duplicate',
        severity: 'error',
        message: `${targetName} texture output "${outputTexturePath}.png" is used by multiple assets.`,
        path: `textures.${assetId}.minecraft.resource.path`,
        assetIds: [existingPath, assetId],
      });
    }
    texturePaths.set(outputTexturePath, assetId);
    if (texture.source.contentType !== 'image/png' || texture.minecraft.extension !== 'png') {
      add({
        code: 'format.texture_type_unsupported',
        severity: 'error',
        message: `${targetName} resource textures must be PNG files.`,
        path: `textures.${assetId}.source.contentType`,
        assetIds: [assetId],
      });
    }
  }
};

const validateAnimationChannels = (
  document: ExportAdaptedDocument,
  profile: ActorProfile,
  add: FindingSink,
): void => {
  const targetName = targetNameFor(profile);
  for (const [clipId, clip] of Object.entries(document.animations)) {
    const clipPath = `animations.${clipId}`;
    const targetProperties = new Map<string, string>();
    for (const [channelId, channel] of Object.entries(clip.channels)) {
      const channelPath = `${clipPath}.channels.${channelId}`;
      const target = document.scene.nodes[channel.targetNodeId];
      if (target && !isSceneNodeEffectivelyVisible(document, channel.targetNodeId)) {
        continue;
      }
      if (target && target.kind !== 'bone') {
        add({
          code: 'format.unsupported_data',
          severity: 'error',
          message: `${targetName} transform channels may only target bones.`,
          path: `${channelPath}.targetNodeId`,
          entityIds: [channel.targetNodeId],
          clipIds: [clipId],
        });
      }
      const targetProperty = `${channel.targetNodeId}:${channel.property}`;
      const existingChannel = targetProperties.get(targetProperty);
      if (existingChannel) {
        add({
          code: 'animation.channel_duplicate',
          severity: 'error',
          message: `${targetName} allows one ${channel.property} channel per bone and clip.`,
          path: channelPath,
          clipIds: [clipId],
        });
      }
      targetProperties.set(targetProperty, channelId);
    }
  }
};

export const validateMinecraftActorProfile = (
  document: ExportAdaptedDocument,
  add: FindingSink,
): void => {
  const profile = document.formatProfile;
  if (profile.id !== 'minecraft.bedrock' && profile.id !== 'minecraft.java.geckolib5') {
    return;
  }
  validateProfile(profile, add);
  const textureCount = Object.keys(document.textures).length;
  if (textureCount === 0) {
    const targetName = targetNameFor(profile);
    add({
      code: 'format.texture_missing',
      severity: 'warning',
      message: `${targetName} project has no texture and is not production ready.`,
      path: 'textures',
      fix: 'Create a texture explicitly or omit cube textureId to provision the default texture.',
    });
  }
  validateScene(document, profile, textureCount, add);
  validateTextures(document, profile, add);
  validateAnimationChannels(document, profile, add);
};
