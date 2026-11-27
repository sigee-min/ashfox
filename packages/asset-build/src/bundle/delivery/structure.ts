import { exportStructureGltfResolved } from '@ashfox/engine-core';
import { encodeUtf8 } from '@ashfox/internal-contracts';
import { json } from '../../shared/digest';
import { BuildFailure } from '../contract';
import {
  appendHooksArtifact,
  collectBundleArtifacts,
  type DeliveryArtifacts,
  type DeliveryCompileContext,
  type DeliveryTarget,
  type ProductByKind,
  type ProductDeliveryStrategy,
} from './contract';

const compileStructureArtifacts = async (
  target: DeliveryTarget,
  product: ProductByKind['structure'],
  context: DeliveryCompileContext,
): Promise<DeliveryArtifacts> => {
  const hooks = product.structure.hooks;
  if (target.format === 'java_structure') {
    return {
      files: appendHooksArtifact(
        [{ path: `${target.name}.nbt`, bytes: product.structure.nbt }],
        target.name,
        hooks,
      ),
    };
  }
  if (target.format !== 'glb') throw new BuildFailure('export.format', target.name);
  const bundle = await exportStructureGltfResolved(
    product.structure,
    target.name,
    context.buildKey,
    { encoding: target.encoding ?? 'portable' },
  );
  const { files, lineageTemplate } = collectBundleArtifacts(
    bundle.files,
    Boolean(context.extractLineage),
    target.name,
  );
  const metaPath = `${target.name}.structure.json`;
  if (!files.some((file) => file.path === metaPath)) {
    files.push({ path: metaPath, bytes: encodeUtf8(json(product.structure.playableMeta)) });
  }
  appendHooksArtifact(files, target.name, hooks);
  return { files, lineageTemplate };
};

export const structureDeliveryStrategy: ProductDeliveryStrategy<ProductByKind['structure']> = {
  kind: 'structure',
  assertGate: (targetName, product) => {
    if (!product.structure.audit.passed) {
      throw new BuildFailure(
        'quality.gate',
        `Structure "${targetName}" scored ${product.structure.audit.score}/100 (requires >= ${product.structure.audit.threshold}).`,
        3,
      );
    }
  },
  compileArtifacts: compileStructureArtifacts,
  buildMetadata: (product, performance) => ({
    size: product.structure.grid.size,
    blockCount: product.structure.audit.metrics.blockCount,
    interiorCells: product.structure.audit.metrics.interiorCells,
    zoneCount: product.structure.playableMeta.zones.length,
    lightCount: product.structure.playableMeta.lights.length,
    interactableCount: product.structure.playableMeta.interactables.length,
    ...(performance ? { performance } : {}),
  }),
  performanceKind: (product) =>
    product.structure.grid.size[0] * product.structure.grid.size[2] > 900
      ? 'compound'
      : 'structure',
};
