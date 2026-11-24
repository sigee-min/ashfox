import type { ExportAdaptedDocument, ExportTextureAsset } from '../../adapter';
import type { AssetBuildIdentity } from '../../../project/asset';
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
  const binding = texture.minecraft;
  return createTextureExportFile(
    document,
    texture,
    `assets/${binding.resource.namespace}/textures/${binding.resource.path}.${binding.extension}`,
  );
};

const buildGeckoLib5Geometry = (
  document: ExportAdaptedDocument,
  profile: Extract<
    ExportAdaptedDocument['formatProfile'],
    {
      id: 'minecraft.java.geckolib5';
    }
  >,
) => {
  return buildMinecraftGeometry(document, {
    formatVersion: profile.geometryFormatVersion,
    identifier: profile.geometryIdentifier,
    ...(profile.visibleBounds ? { visibleBounds: profile.visibleBounds } : {}),
  });
};

const buildGeckoLib5Animations = (
  document: ExportAdaptedDocument,
  profile: Extract<
    ExportAdaptedDocument['formatProfile'],
    {
      id: 'minecraft.java.geckolib5';
    }
  >,
) => {
  return buildMinecraftActorAnimation(document, {
    formatVersion: profile.animationFormatVersion,
    dialect: 'geckolib5',
  });
};

export const exportGeckoLib5 = (
  document: ExportAdaptedDocument,
  build: AssetBuildIdentity,
): ExportBundle => {
  const validation = validateExportTarget(document, {
    profileId: 'minecraft.java.geckolib5',
    errorMessage: 'GeckoLib 5 export validation failed.',
  });
  const validatedDocument = validation.document;
  const profile = validation.profile;
  const modelPath = `assets/${profile.namespace}/geckolib/models/${profile.assetKind}/${profile.modelPath}.geo.json`;
  const animationPath = `assets/${profile.namespace}/geckolib/animations/${profile.assetKind}/${profile.animationPath}.animation.json`;
  const textureFiles = Object.values(validatedDocument.textures)
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((texture) => createTextureCopy(validatedDocument, texture));

  return createExportBundle(validatedDocument, build, validation.findings, {
    target: exportTargetDescriptorForPreset('geckolib5').target,
    rootPath: 'src/main/resources',
    entrypoints: [modelPath, animationPath],
    files: [
      createCompactJsonExportFile(
        'geometry',
        modelPath,
        buildGeckoLib5Geometry(validatedDocument, profile),
      ),
      createCompactJsonExportFile(
        'animation',
        animationPath,
        buildGeckoLib5Animations(validatedDocument, profile),
      ),
      ...textureFiles,
    ],
  });
};
