import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { BuildFailure, publishBundle, readSnapshot, withOutputLocks } from '@ashfox/asset-build';
import type { HookBindingTarget } from '@ashfox/engine-core';
import { writeCliResult } from '../diagnostics';
import { runWorker } from '../worker';

const VALID_BINDING_TARGETS = new Set<string>(['ts', 'cs', 'gd']);

const parseBindingsValue = (raw: string | undefined, out: Set<HookBindingTarget>): void => {
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
};

const parseBindingsFlag = (args: readonly string[]): readonly HookBindingTarget[] => {
  const out = new Set<HookBindingTarget>();
  for (let i = 1; i < args.length; i += 1) {
    if (args[i] !== '--bindings') continue;
    parseBindingsValue(args[i + 1], out);
    i += 1;
  }
  return [...out];
};

const parseBuildArgs = (
  args: readonly string[],
): {
  readonly input: string;
  readonly noCache: boolean;
  readonly bindings: readonly HookBindingTarget[];
} => {
  const jsonCount = args.filter((a) => a === '--json').length;
  const noCacheCount = args.filter((a) => a === '--no-cache').length;
  const bindings = parseBindingsFlag(args);
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
  if (jsonCount > 1 || noCacheCount > 1 || positional.length !== 1) {
    throw new BuildFailure(
      'cli.arguments',
      'Unknown or invalid command. Expected init, doctor, check, render, build, dev, library, or docs.',
      2,
    );
  }
  return { input: positional[0]!, noCache: noCacheCount === 1, bindings };
};

const buildToolchainFingerprint = (executable: string): string =>
  JSON.stringify({
    code: crypto.createHash('sha256').update(fs.readFileSync(executable)).digest('hex'),
    node: process.version,
    v8: process.versions.v8,
    platform: os.platform(),
    arch: os.arch(),
  });

/** Executes `ashfox build` inside a worker thread under output locks and publishes artifacts. */
export const runBuildCommand = async (
  args: readonly string[],
  executable: string,
  signal: AbortSignal,
): Promise<void> => {
  const { input, noCache, bindings } = parseBuildArgs(args);
  const snapshot = readSnapshot(input);
  const toolchain = buildToolchainFingerprint(executable);
  const published = await withOutputLocks(snapshot, async () => {
    const bundle = await runWorker(
      executable,
      snapshot,
      toolchain,
      'build',
      signal,
      noCache,
      bindings,
    );
    if (!('bundleHash' in bundle)) throw new BuildFailure('build.worker', 'Missing bundle', 3);
    if (signal.aborted) throw new BuildFailure('build.cancelled', 'Build cancelled', 130);
    return publishBundle(snapshot, bundle);
  });
  writeCliResult('build', true, published);
};
