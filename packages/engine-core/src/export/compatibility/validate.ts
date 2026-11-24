import type {
  Gltf2ExportProfile,
  MinecraftBedrockExportProfile,
  MinecraftJavaBlockExportProfile,
  MinecraftJavaGeckoLib5ExportProfile,
} from '../adapter/contract';
import type { ExportAdaptedDocument } from '../adapter';
import type { InvariantFinding } from '../../validation/contract';
import { exportCompatibilityFor, type ExportPreset } from '../compatibility';

type ProfileCheck = readonly [path: string, actual: unknown, expected: unknown];

const supportedGameVersionText = (target: ExportPreset): string => {
  const entry = exportCompatibilityFor(target);
  return entry === null || entry.profile.id === 'gltf.2' ? '' : entry.profile.minecraftVersion;
};

const unsupportedGameVersion = (target: ExportPreset, value: unknown): InvariantFinding => ({
  code: 'format.unsupported_data',
  severity: 'error',
  message: `Game version "${String(value)}" is not supported by ${target}.`,
  path: 'formatProfile.minecraftVersion',
  fix: `Use the current version: ${supportedGameVersionText(target)}.`,
});

const mismatchFindings = (
  checks: readonly ProfileCheck[],
  message: (path: string, expected: unknown) => string,
): readonly InvariantFinding[] =>
  checks
    .filter(([, actual, expected]) => actual !== expected)
    .map(([path, , expected]) => ({
      code: 'format.unsupported_data',
      severity: 'error',
      message: message(path, expected),
      path,
    }));

const validateGltfProfile = (profile: Gltf2ExportProfile): readonly InvariantFinding[] => {
  const target = profile.container === 'glb' ? 'glb' : 'gltf';
  const compatibility = exportCompatibilityFor(target);
  const checks: readonly ProfileCheck[] = [
    ['formatProfile.version', profile.version, compatibility?.profile.version],
    ['formatProfile.container', profile.container, compatibility?.profile.container],
    ['formatProfile.imageStorage', profile.imageStorage, compatibility?.profile.imageStorage],
  ];
  return checks
    .filter(([, actual, expected]) => actual !== expected)
    .map(([path, , expected]) => ({
      code: 'format.unsupported_data',
      severity: 'error',
      path,
      message: `${target} requires the current canonical ${path.split('.').at(-1)} value ${String(expected)}.`,
    }));
};

const validateJavaBlockProfile = (
  profile: MinecraftJavaBlockExportProfile,
): readonly InvariantFinding[] => {
  const compatibility = exportCompatibilityFor('java_block');
  if (!compatibility || profile.minecraftVersion !== compatibility.profile.minecraftVersion) {
    return [unsupportedGameVersion('java_block', profile.minecraftVersion)];
  }
  const findings: InvariantFinding[] = [];
  if (profile.resourcePackFormat !== compatibility.profile.resourcePackFormat) {
    findings.push({
      code: 'format.unsupported_data',
      severity: 'error',
      message:
        `Java ${profile.minecraftVersion} requires resource pack format ` +
        `${compatibility.profile.resourcePackFormat}.`,
      path: 'formatProfile.resourcePackFormat',
    });
  }
  if (profile.modelKind !== compatibility.profile.modelKind) {
    findings.push({
      code: 'format.unsupported_data',
      severity: 'error',
      message: `Java ${profile.minecraftVersion} requires the current canonical model kind ${compatibility.profile.modelKind}.`,
      path: 'formatProfile.modelKind',
    });
  }
  return findings;
};

const validateBedrockProfile = (
  profile: MinecraftBedrockExportProfile,
): readonly InvariantFinding[] => {
  const compatibility = exportCompatibilityFor('bedrock');
  if (!compatibility || profile.minecraftVersion !== compatibility.profile.minecraftVersion) {
    return [unsupportedGameVersion('bedrock', profile.minecraftVersion)];
  }
  const expected = compatibility.profile;
  return mismatchFindings(
    [
      [
        'formatProfile.geometryFormatVersion',
        profile.geometryFormatVersion,
        expected.geometryFormatVersion,
      ],
      [
        'formatProfile.animationFormatVersion',
        profile.animationFormatVersion,
        expected.animationFormatVersion,
      ],
      ['formatProfile.geometryKind', profile.geometryKind, expected.geometryKind],
    ],
    (_, value) => `Bedrock ${profile.minecraftVersion} requires format version ${value}.`,
  );
};

const validateGeckoLibProfile = (
  profile: MinecraftJavaGeckoLib5ExportProfile,
): readonly InvariantFinding[] => {
  const compatibility = exportCompatibilityFor('geckolib5');
  if (!compatibility || profile.minecraftVersion !== compatibility.profile.minecraftVersion) {
    return [unsupportedGameVersion('geckolib5', profile.minecraftVersion)];
  }
  const expected = compatibility.profile;
  return mismatchFindings(
    [
      [
        'formatProfile.geometryFormatVersion',
        profile.geometryFormatVersion,
        expected.geometryFormatVersion,
      ],
      [
        'formatProfile.animationFormatVersion',
        profile.animationFormatVersion,
        expected.animationFormatVersion,
      ],
      ['formatProfile.assetKind', profile.assetKind, expected.assetKind],
    ],
    (_, value) =>
      `GeckoLib 5 on Java ${profile.minecraftVersion} requires ` + `format version ${value}.`,
  );
};

export const validateExportCompatibilityProfile = (
  document: ExportAdaptedDocument,
): readonly InvariantFinding[] => {
  const profile = document.formatProfile;
  switch (profile.id) {
    case 'gltf.2':
      return validateGltfProfile(profile);
    case 'minecraft.java_block':
      return validateJavaBlockProfile(profile);
    case 'minecraft.bedrock':
      return validateBedrockProfile(profile);
    case 'minecraft.java.geckolib5':
      return validateGeckoLibProfile(profile);
    default:
      return [];
  }
};
