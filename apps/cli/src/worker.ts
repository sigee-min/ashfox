import { runJob, type Snapshot, type CompiledBundle } from '@ashfox/asset-build';
import type { HookBindingTarget, SdkTarget } from '@ashfox/engine-core';
interface CheckResult {
  readonly sourceHash: string;
  readonly products: readonly unknown[];
}
export const runWorker = (
  file: string,
  snapshot: Snapshot,
  toolchain: string,
  command: 'build' | 'check',
  signal?: AbortSignal,
  noCache = false,
  bindings?: readonly HookBindingTarget[],
  sdk?: readonly SdkTarget[],
): Promise<CompiledBundle | CheckResult> =>
  runJob(file, { snapshot, toolchain, command, noCache, bindings, sdk }, signal);
