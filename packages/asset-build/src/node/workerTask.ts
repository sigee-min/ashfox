import { isMainThread, parentPort, workerData } from 'node:worker_threads';
import {
  compileSoundRecipe,
  evaluateSoundQuality,
  formatSoundGateFailure,
  type SoundProduct,
} from '@ashfox/audio-core';
import {
  encodeCanonicalPng,
  evaluateAssetQuality,
  evaluateGlbPerformance,
  evaluateSpriteQuality,
  exportProductionProjectResolved,
  exportStructureGltfResolved,
  formatDeliveryGateFailure,
  formatSpriteGateFailure,
  openAssetProject,
  rasterizeTexture,
  readDirectoryWorkspace,
  type DirectoryFile,
  type ExportAdapterInput,
  type GlbPerformanceMetrics,
  type StructureAuditReport,
  type WorkspaceEntrySelector,
} from '@ashfox/engine-core';
import { encodeUtf8 } from '@ashfox/internal-contracts';
import { checkSnapshot } from '../bundle/compile';
import { BuildFailure, type Artifact, type AssetMetadata, type Snapshot } from '../bundle/contract';
import { json } from '../shared/digest';

export interface TargetExportSpec {
  readonly name: string;
  readonly format:
    'png' | 'glb' | 'gltf' | 'wav' | 'java_structure' | 'java_block' | 'geckolib5' | 'bedrock';
  readonly directory: string;
  readonly encoding?: 'portable' | 'optimized';
  readonly namespace?: string;
  readonly modelPath?: string;
}

export interface TargetOutput {
  readonly targetName: string;
  readonly files: readonly Artifact[];
  readonly lineageTemplate?: Record<string, unknown>;
  readonly performance?: GlbPerformanceMetrics;
}

