import { runOnboarding, isOnboardingCommand, formatCliResult } from './onboarding/cli';
import { inspectCheckArgs, runAssetCheck, runMediaCommand } from './observe/cli';
import { runDevCommand } from './dev/cli';
import { prepare } from './observe/prepare';
import { isMainThread, parentPort, workerData } from 'node:worker_threads';
import { runWorker } from './worker';
import * as fs from 'node:fs';
import * as crypto from 'node:crypto';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  readSnapshot,
  checkNodeSnapshot,
  compileNodeBundle,
  verifyCurrent,
  BuildFailure,
  publishBundle,
  withOutputLocks,
  startPoolWorker,
  type Snapshot,
  type CompiledBundle,
} from '@ashfox/asset-build';
import {
  SpriteInputError,
  StructureInputError,
  VfxInputError,
  type HookBindingTarget,
} from '@ashfox/engine-core';

process.stdout.on('error', (error) => {
  if ('code' in error && error.code === 'EPIPE') {
    controller.abort();
    process.exitCode = 130;
  }
});
const controller = new AbortController();
const cancel = (): void => controller.abort();
if (isMainThread) {
  process.on('SIGINT', cancel);
  process.on('SIGTERM', cancel);
}
const args = process.argv.slice(2),
  command = args[0] ?? 'help';
const result = (ok: boolean, value: unknown, diagnostics: readonly unknown[] = []): void => {
  process.stdout.write(formatCliResult(command, ok, value, diagnostics));
};

const hasAncestorWorkspace = (file: string): boolean => {
  let directory = path.dirname(fs.realpathSync(file));
  while (true) {
    if (
      fs.existsSync(path.join(directory, '.ashfoxworkspace')) ||
      fs.existsSync(path.join(directory, '.ashfoxworkspace.mjs'))
    )
      return true;
    if (fs.existsSync(path.join(directory, '.git')) || path.dirname(directory) === directory)
      return false;
    directory = path.dirname(directory);
  }
};

const runCheck = async (): Promise<void> => {
  const checkArgs = inspectCheckArgs(args);
  const { target, singleAsset, nonJsonFlags } = checkArgs;
  if (target?.endsWith('.png')) {
    throw new BuildFailure(
      'observe.input',
      'PNG inputs are not supported; pass .ashfox or workspace',
      2,
    );
  }
  if (!singleAsset && target && fs.existsSync(target) && fs.statSync(target).isDirectory()) {
    if (nonJsonFlags.length > 0 || checkArgs.noCache)
      throw new BuildFailure('cli.arguments', 'Directory verification accepts only --json', 2);
    result(true, verifyCurrent(target));
    return;
  }
  if (singleAsset || !target) {
    result(
      true,
      await runAssetCheck(
        args.filter((a) => a !== '--no-cache'),
        __filename,
        controller.signal,
      ),
    );
    return;
  }
  if (nonJsonFlags.length > 0 || !checkArgs.target) {
    throw new BuildFailure('cli.arguments', 'Unexpected argument', 2);
  }
  if (target.endsWith('.ashfox') && !hasAncestorWorkspace(target)) {
    result(
      true,
      await runAssetCheck(
        args.filter((a) => a !== '--no-cache'),
        __filename,
        controller.signal,
      ),
    );
    return;
  }
  const snapshot = readSnapshot(target);
  result(
    true,
    await checkNodeSnapshot(snapshot, controller.signal, { noCache: checkArgs.noCache }),
  );
};

const VALID_BINDING_TARGETS = new Set<string>(['ts', 'cs', 'gd']);

const parseBindingsFlag = (): readonly HookBindingTarget[] => {
  const out = new Set<HookBindingTarget>();
  for (let i = 1; i < args.length; i += 1) {
    if (args[i] !== '--bindings') continue;
    const raw = args[i + 1];
    if (!raw || raw.startsWith('--')) {
      throw new BuildFailure('cli.arguments', 'Missing target list after --bindings (ts|cs|gd)', 2);
    }
    for (const part of raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)) {
      if (!VALID_BINDING_TARGETS.has(part)) {
        throw new BuildFailure(
          'cli.arguments',
          `Unknown bindings target "${part}"; expected ts, cs, or gd`,
          2,
        );
      }
      out.add(part as HookBindingTarget);
    }
    i += 1;
  }
  return [...out];
};

