import { checkSnapshot, compileVfxFiles } from '../bundle/compile';
import { BuildFailure, type Artifact, type AssetMetadata, type Snapshot } from '../bundle/contract';
import { readDirectoryWorkspace, type DirectoryFile } from '@ashfox/engine-core';

const makeVfxSnapshot = (configuration: string, files: readonly DirectoryFile[]): Snapshot => ({
  input: '.ashfoxworkspace',
  root: '',
  configuration,
  config: readDirectoryWorkspace(configuration),
  files,
  hash: '',
});

export const runBuildVfxTask = (task: {
  readonly configuration: string;
  readonly files: readonly DirectoryFile[];
  readonly targets: readonly { readonly name: string }[];
}): {
  readonly kind: 'build-entry';
  readonly productKind: 'vfx';
  readonly metadata: AssetMetadata;
  readonly targets: readonly { readonly targetName: string; readonly files: readonly Artifact[] }[];
} => {
  const checked = checkSnapshot(makeVfxSnapshot(task.configuration, task.files));
  const product = checked.products[0];
  if (product?.kind !== 'vfx') throw new BuildFailure('export.kind', 'Expected vfx');
  const { stats, durationSeconds, fps } = product.vfx;
  return {
    kind: 'build-entry',
    productKind: 'vfx',
    metadata: {
      durationSeconds,
      fps,
      drawCalls: stats.drawCalls,
      triangles: stats.triangles,
      particleCount: stats.particleCount,
    },
    targets: task.targets.map((target) => ({
      targetName: target.name,
      files: compileVfxFiles(
        {
          name: target.name,
          format: 'glb',
          entry: { packageName: 'vfx', entryName: target.name },
          directory: target.name,
        },
        product,
      ),
    })),
  };
};
