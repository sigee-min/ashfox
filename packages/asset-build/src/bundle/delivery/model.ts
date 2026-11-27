import {
  encodeCanonicalPng,
  evaluateAssetQuality,
  exportProductionProjectResolved,
  formatDeliveryGateFailure,
  hasHooksContent,
  openAssetProject,
  rasterizeTexture,
  type ExportAdapterInput,
} from '@ashfox/engine-core';
import { BuildFailure } from '../contract';
import {
  collectBundleArtifacts,
  type DeliveryArtifacts,
  type DeliveryCompileContext,
  type DeliveryTarget,
  type OpenedProject,
  type ProductByKind,
  type ProductDeliveryStrategy,
} from './contract';

export const openModelProject = (
  product: ProductByKind['model'],
  revision: string,
): OpenedProject => {
  const opened = openAssetProject({
    workspace: product.workspace,
    entry: product.entry,
    identity: { id: 'cli', revision, createdAt: '2000-01-01T00:00:00.000Z' },
  });
  if (!opened.ok) throw new BuildFailure('export.project', JSON.stringify(opened));
  return opened;
};

const modelAdapterForTarget = (target: DeliveryTarget): ExportAdapterInput => {
  if (
    target.format === 'java_block' ||
    target.format === 'geckolib5' ||
    target.format === 'bedrock'
  ) {
    return {
      target: target.format,
      namespace: target.namespace ?? 'ashfox',
      modelPath: target.modelPath ?? target.name,
    };
  }
  return {
    target: target.format === 'gltf' ? 'gltf' : 'glb',
    modelPath: target.modelPath || target.name,
  };
};

const compileModelArtifacts = async (
  target: DeliveryTarget,
  product: ProductByKind['model'],
  context: DeliveryCompileContext,
): Promise<DeliveryArtifacts> => {
  if (target.format === 'png' || target.format === 'wav' || target.format === 'java_structure') {
    throw new BuildFailure('export.format', target.name);
  }
  const opened = context.resolveModelProject
    ? context.resolveModelProject(product)
    : openModelProject(product, context.buildKey);
  const document = opened.project.document;
  const textures = new Map(Object.values(document.textures).map((t) => [t.source.key, t]));
  const gltfOptions =
    target.format === 'glb' || target.format === 'gltf'
      ? {
          encoding: target.encoding ?? 'portable',
          ...(hasHooksContent(product.hooks) ? { hooks: product.hooks } : {}),
        }
      : {};
  const bundle = await exportProductionProjectResolved(
    opened.project,
    modelAdapterForTarget(target),
    {
      resolveBlob: async (ref) => {
        const texture = textures.get(ref.key);
        return texture
          ? {
              bytes: encodeCanonicalPng(rasterizeTexture(document, texture)),
              contentType: 'image/png',
            }
          : null;
      },
      ...gltfOptions,
    },
  );
  return collectBundleArtifacts(
    bundle.files,
    Boolean(context.extractLineage),
    target.name,
    product.hooks,
  );
};

export const modelDeliveryStrategy: ProductDeliveryStrategy<ProductByKind['model']> = {
  kind: 'model',
  assertGate: (targetName, product) => {
    const hasProfile = product.model.profile !== undefined;
    const audit = evaluateAssetQuality({ model: product.model, telemetry: product.telemetry });
    if (!hasProfile) {
      throw new BuildFailure(
        'quality.profile-required',
        formatDeliveryGateFailure(targetName, false, audit),
        3,
      );
    }
    if (!audit.passed) {
      throw new BuildFailure('quality.gate', formatDeliveryGateFailure(targetName, true, audit), 3);
    }
  },
  compileArtifacts: compileModelArtifacts,
  buildMetadata: (product, performance) => ({
    clips: Object.values(product.model.animations).map((clip) => ({
      name: clip.name,
      durationSeconds: clip.durationSeconds,
    })),
    ...(performance ? { performance } : {}),
  }),
  performanceKind: (product) => (product.model.profile === 'creature' ? 'creature' : 'prop'),
};
