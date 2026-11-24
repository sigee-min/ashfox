import type { ExportAdaptedDocument } from '../../adapter';
import type { AssetBuildIdentity } from '../../../project/asset';
import type { InvariantFinding } from '../../../validation/contract';
import { createCompactJsonExportFile } from '../../json';
import { createExportBundle } from '../../pipeline/bundle';
import type { BinaryExportFile, ExportBundle } from '../../contract';
import type { CompiledGltf } from './build';
import { buildGlb } from './glb';
import { exportTargetDescriptorForPreset } from '../../compatibility';
import { assertValidatedExportTargetDocument } from '../../pipeline/validate';

export const createGltfBundle = (
  document: ExportAdaptedDocument,
  build: AssetBuildIdentity,
  compiled: CompiledGltf,
  findings: readonly InvariantFinding[],
): ExportBundle => {
  assertValidatedExportTargetDocument(document, ['glb', 'gltf']);
  const profile = document.formatProfile;
  if (profile.id !== 'gltf.2') {
    throw new Error('Project does not use the gltf.2 profile.');
  }
  const modelPath = `${profile.modelPath}.${profile.container}`;
  const binaryPath = `${profile.modelPath}.bin`;
  const modelFile =
    profile.container === 'gltf'
      ? createCompactJsonExportFile('model', modelPath, compiled.document, 'model/gltf+json')
      : ({
          kind: 'binary',
          role: 'model',
          path: modelPath,
          contentType: 'model/gltf-binary',
          data: buildGlb(compiled.document, compiled.binary),
        } satisfies BinaryExportFile);
  const binaryFiles: BinaryExportFile[] =
    profile.container === 'gltf' && compiled.binary.byteLength > 0
      ? [
          {
            kind: 'binary',
            role: 'buffer',
            path: binaryPath,
            contentType: 'application/octet-stream',
            data: compiled.binary,
          },
        ]
      : [];

  return createExportBundle(document, build, findings, {
    target: exportTargetDescriptorForPreset(profile.container).target,
    rootPath: 'gltf',
    entrypoints: [modelPath],
    files: [modelFile, ...binaryFiles, ...compiled.textureFiles],
  });
};
