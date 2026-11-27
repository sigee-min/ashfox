import * as fs from 'node:fs';
import * as path from 'node:path';
import { BuildFailure, checkNodeSnapshot, readSnapshot, verifyCurrent } from '@ashfox/asset-build';
import { writeCliResult } from '../diagnostics';
import { inspectCheckArgs, runAssetCheck } from '../observe/cli';

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

const isDirectoryTarget = (target: string | undefined, singleAsset: boolean): boolean =>
  !singleAsset && Boolean(target && fs.existsSync(target) && fs.statSync(target).isDirectory());

/** Executes `ashfox check` across directory verification, single-asset, and workspace modes. */
export const runCheckCommand = async (
  args: readonly string[],
  executable: string,
  signal: AbortSignal,
): Promise<void> => {
  const checkArgs = inspectCheckArgs(args);
  const { target, singleAsset, nonJsonFlags } = checkArgs;
  if (target?.endsWith('.png')) {
    throw new BuildFailure(
      'observe.input',
      'PNG inputs are not supported; pass .ashfox or workspace',
      2,
    );
  }
  if (isDirectoryTarget(target, singleAsset)) {
    if (nonJsonFlags.length > 0 || checkArgs.noCache) {
      throw new BuildFailure('cli.arguments', 'Directory verification accepts only --json', 2);
    }
    writeCliResult('check', true, verifyCurrent(target!));
    return;
  }
  if (singleAsset || !target) {
    const filtered = args.filter((a) => a !== '--no-cache');
    writeCliResult('check', true, await runAssetCheck(filtered, executable, signal));
    return;
  }
  if (nonJsonFlags.length > 0) {
    throw new BuildFailure('cli.arguments', 'Unexpected argument', 2);
  }
  if (target.endsWith('.ashfox') && !hasAncestorWorkspace(target)) {
    const filtered = args.filter((a) => a !== '--no-cache');
    writeCliResult('check', true, await runAssetCheck(filtered, executable, signal));
    return;
  }
  const snapshot = readSnapshot(target);
  writeCliResult(
    'check',
    true,
    await checkNodeSnapshot(snapshot, signal, { noCache: checkArgs.noCache }),
  );
};
