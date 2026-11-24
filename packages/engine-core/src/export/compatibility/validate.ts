import type { ExportAdaptedDocument } from '../adapter';
import type { InvariantFinding } from '../../validation/contract';
import { exportCompatibilityFor, type ExportPreset } from '../compatibility';

const supportedGameVersionText = (target: ExportPreset): string => {
  const entry = exportCompatibilityFor(target);
  return entry === null || entry.profile.id === 'gltf.2' ? '' : entry.profile.minecraftVersion;
};

export const validateExportCompatibilityProfile = (
  document: ExportAdaptedDocument,
): readonly InvariantFinding[] => {
  const findings: InvariantFinding[] = [];
  const profile = document.formatProfile;
  const unsupportedGameVersion = (target: ExportPreset, value: unknown, path: string): void => {
    findings.push({
      code: 'format.unsupported_data',
      severity: 'error',
      message: `Game version "${String(value)}" is not supported by ${target}.`,
      path,
      fix: `Use the current version: ${supportedGameVersionText(target)}.`,
    });
  };

  if (profile.id === 'gltf.2') {
    const target = profile.container === 'glb' ? 'glb' : 'gltf';
    const compatibility = exportCompatibilityFor(target);
    for (const [path, actual, expected] of [
      ['formatProfile.version', profile.version, compatibility?.profile.version],
      ['formatProfile.container', profile.container, compatibility?.profile.container],
      ['formatProfile.imageStorage', profile.imageStorage, compatibility?.profile.imageStorage],
    ] as const)
      if (actual !== expected)
        findings.push({
          code: 'format.unsupported_data',
          severity: 'error',
          path,
          message: `${target} requires the current canonical ${path.split('.').at(-1)} value ${String(expected)}.`,
        });
    return findings;
  }

  if (profile.id === 'minecraft.java_block') {
    const compatibility = exportCompatibilityFor('java_block');
    if (!compatibility || profile.minecraftVersion !== compatibility.profile.minecraftVersion) {
      unsupportedGameVersion(
        'java_block',
        profile.minecraftVersion,
        'formatProfile.minecraftVersion',
      );
      return findings;
    }
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
    if (profile.modelKind !== compatibility.profile.modelKind)
      findings.push({
        code: 'format.unsupported_data',
        severity: 'error',
        message: `Java ${profile.minecraftVersion} requires the current canonical model kind ${compatibility.profile.modelKind}.`,
        path: 'formatProfile.modelKind',
      });
    return findings;
  }

  if (profile.id === 'minecraft.bedrock') {
    const compatibility = exportCompatibilityFor('bedrock');
    if (!compatibility || profile.minecraftVersion !== compatibility.profile.minecraftVersion) {
      unsupportedGameVersion('bedrock', profile.minecraftVersion, 'formatProfile.minecraftVersion');
      return findings;
    }
    for (const [path, actual, expected] of [
      [
        'formatProfile.geometryFormatVersion',
        profile.geometryFormatVersion,
        compatibility.profile.geometryFormatVersion,
      ],
      [
        'formatProfile.animationFormatVersion',
        profile.animationFormatVersion,
        compatibility.profile.animationFormatVersion,
      ],
      ['formatProfile.geometryKind', profile.geometryKind, compatibility.profile.geometryKind],
    ] as const) {
      if (actual === expected) continue;
      findings.push({
        code: 'format.unsupported_data',
        severity: 'error',
        message: `Bedrock ${profile.minecraftVersion} requires format version ${expected}.`,
        path,
      });
    }
    return findings;
  }

  if (profile.id !== 'minecraft.java.geckolib5') {
    return findings;
  }

  const compatibility = exportCompatibilityFor('geckolib5');
  if (!compatibility || profile.minecraftVersion !== compatibility.profile.minecraftVersion) {
    unsupportedGameVersion('geckolib5', profile.minecraftVersion, 'formatProfile.minecraftVersion');
    return findings;
  }
  for (const [path, actual, expected] of [
    [
      'formatProfile.geometryFormatVersion',
      profile.geometryFormatVersion,
      compatibility.profile.geometryFormatVersion,
    ],
    [
      'formatProfile.animationFormatVersion',
      profile.animationFormatVersion,
      compatibility.profile.animationFormatVersion,
    ],
    ['formatProfile.assetKind', profile.assetKind, compatibility.profile.assetKind],
  ] as const) {
    if (actual === expected) continue;
    findings.push({
      code: 'format.unsupported_data',
      severity: 'error',
      message:
        `GeckoLib 5 on Java ${profile.minecraftVersion} requires ` + `format version ${expected}.`,
      path,
    });
  }
  return findings;
};
