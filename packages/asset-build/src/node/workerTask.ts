import { isMainThread, parentPort, workerData } from 'node:worker_threads';
import { compileSoundRecipe, type SoundProduct } from '@ashfox/audio-core';
import {
  readDirectoryWorkspace,
  type DirectoryFile,
  type GlbPerformanceMetrics,
  type StructureAuditReport,
  type WorkspaceEntrySelector,
} from '@ashfox/engine-core';
import { checkSnapshot } from '../bundle/compile';
import { BuildFailure, type Artifact, type AssetMetadata, type Snapshot } from '../bundle/contract';
import type { DeliveryTarget } from '../bundle/delivery/contract';
import { openModelProject } from '../bundle/delivery/model';
import { PRODUCT_DELIVERY_REGISTRY, deliverProductTarget } from '../bundle/delivery/registry';
import { assertSoundGate } from '../bundle/delivery/sound';
import { runBuildVfxTask } from './workerVfx';

export interface TargetExportSpec extends DeliveryTarget {
  readonly directory: string;
}

export interface TargetOutput {
  readonly targetName: string;
  readonly files: readonly Artifact[];
  readonly lineageTemplate?: Record<string, unknown>;
  readonly performance?: GlbPerformanceMetrics;
}

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
    }
  | {
      readonly kind: 'build-vfx';
      readonly configuration: string;
      readonly files: readonly DirectoryFile[];
      readonly targets: readonly TargetExportSpec[];
    };

export type WorkerTaskResult =
  | { readonly kind: 'sound-variant'; readonly sound: SoundProduct }
  | { readonly kind: 'sound-audit' }
  | {
      readonly kind: 'check-entry';
      readonly productKind: 'model' | 'sprite' | 'sound' | 'structure' | 'vfx';
      readonly entry: WorkspaceEntrySelector;
      readonly audit?: StructureAuditReport;
      readonly pkgInterfaces?: readonly PackageInterfaceDigest[];
    }
  | {
      readonly kind: 'build-entry';
      readonly productKind: 'model' | 'sprite' | 'structure' | 'vfx';
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
  const products = compileSoundRecipe(
    { ...task.resolvedRecipe, variants: [variant] },
    task.entryPath,
  );
  return { kind: 'sound-variant', sound: products[0]! };
};

const runSoundAuditTask = (
  task: Extract<WorkerTaskInput, { readonly kind: 'sound-audit' }>,
): WorkerTaskResult => {
  assertSoundGate(task.targetName, task.sounds);
  return { kind: 'sound-audit' };
};

const runCheckEntryTask = (
  task: Extract<WorkerTaskInput, { readonly kind: 'check-entry' }>,
): WorkerTaskResult => {
  const product = checkSnapshot(makeSubSnapshot(task.configuration, task.files)).products[0]!;
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

const runBuildSpriteTask = async (
  task: Extract<WorkerTaskInput, { readonly kind: 'build-sprite' }>,
): Promise<WorkerTaskResult> => {
  const product = checkSnapshot(makeSubSnapshot(task.configuration, task.files)).products[0]!;
  if (product.kind !== 'sprite') throw new BuildFailure('workspace.compile', 'Expected sprite', 3);
  const targets: TargetOutput[] = [];
  for (const targetName of task.targetNames) {
    const delivered = await deliverProductTarget({ name: targetName, format: 'png' }, product, {
      buildKey: LINEAGE_PLACEHOLDER_KEY,
    });
    targets.push({ targetName, files: delivered.files });
  }
  return {
    kind: 'build-entry',
    productKind: 'sprite',
    metadata: PRODUCT_DELIVERY_REGISTRY.sprite.buildMetadata(product),
    targets,
  };
};

const runBuildStructureTask = async (
  task: Extract<WorkerTaskInput, { readonly kind: 'build-structure' }>,
): Promise<WorkerTaskResult> => {
  const product = checkSnapshot(makeSubSnapshot(task.configuration, task.files)).products[0]!;
  if (product.kind !== 'structure') {
    throw new BuildFailure('workspace.compile', 'Expected structure', 3);
  }
  const targets: TargetOutput[] = [];
  for (const target of task.targets) {
    const delivered = await deliverProductTarget(target, product, {
      buildKey: LINEAGE_PLACEHOLDER_KEY,
      extractLineage: true,
    });
    targets.push({
      targetName: target.name,
      files: delivered.files,
      ...(delivered.lineageTemplate ? { lineageTemplate: delivered.lineageTemplate } : {}),
      ...(delivered.performance ? { performance: delivered.performance } : {}),
    });
  }
  return {
    kind: 'build-entry',
    productKind: 'structure',
    metadata: PRODUCT_DELIVERY_REGISTRY.structure.buildMetadata(product),
    audit: product.structure.audit,
    targets,
  };
};

const runBuildModelTask = async (
  task: Extract<WorkerTaskInput, { readonly kind: 'build-model' }>,
): Promise<WorkerTaskResult> => {
  const product = checkSnapshot(makeSubSnapshot(task.configuration, task.files)).products[0]!;
  if (product.kind !== 'model') throw new BuildFailure('workspace.compile', 'Expected model', 3);
  const firstTargetName = task.targets[0]?.name ?? product.entry.entryName;
  PRODUCT_DELIVERY_REGISTRY.model.assertGate(firstTargetName, product);
  const opened = openModelProject(product, LINEAGE_PLACEHOLDER_KEY);
  const targets: TargetOutput[] = [];
  for (const target of task.targets) {
    const delivered = await deliverProductTarget(target, product, {
      buildKey: LINEAGE_PLACEHOLDER_KEY,
      extractLineage: true,
      resolveModelProject: () => opened,
    });
    targets.push({
      targetName: target.name,
      files: delivered.files,
      ...(delivered.lineageTemplate ? { lineageTemplate: delivered.lineageTemplate } : {}),
      ...(delivered.performance ? { performance: delivered.performance } : {}),
    });
  }
  return {
    kind: 'build-entry',
    productKind: 'model',
    metadata: PRODUCT_DELIVERY_REGISTRY.model.buildMetadata(product),
    pkgInterfaces: product.workspace.lock.packages.map((p) => ({
      name: p.name,
      interfaceHash: p.interfaceHash,
    })),
    targets,
  };
};

const TASK_HANDLERS: Record<
  WorkerTaskInput['kind'],
  (t: never) => Promise<WorkerTaskResult> | WorkerTaskResult
> = {
  'sound-variant': runSoundVariantTask,
  'sound-audit': runSoundAuditTask,
  'check-entry': runCheckEntryTask,
  'build-sprite': runBuildSpriteTask,
  'build-structure': runBuildStructureTask,
  'build-vfx': runBuildVfxTask,
  'build-model': runBuildModelTask,
};

export const executeWorkerTask = async (task: WorkerTaskInput): Promise<WorkerTaskResult> =>
  TASK_HANDLERS[task.kind](task as never);

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