const evaluateWorkerGlbPerformance = (
  target: TargetExportSpec,
  perfKind: 'creature' | 'prop' | 'structure' | 'compound',
  files: readonly Artifact[],
): GlbPerformanceMetrics | undefined => {
  if (target.format !== 'glb') return undefined;
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

export interface PackageInterfaceDigest {
  readonly name: string;
  readonly interfaceHash: string;
}

export type WorkerTaskInput =
  | {
      readonly kind: 'sound-variant';
      readonly entryPath: string;
      readonly resolvedRecipe: Readonly<Record<string, unknown>>;
      readonly variantId: string;
    }
  | {
      readonly kind: 'sound-audit';
      readonly targetName: string;
      readonly sounds: readonly SoundProduct[];
    }
  | {
      readonly kind: 'check-entry';
      readonly configuration: string;
      readonly files: readonly DirectoryFile[];
    }
  | {
      readonly kind: 'build-sprite';
      readonly configuration: string;
      readonly files: readonly DirectoryFile[];
      readonly targetNames: readonly string[];
    }
  | {
      readonly kind: 'build-structure';
      readonly configuration: string;
      readonly files: readonly DirectoryFile[];
      readonly targets: readonly TargetExportSpec[];
    }
  | {
      readonly kind: 'build-model';
      readonly configuration: string;
      readonly files: readonly DirectoryFile[];
      readonly targets: readonly TargetExportSpec[];
    };

export type WorkerTaskResult =
  | { readonly kind: 'sound-variant'; readonly sound: SoundProduct }
  | { readonly kind: 'sound-audit' }
  | {
      readonly kind: 'check-entry';
      readonly productKind: 'model' | 'sprite' | 'sound' | 'structure';
      readonly entry: WorkspaceEntrySelector;
      readonly audit?: StructureAuditReport;
      readonly pkgInterfaces?: readonly PackageInterfaceDigest[];
    }
  | {
      readonly kind: 'build-entry';
      readonly productKind: 'model' | 'sprite' | 'structure';
      readonly metadata: AssetMetadata;
      readonly audit?: StructureAuditReport;
      readonly pkgInterfaces?: readonly PackageInterfaceDigest[];
      readonly targets: readonly TargetOutput[];
    };

const LINEAGE_PLACEHOLDER_KEY = '0000000000000000000000000000000000000000000000000000000000000000';

const makeSubSnapshot = (configuration: string, files: readonly DirectoryFile[]): Snapshot => ({
  input: '.ashfoxworkspace',
  root: '',
  configuration,
  config: readDirectoryWorkspace(configuration),
  files,
  hash: '',
});

const runSoundVariantTask = (
  task: Extract<WorkerTaskInput, { readonly kind: 'sound-variant' }>,
): WorkerTaskResult => {
  const rawVariants = Array.isArray(task.resolvedRecipe.variants)
    ? (task.resolvedRecipe.variants as readonly Record<string, unknown>[])
    : [];
  const variant = rawVariants.find((v) => v.id === task.variantId);
  if (!variant) throw new BuildFailure('sound.variant', `Missing variant ${task.variantId}`, 3);
  const singleRecipe = { ...task.resolvedRecipe, variants: [variant] };
  const products = compileSoundRecipe(singleRecipe, task.entryPath);
  return { kind: 'sound-variant', sound: products[0]! };
};

const runSoundAuditTask = (
  task: Extract<WorkerTaskInput, { readonly kind: 'sound-audit' }>,
): WorkerTaskResult => {
  const audit = evaluateSoundQuality(task.sounds);
  if (!audit.passed) {
    throw new BuildFailure('quality.gate', formatSoundGateFailure(task.targetName, audit), 3);
  }
  return { kind: 'sound-audit' };
};

const runCheckEntryTask = (
  task: Extract<WorkerTaskInput, { readonly kind: 'check-entry' }>,
): WorkerTaskResult => {
  const checked = checkSnapshot(makeSubSnapshot(task.configuration, task.files));
  const product = checked.products[0]!;
  return {
    kind: 'check-entry',
    productKind: product.kind,
    entry: product.entry,
    ...(product.kind === 'structure' ? { audit: product.structure.audit } : {}),
    ...(product.kind === 'model'
      ? {
          pkgInterfaces: product.workspace.lock.packages.map((p) => ({
            name: p.name,
            interfaceHash: p.interfaceHash,
          })),
        }
      : {}),
  };
};

const runBuildSpriteTask = (
  task: Extract<WorkerTaskInput, { readonly kind: 'build-sprite' }>,
): WorkerTaskResult => {
  const checked = checkSnapshot(makeSubSnapshot(task.configuration, task.files));
  const product = checked.products[0]!;
  if (product.kind !== 'sprite') throw new BuildFailure('workspace.compile', 'Expected sprite', 3);
  const audit = evaluateSpriteQuality(product.sprite);
  const targetOutputs: TargetOutput[] = [];
  for (const targetName of task.targetNames) {
    if (!audit.passed) {
      throw new BuildFailure('quality.gate', formatSpriteGateFailure(targetName, audit), 3);
    }
    targetOutputs.push({
      targetName,
      files: [{ path: `${targetName}.png`, bytes: product.sprite.png }],
    });
  }
  return {
    kind: 'build-entry',
    productKind: 'sprite',
    metadata: { width: product.sprite.receipt.width, height: product.sprite.receipt.height },
    targets: targetOutputs,
  };
};

const structureMetadata = (
  product: Extract<
    ReturnType<typeof checkSnapshot>['products'][number],
    { readonly kind: 'structure' }
  >,
): AssetMetadata => ({
  size: product.structure.grid.size,
  blockCount: product.structure.audit.metrics.blockCount,
  interiorCells: product.structure.audit.metrics.interiorCells,
  zoneCount: product.structure.playableMeta.zones.length,
  lightCount: product.structure.playableMeta.lights.length,
  interactableCount: product.structure.playableMeta.interactables.length,
});

const buildTargetOutput = (
  target: TargetExportSpec,
  perfKind: 'creature' | 'prop' | 'structure' | 'compound',
  files: readonly Artifact[],
  lineageTemplate?: Record<string, unknown>,
): TargetOutput => {
  const performance = evaluateWorkerGlbPerformance(target, perfKind, files);
  const out: TargetOutput = { targetName: target.name, files };
  return {
    ...out,
    ...(lineageTemplate ? { lineageTemplate } : {}),
    ...(performance ? { performance } : {}),
  };
};

const runBuildStructureTarget = async (
  product: Extract<
    ReturnType<typeof checkSnapshot>['products'][number],
    { readonly kind: 'structure' }
  >,
  target: TargetExportSpec,
): Promise<TargetOutput> => {
  if (!product.structure.audit.passed) {
    throw new BuildFailure(
      'quality.gate',
      `Structure "${target.name}" scored ${product.structure.audit.score}/100 (requires >= ${product.structure.audit.threshold}).`,
      3,
    );
  }
  if (target.format === 'java_structure') {
    return {
      targetName: target.name,
      files: [{ path: `${target.name}.nbt`, bytes: product.structure.nbt }],
    };
  }
  if (target.format !== 'glb') throw new BuildFailure('export.format', target.name);
  const bundle = await exportStructureGltfResolved(
    product.structure,
    target.name,
    LINEAGE_PLACEHOLDER_KEY,
    { encoding: target.encoding ?? 'portable' },
  );
  const files: Artifact[] = [];
  let lineageTemplate: Record<string, unknown> | undefined;
  for (const file of bundle.files) {
    if (file.kind === 'blob-copy') throw new BuildFailure('export.unresolved', file.path);
    if (file.path === 'ashfox-lineage.json' && file.kind === 'json') {
      lineageTemplate = file.data as Record<string, unknown>;
      continue;
    }
    files.push({
      path: file.path,
      bytes: file.kind === 'binary' ? file.data : encodeUtf8(json(file.data)),
    });
  }
  const metaPath = `${target.name}.structure.json`;
  if (!files.some((file) => file.path === metaPath)) {
    files.push({ path: metaPath, bytes: encodeUtf8(json(product.structure.playableMeta)) });
  }
  const perfKind =
    product.structure.grid.size[0] * product.structure.grid.size[2] > 900
      ? 'compound'
      : 'structure';
  return buildTargetOutput(target, perfKind, files, lineageTemplate);
};

const runBuildStructureTask = async (
  task: Extract<WorkerTaskInput, { readonly kind: 'build-structure' }>,
): Promise<WorkerTaskResult> => {
  const checked = checkSnapshot(makeSubSnapshot(task.configuration, task.files));
  const product = checked.products[0]!;
  if (product.kind !== 'structure') {
    throw new BuildFailure('workspace.compile', 'Expected structure', 3);
  }
  const targets: TargetOutput[] = [];
  for (const target of task.targets) {
    targets.push(await runBuildStructureTarget(product, target));
  }
  return {
    kind: 'build-entry',
    productKind: 'structure',
    metadata: structureMetadata(product),
    audit: product.structure.audit,
    targets,
  };
};

const modelAdapterForTarget = (target: TargetExportSpec): ExportAdapterInput => {
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

const runBuildModelTarget = async (
  openedProject: Extract<ReturnType<typeof openAssetProject>, { readonly ok: true }>['project'],
  target: TargetExportSpec,
  perfKind: 'creature' | 'prop',
): Promise<TargetOutput> => {
  if (target.format === 'png' || target.format === 'wav' || target.format === 'java_structure') {
    throw new BuildFailure('export.format', target.name);
  }
  const document = openedProject.document;
  const textures = new Map(Object.values(document.textures).map((t) => [t.source.key, t]));
  const gltfOptions =
    target.format === 'glb' || target.format === 'gltf'
      ? { encoding: target.encoding ?? 'portable' }
      : {};
  const bundle = await exportProductionProjectResolved(
    openedProject,
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
  const files: Artifact[] = [];
  let lineageTemplate: Record<string, unknown> | undefined;
  for (const file of bundle.files) {
    if (file.kind === 'blob-copy') throw new BuildFailure('export.unresolved', file.path);
    if (file.path === 'ashfox-lineage.json' && file.kind === 'json') {
      lineageTemplate = file.data as Record<string, unknown>;
      continue;
    }
    files.push({
      path: file.path,
      bytes: file.kind === 'binary' ? file.data : encodeUtf8(json(file.data)),
    });
  }
  return buildTargetOutput(target, perfKind, files, lineageTemplate);
};

const runBuildModelTask = async (
  task: Extract<WorkerTaskInput, { readonly kind: 'build-model' }>,
): Promise<WorkerTaskResult> => {
  const checked = checkSnapshot(makeSubSnapshot(task.configuration, task.files));
  const product = checked.products[0]!;
  if (product.kind !== 'model') throw new BuildFailure('workspace.compile', 'Expected model', 3);
  const hasProfile = product.model.profile !== undefined;
  const audit = evaluateAssetQuality({ model: product.model, telemetry: product.telemetry });
  const firstTargetName = task.targets[0]?.name ?? product.entry.entryName;
  if (!hasProfile) {
    throw new BuildFailure(
      'quality.profile-required',
      formatDeliveryGateFailure(firstTargetName, false, audit),
      3,
    );
  }
  if (!audit.passed) {
    throw new BuildFailure(
      'quality.gate',
      formatDeliveryGateFailure(firstTargetName, true, audit),
      3,
    );
  }
  const opened = openAssetProject({
    workspace: product.workspace,
    entry: product.entry,
    identity: {
      id: 'cli',
      revision: LINEAGE_PLACEHOLDER_KEY,
      createdAt: '2000-01-01T00:00:00.000Z',
    },
  });
  if (!opened.ok) throw new BuildFailure('export.project', JSON.stringify(opened));
  const perfKind = product.model.profile === 'creature' ? 'creature' : 'prop';
  const targets: TargetOutput[] = [];
  for (const target of task.targets) {
    targets.push(await runBuildModelTarget(opened.project, target, perfKind));
  }
  return {
    kind: 'build-entry',
    productKind: 'model',
    metadata: {
      clips: Object.values(product.model.animations).map((clip) => ({
        name: clip.name,
        durationSeconds: clip.durationSeconds,
      })),
    },
    pkgInterfaces: product.workspace.lock.packages.map((p) => ({
      name: p.name,
      interfaceHash: p.interfaceHash,
    })),
    targets,
  };
};

export const executeWorkerTask = async (task: WorkerTaskInput): Promise<WorkerTaskResult> => {
  if (task.kind === 'sound-variant') return runSoundVariantTask(task);
  if (task.kind === 'sound-audit') return runSoundAuditTask(task);
  if (task.kind === 'check-entry') return runCheckEntryTask(task);
  if (task.kind === 'build-sprite') return runBuildSpriteTask(task);
  if (task.kind === 'build-structure') return runBuildStructureTask(task);
  return runBuildModelTask(task);
};

export const startPoolWorker = (): void => {
  if (!parentPort) return;
  parentPort.on('message', (msg: { id: number; payload: WorkerTaskInput }) => {
    void executeWorkerTask(msg.payload).then(
      (value) => parentPort!.postMessage({ id: msg.id, ok: true, value }),
      (error: unknown) =>
        parentPort!.postMessage({
          id: msg.id,
          ok: false,
          message: error instanceof Error ? error.message : String(error),
          code: error instanceof BuildFailure ? error.code : 'build.failure',
          exitCode: error instanceof BuildFailure ? error.exitCode : 3,
        }),
    );
  });
};

export const poolWorkerModulePath = (): string => __filename;

if (
  !isMainThread &&
  workerData &&
  typeof workerData === 'object' &&
  'ashfoxPoolWorker' in workerData &&
  (workerData as { ashfoxPoolWorker?: unknown }).ashfoxPoolWorker === true &&
  (__filename.endsWith('.ts') ||
    (workerData as { ashfoxPoolEval?: unknown }).ashfoxPoolEval === true)
) {
  startPoolWorker();
}