const parseBuildArgs = (): {
  readonly input: string;
  readonly noCache: boolean;
  readonly bindings: readonly HookBindingTarget[];
} => {
  const jsonCount = args.filter((a) => a === '--json').length;
  const noCacheCount = args.filter((a) => a === '--no-cache').length;
  const bindings = parseBindingsFlag();
  const positional: string[] = [];
  for (let i = 1; i < args.length; i += 1) {
    const a = args[i]!;
    if (a === '--json' || a === '--no-cache') continue;
    if (a === '--bindings') {
      i += 1;
      continue;
    }
    if (a.startsWith('--')) {
      throw new BuildFailure(
        'cli.arguments',
        'Only --json, --no-cache, and --bindings ts|cs|gd are supported',
        2,
      );
    }
    positional.push(a);
  }
  if (jsonCount > 1 || noCacheCount > 1 || command !== 'build' || positional.length !== 1) {
    throw new BuildFailure(
      'cli.arguments',
      'Unknown or invalid command. Expected init, doctor, check, render, or build.',
      2,
    );
  }
  return { input: positional[0]!, noCache: noCacheCount === 1, bindings };
};

const main = async (): Promise<void> => {
  if (runOnboarding(args)) return;
  if (command === 'render') {
    await runMediaCommand(args, __filename, controller.signal);
    return;
  }
  if (command === 'dev') {
    await runDevCommand(args, controller.signal);
    return;
  }
  if (command === 'check') {
    await runCheck();
    return;
  }
  const { input, noCache, bindings } = parseBuildArgs();
  const snapshot = readSnapshot(input);
  const toolchain = JSON.stringify({
    code: crypto.createHash('sha256').update(fs.readFileSync(__filename)).digest('hex'),
    node: process.version,
    v8: process.versions.v8,
    platform: os.platform(),
    arch: os.arch(),
  });
  const published = await withOutputLocks(snapshot, async () => {
    const bundle = await runWorker(
      __filename,
      snapshot,
      toolchain,
      'build',
      controller.signal,
      noCache,
      bindings,
    );
    if (!('bundleHash' in bundle)) throw new BuildFailure('build.worker', 'Missing bundle', 3);
    if (controller.signal.aborted)
      throw new BuildFailure('build.cancelled', 'Build cancelled', 130);
    return publishBundle(snapshot, bundle);
  });
  result(true, published);
};
interface DiagnosticLike {
  readonly severity?: string;
  readonly code: string;
  readonly message: string;
  readonly file?: string;
  readonly hint?: string;
}

const failureDiagnostics = (failure: BuildFailure): readonly DiagnosticLike[] =>
  failure.diagnostics && failure.diagnostics.length > 0
    ? failure.diagnostics
    : [
        {
          severity: 'error',
          code: failure.code,
          message: failure.message,
          ...(failure.hint !== undefined ? { hint: failure.hint } : {}),
        },
      ];

const formatDiagnosticLine = (d: DiagnosticLike): string => {
  const loc = d.file && !d.message.startsWith(d.file) ? `${d.file}: ` : '';
  const hint = d.hint ? `\n  ${d.hint}` : '';
  return `ashfox [${d.code}]: ${loc}${d.message}${hint}\n`;
};

const postWorkerFailure = (error: unknown, defaultCode: string, defaultExit: number): void => {
  const failure = error instanceof BuildFailure ? error : null;
  parentPort!.postMessage({
    ok: false,
    message: error instanceof Error ? error.message : String(error),
    code: failure ? failure.code : defaultCode,
    exitCode: failure ? failure.exitCode : defaultExit,
    ...(failure?.diagnostics ? { diagnostics: failure.diagnostics } : {}),
    ...(failure?.hint !== undefined ? { hint: failure.hint } : {}),
  });
};

