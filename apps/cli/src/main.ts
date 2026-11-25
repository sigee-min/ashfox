import { runOnboarding, isOnboardingCommand, formatCliResult } from './onboarding/cli';
import { inspectCheckArgs, runAssetCheck, runMediaCommand } from './observe/cli';
import { prepare } from './observe/prepare';
import { isMainThread, parentPort, workerData } from 'node:worker_threads';
import { runWorker } from './worker';
import * as fs from 'node:fs';
import * as crypto from 'node:crypto';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  readSnapshot,
  checkSnapshot,
  compileNodeBundle,
  verifyCurrent,
  BuildFailure,
  publishBundle,
  withOutputLocks,
  type Snapshot,
  type CompiledBundle,
} from '@ashfox/asset-build';

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
  if (!singleAsset && target && fs.existsSync(target) && fs.statSync(target).isDirectory()) {
    if (nonJsonFlags.length > 0)
      throw new BuildFailure('cli.arguments', 'Directory verification accepts only --json', 2);
    result(true, verifyCurrent(target));
    return;
  }
  if (singleAsset || !target || target.endsWith('.png')) {
    result(true, await runAssetCheck(args, __filename, controller.signal));
    return;
  }
  if (nonJsonFlags.length > 0 || !checkArgs.target) {
    throw new BuildFailure('cli.arguments', 'Unexpected argument', 2);
  }
  if (target.endsWith('.ashfox') && !hasAncestorWorkspace(target)) {
    result(true, await runAssetCheck(args, __filename, controller.signal));
    return;
  }
  const snapshot = readSnapshot(target);
  result(true, await runWorker(__filename, snapshot, '', 'check', controller.signal));
};

const main = async (): Promise<void> => {
  if (runOnboarding(args)) return;
  if (['render', 'export'].includes(command)) {
    await runMediaCommand(args, __filename, controller.signal);
    return;
  }
  if (command === 'check') {
    await runCheck();
    return;
  }
  if (
    args.filter((a) => a === '--json').length > 1 ||
    args.some((a) => a.startsWith('--') && a !== '--json')
  ) {
    throw new BuildFailure(
      'cli.arguments',
      'Only --json is supported; shared configuration belongs to .ashfoxworkspace or .ashfoxworkspace.mjs',
      2,
    );
  }
  const positional = args.slice(1).filter((a) => a !== '--json');
  if (command !== 'build' || positional.length !== 1) {
    throw new BuildFailure(
      'cli.arguments',
      'Unknown or invalid command. Expected init, doctor, check, render, build, or export.',
      2,
    );
  }
  const snapshot = readSnapshot(positional[0]);
  const toolchain = JSON.stringify({
    code: crypto.createHash('sha256').update(fs.readFileSync(__filename)).digest('hex'),
    node: process.version,
    v8: process.versions.v8,
    platform: os.platform(),
    arch: os.arch(),
  });
  const published = await withOutputLocks(snapshot, async () => {
    const bundle = await runWorker(__filename, snapshot, toolchain, 'build', controller.signal);
    if (!('bundleHash' in bundle)) throw new BuildFailure('build.worker', 'Missing bundle', 3);
    if (controller.signal.aborted)
      throw new BuildFailure('build.cancelled', 'Build cancelled', 130);
    return publishBundle(snapshot, bundle);
  });
  result(true, published);
};
const runObserveWorker = (observe: Parameters<typeof prepare>[0]): void => {
  try {
    parentPort!.postMessage({ ok: true, value: prepare(observe) });
  } catch (error) {
    parentPort!.postMessage({
      ok: false,
      message: error instanceof Error ? error.message : String(error),
      code: error instanceof BuildFailure ? error.code : 'observe.compile',
      exitCode: error instanceof BuildFailure ? error.exitCode : 1,
    });
  }
};

const runBuildWorker = async (input: {
  snapshot: Snapshot;
  toolchain: string;
  command: string;
}): Promise<void> => {
  try {
    let value: CompiledBundle | { sourceHash: string; products: readonly unknown[] };
    if (input.command === 'check') {
      const checked = checkSnapshot(input.snapshot);
      value = {
        sourceHash: checked.sourceHash,
        products: checked.products.map((p) => ({ kind: p.kind, entry: p.entry })),
      };
    } else {
      value = await compileNodeBundle(input.snapshot, input.toolchain, controller.signal);
    }
    parentPort!.postMessage({ ok: true, value });
  } catch (error) {
    parentPort!.postMessage({
      ok: false,
      message: error instanceof Error ? error.message : String(error),
      code: error instanceof BuildFailure ? error.code : 'build.failure',
      exitCode: error instanceof BuildFailure ? error.exitCode : 3,
    });
  }
};

const executeWorker = async (): Promise<void> => {
  if (workerData.observe) {
    runObserveWorker(workerData.observe);
    return;
  }
  await runBuildWorker(workerData as { snapshot: Snapshot; toolchain: string; command: string });
};
if (!isMainThread) {
  parentPort!.on('message', (message) => {
    if (message === 'cancel') controller.abort();
  });
  void executeWorker();
} else
  void main()
    .catch((error: unknown) => {
      const failure =
        error instanceof BuildFailure
          ? error
          : new BuildFailure(
              'build.failure',
              error instanceof Error ? error.message : String(error),
              3,
            );
      if (isOnboardingCommand(command) && !args.includes('--json'))
        process.stderr.write(`ashfox: ${failure.message}\n`);
      else if (['render', 'export'].includes(command))
        process.stderr.write(
          JSON.stringify({ ok: false, error: { code: failure.code, message: failure.message } }) +
            '\n',
        );
      else
        result(false, null, [{ severity: 'error', code: failure.code, message: failure.message }]);
      process.exitCode = failure.exitCode;
    })
    .finally(() => {
      process.off('SIGINT', cancel);
      process.off('SIGTERM', cancel);
    });
