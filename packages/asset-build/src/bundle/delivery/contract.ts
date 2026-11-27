import {
  compileDirectoryWorkspace,
  evaluateGlbPerformance,
  hasHooksContent,
  openAssetProject,
  type ExportFile,
  type GlbPerformanceMetrics,
  type HooksDocument,
} from '@ashfox/engine-core';
import { encodeUtf8 } from '@ashfox/internal-contracts';
import { json } from '../../shared/digest';
import { BuildFailure, type Artifact, type AssetMetadata } from '../contract';

export type CompiledWorkspace = Extract<
  ReturnType<typeof compileDirectoryWorkspace>,
  { readonly ok: true }
>;
export type CompiledProduct = CompiledWorkspace['products'][number];
export type ProductKind = CompiledProduct['kind'];
export type ProductByKind = {
  readonly [K in ProductKind]: Extract<CompiledProduct, { readonly kind: K }>;
};
export type OpenedProject = Extract<ReturnType<typeof openAssetProject>, { readonly ok: true }>;
export type GlbPerformanceKind = 'creature' | 'prop' | 'structure' | 'compound';

export interface DeliveryTarget {
  readonly name: string;
  readonly format:
    'png' | 'glb' | 'gltf' | 'wav' | 'java_structure' | 'java_block' | 'geckolib5' | 'bedrock';
  readonly encoding?: 'portable' | 'optimized';
  readonly namespace?: string;
  readonly modelPath?: string;
}

export interface DeliveryCompileContext {
  readonly buildKey: string;
  readonly extractLineage?: boolean;
  readonly resolveModelProject?: (product: ProductByKind['model']) => OpenedProject;
}

export interface DeliveryArtifacts {
  readonly files: readonly Artifact[];
  readonly lineageTemplate?: Record<string, unknown>;
}

export interface ProductDeliveryStrategy<TProduct extends CompiledProduct> {
  readonly kind: TProduct['kind'];
  readonly assertGate: (targetName: string, product: TProduct) => void;
  readonly compileArtifacts: (
    target: DeliveryTarget,
    product: TProduct,
    context: DeliveryCompileContext,
  ) => Promise<DeliveryArtifacts> | DeliveryArtifacts;
  readonly buildMetadata: (product: TProduct, performance?: GlbPerformanceMetrics) => AssetMetadata;
  readonly performanceKind?: (product: TProduct) => GlbPerformanceKind | undefined;
}

export const evaluateGlbBudget = (
  target: Pick<DeliveryTarget, 'name' | 'format' | 'encoding'>,
  perfKind: GlbPerformanceKind | undefined,
  files: readonly Artifact[],
): GlbPerformanceMetrics | undefined => {
  if (!perfKind || target.format !== 'glb') return undefined;
  const glb = files.find((file) => file.path.endsWith('.glb'));
  if (!glb) return undefined;
  const report = evaluateGlbPerformance(glb.bytes, perfKind);
  if (target.encoding === 'optimized' && !report.passed) {
    throw new BuildFailure(
      'quality.gate',
      `GLB "${target.name}" exceeded ${perfKind} performance budget: ${report.violations.map((v) => v.message).join(' ')}`,
      3,
    );
  }
  return report.metrics;
};

export const appendHooksArtifact = (
  files: Artifact[],
  targetName: string,
  hooks?: HooksDocument,
): Artifact[] => {
  if (hasHooksContent(hooks)) {
    files.push({ path: `${targetName}.hooks.json`, bytes: encodeUtf8(json(hooks)) });
  }
  return files;
};

const isJsonRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const collectBundleArtifacts = (
  bundleFiles: readonly ExportFile[],
  extractLineage: boolean,
  targetName: string,
  hooks?: HooksDocument,
): { readonly files: Artifact[]; readonly lineageTemplate?: Record<string, unknown> } => {
  const files: Artifact[] = [];
  let lineageTemplate: Record<string, unknown> | undefined;
  for (const file of bundleFiles) {
    if (file.kind === 'blob-copy') throw new BuildFailure('export.unresolved', file.path);
    if (
      extractLineage &&
      file.path === 'ashfox-lineage.json' &&
      file.kind === 'json' &&
      isJsonRecord(file.data)
    ) {
      lineageTemplate = file.data;
      continue;
    }
    files.push({
      path: file.path,
      bytes: file.kind === 'binary' ? file.data : encodeUtf8(json(file.data)),
    });
  }
  appendHooksArtifact(files, targetName, hooks);
  return { files, lineageTemplate };
};
