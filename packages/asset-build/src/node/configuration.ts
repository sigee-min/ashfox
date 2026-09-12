import { spawnSync } from 'node:child_process';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { BuildFailure } from '../contract';

/** Explicit executable configuration is trusted project code, like a build script. */
export const evaluateConfiguration = (file: string): string => {
  const script = `
    const configuration = (await import(process.argv[1])).default;
    if (!configuration || typeof configuration !== 'object' || Array.isArray(configuration))
      throw new Error('Export a default workspace object');
    process.stdout.write(JSON.stringify(configuration, (key, value) => {
      if (['function', 'undefined', 'symbol', 'bigint'].includes(typeof value) ||
          (typeof value === 'number' && !Number.isFinite(value)))
        throw new Error('Configuration must contain only JSON data: ' + key);
      return value;
    }));
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script, pathToFileURL(file).href], {
    cwd: path.dirname(file), encoding: 'utf8', timeout: 10000, maxBuffer: 262144, killSignal: 'SIGKILL'
  });
  if (result.error || result.status !== 0) throw new BuildFailure('workspace.evaluate',
    result.error?.message ?? result.stderr.trim() ?? 'Configuration failed', 2);
  return result.stdout;
};
