import type { ExportAdaptedDocument, ExportTextureAsset } from '../../adapter';
import type { AssetBuildIdentity } from '../../../project/asset';
import type { MinecraftBedrockExportProfile } from '../../adapter/contract';
import { createTextureExportFile } from '../../texture';
import { createCompactJsonExportFile } from '../../json';
import { createExportBundle } from '../../pipeline/bundle';
import { validateExportTarget } from '../../pipeline/validate';
import { buildMinecraftActorAnimation } from '../../minecraft';
import { buildMinecraftGeometry } from '../../minecraft/geometry';
import type { ExportBundle } from '../../contract';
import { exportTargetDescriptorForPreset } from '../../compatibility';

const createTextureCopy = (document: ExportAdaptedDocument, texture: ExportTextureAsset) => {
  if (!texture.minecraft) {
    throw new Error(`Texture "${texture.id}" has no Minecraft binding.`);
  }
  return createTextureExportFile(
    document,
    texture,
    `textures/${texture.minecraft.resource.path}.${texture.minecraft.extension}`,
  );
};

const buildMinecraftBedrockGeometry = (
  document: ExportAdaptedDocument,
  profile: MinecraftBedrockExportProfile,
) => {
  return buildMinecraftGeometry(document, {
    formatVersion: profile.geometryFormatVersion,
    identifier: profile.geometryIdentifier,
    ...(profile.visibleBounds ? { visibleBounds: profile.visibleBounds } : {}),
  });
};

const buildMinecraftBedrockAnimations = (
  document: ExportAdaptedDocument,
  profile: MinecraftBedrockExportProfile,
) => {
  return buildMinecraftActorAnimation(document, {
    formatVersion: profile.animationFormatVersion,
    dialect: 'bedrock',
  });
};

export const exportMinecraftBedrock = (
  document: ExportAdaptedDocument,
  build: AssetBuildIdentity,
): ExportBundle => {
  const validation = validateExportTarget(document, {
    profileId: 'minecraft.bedrock',
    errorMessage: 'Minecraft Bedrock export validation failed.',
  });
  const validatedDocument = validation.document;
  const profile = validation.profile;
  const directory = profile.geometryKind;
  const geometryPath = `models/${directory}/${profile.modelPath}.geo.json`;
  const animationPath = `animations/${profile.animationPath}.animation.json`;
  const geometry = buildMinecraftBedrockGeometry(validatedDocument, profile);
  const hasAnimations = Object.keys(validatedDocument.animations).length > 0;
  const textureFiles = Object.values(validatedDocument.textures)
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((texture) => createTextureCopy(validatedDocument, texture));

  return createExportBundle(validatedDocument, build, validation.findings, {
    target: exportTargetDescriptorForPreset('bedrock').target,
    rootPath: 'bedrock-resource-pack-assets',
    entrypoints: [geometryPath, ...(hasAnimations ? [animationPath] : [])],
    files: [
      createCompactJsonExportFile('geometry', geometryPath, geometry),
      ...(hasAnimations
        ? [
            createCompactJsonExportFile(
              'animation',
              animationPath,
              buildMinecraftBedrockAnimations(validatedDocument, profile),
            ),
          ]
        : []),
      ...textureFiles,
    ],
  });
};
