import { readDirectoryWorkspace, type DirectoryFile } from '@ashfox/engine-core';
import { checkSnapshot } from '../bundle/compile';
import { BuildFailure, type Artifact, type AssetMetadata, type Snapshot } from '../bundle/contract';
import { PRODUCT_DELIVERY_REGISTRY, deliverProductTarget } from '../bundle/delivery/registry';

const makeVfxSnapshot = (configuration: string, files: readonly DirectoryFile[]): Snapshot => ({
  input: '.ashfoxworkspace',
  root: '',
  configuration,
  config: readDirectoryWorkspace(configuration),
  files,
  hash: '',
});

export const runBuildVfxTask = async (task: {
  readonly configuration: string;
  readonly files: readonly DirectoryFile[];
  readonly targets: readonly { readonly name: string }[];
}): Promise<{
  readonly kind: 'build-entry';
  readonly productKind: 'vfx';
  readonly metadata: AssetMetadata;
  readonly targets: readonly { readonly targetName: string; readonly files: readonly Artifact[] }[];
}> => {
  const checked = checkSnapshot(makeVfxSnapshot(task.configuration, task.files));
  const product = checked.products[0];
  if (product?.kind !== 'vfx') throw new BuildFailure('export.kind', 'Expected vfx');
  const targets = await Promise.all(
    task.targets.map(async (target) => ({
      targetName: target.name,
      files: (
        await deliverProductTarget({ name: target.name, format: 'glb' }, product, { buildKey: '' })
      ).files,
    })),
  );
  return {
    kind: 'build-entry',
    productKind: 'vfx',
    metadata: PRODUCT_DELIVERY_REGISTRY.vfx.buildMetadata(product),
    targets,
  };
};
