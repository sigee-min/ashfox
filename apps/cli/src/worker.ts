import { runJob, type Snapshot, type CompiledBundle } from '@ashfox/asset-build';
interface CheckResult { readonly sourceHash: string; readonly products: readonly unknown[] }
export const runWorker = (file: string, snapshot: Snapshot, toolchain: string, command: 'build' | 'check', signal?: AbortSignal):
  Promise<CompiledBundle | CheckResult> => runJob(file, { snapshot, toolchain, command }, signal);