const runObserveWorker = (observe: Parameters<typeof prepare>[0]): void => {
  try {
    parentPort!.postMessage({ ok: true, value: prepare(observe) });
  } catch (error) {
    postWorkerFailure(error, 'observe.compile', 1);
  }
};

const runBuildWorker = async (input: {
  snapshot: Snapshot;
  toolchain: string;
  command: string;
  noCache?: boolean;
  bindings?: readonly HookBindingTarget[];
}): Promise<void> => {
  try {
    let value: CompiledBundle | { sourceHash: string; products: readonly unknown[] };
    if (input.command === 'check') {
      value = await checkNodeSnapshot(input.snapshot, controller.signal, {
        noCache: input.noCache,
      });
    } else {
      value = await compileNodeBundle(input.snapshot, input.toolchain, controller.signal, {
        noCache: input.noCache,
        bindings: input.bindings,
      });
    }
    parentPort!.postMessage({ ok: true, value });
  } catch (error) {
    postWorkerFailure(error, 'build.failure', 3);
  }
};

const isPoolWorker = (): boolean =>
  Boolean(
    workerData &&
    typeof workerData === 'object' &&
    'ashfoxPoolWorker' in workerData &&
    (workerData as { ashfoxPoolWorker?: unknown }).ashfoxPoolWorker === true,
  );

const executeWorker = async (): Promise<void> => {
  if (workerData.observe) {
    runObserveWorker(workerData.observe);
    return;
  }
  await runBuildWorker(
    workerData as { snapshot: Snapshot; toolchain: string; command: string; noCache?: boolean },
  );
};
const inputErrorFailure = (
  code: string,
  file: string,
  message: string,
  hint?: string,
): BuildFailure =>
  new BuildFailure(
    code,
    message,
    1,
    [{ severity: 'error', code, file, message, ...(hint ? { hint } : {}) }],
    hint,
  );

const toBuildFailure = (error: unknown): BuildFailure => {
  if (error instanceof BuildFailure) return error;
  if (error instanceof SpriteInputError) {
    const d = error.diagnostic;
    return inputErrorFailure(d.code, d.file, error.message, d.hint);
  }
  if (error instanceof StructureInputError) {
    const d = error.detail;
    return inputErrorFailure(d.code, d.file, error.message, d.hint);
  }
  if (error instanceof VfxInputError) {
    const d = error.diagnostic;
    return inputErrorFailure(d.code, d.file, error.message, d.hint);
  }
  const msg = error instanceof Error ? error.message : String(error);
  const hint =
    error instanceof Error && 'hint' in error && typeof error.hint === 'string'
      ? error.hint
      : undefined;
  return new BuildFailure('build.failure', msg, 3, undefined, hint);
};

const handleCliFailure = (error: unknown): void => {
  const failure = toBuildFailure(error);
  const diagnostics = failureDiagnostics(failure);
  const wantJson = args.includes('--json');
  process.exitCode = failure.exitCode;
  if (isOnboardingCommand(command) && !wantJson) {
    process.stderr.write(
      `ashfox: ${failure.message}${failure.hint ? `\n  ${failure.hint}` : ''}\n`,
    );
    return;
  }
  if (command === 'render') {
    const err = {
      code: failure.code,
      message: failure.message,
      ...(failure.hint ? { hint: failure.hint } : {}),
    };
    process.stderr.write(JSON.stringify({ ok: false, error: err }) + '\n');
    return;
  }
  if (!wantJson) diagnostics.forEach((d) => process.stderr.write(formatDiagnosticLine(d)));
  result(false, null, diagnostics);
};

if (!isMainThread) {
  if (isPoolWorker()) {
    startPoolWorker();
  } else {
    parentPort!.on('message', (message) => {
      if (message === 'cancel') controller.abort();
    });
    void executeWorker();
  }
} else
  void main()
    .catch(handleCliFailure)
    .finally(() => {
      process.off('SIGINT', cancel);
      process.off('SIGTERM', cancel);
    });
