import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

// One adapter for the project's pinned CLI; no download during a game build.
const root = path.dirname(fileURLToPath(import.meta.url));
export function buildAssets(cli = path.join(root, 'node_modules/@ashfox/cli/dist/ashfox.cjs')) {
  const run = (...args) => {
    const child = spawnSync(process.execPath, [cli, ...args, '--json'], {
      cwd: root, encoding: 'utf8', timeout: 180000, maxBuffer: 16 * 1024 * 1024,
      killSignal: 'SIGKILL',
    });
    if (child.error || child.status !== 0) throw new Error(child.error?.message ?? child.stderr + child.stdout);
    const report = JSON.parse(child.stdout);
    if (!report.ok) throw new Error(JSON.stringify(report.diagnostics));
    return report.result;
  };
  const built = run('build', '.ashfoxworkspace.mjs');
  const verified = run('verify', path.dirname(path.dirname(built.bundlePath)));
  if (verified.bundleHash !== built.bundleHash) throw new Error('Build changed before integration');
  const catalog = verified.catalog;
  return {
    bundleHash: built.bundleHash,
    bundlePath: built.bundlePath,
    // A typed engine adapter can consume the same catalog and generate language bindings.
    file(id, relative) {
      const asset = catalog.assets.find(item => item.id === id);
      const record = asset?.files.find(item => item.path === `assets/${id}/${relative}`);
      if (!record) throw new Error(`Unknown asset file: ${id}/${relative}`);
      return path.join(built.bundlePath, record.path);
    },
    catalog,
  };
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const built = buildAssets(process.argv[2]);
  // The game build consumes this response directly; there is no stale global alias.
  process.stdout.write(JSON.stringify({ bundleHash: built.bundleHash, bundlePath: built.bundlePath, catalog: built.catalog }) + '\n');
}
