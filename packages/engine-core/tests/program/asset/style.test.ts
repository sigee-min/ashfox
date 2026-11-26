import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { readWorkspaceFile } from '../../../src/project/container/codec';
import { compileAssetWorkspaceEntry } from '../../../src/compiler/program/asset/compile';

// Approved Lv4 Hytale showroom rebuild: articulated anatomy, painterly surfaces, and three clips per creature.
// Hashes cover canonical geometry, all texture recipe/raster data, and all authored animation channels.
const baseline = {
  fox: 'sha256:6fbf67b12a4916549728382acef3e2ccf2004e676a26bfb6325d80199fc0e96e',
  goblin: 'sha256:7e3a89685f7e6ba5bcff80242da2dd8fd15a1e2a35e8e683fc9a3c8b95503fd5',
};
const source = readFileSync(
  resolve(__dirname, '../../../../../assets/workspaces/shared-creatures.ashfoxworkspace'),
  'utf8',
);
const read = readWorkspaceFile(source);
assert.equal(read.ok, true);
if (!read.ok) throw new Error('Showcase workspace failed to open.');
for (const [entryName, hash] of Object.entries(baseline)) {
  const result = compileAssetWorkspaceEntry(read.workspace, {
    packageName: 'creatures',
    entryName,
  });
  assert.equal(
    result.ok,
    true,
    result.ok ? '' : result.diagnostics.map((item) => item.message).join('\n'),
  );
  if (result.ok)
    assert.equal(
      result.build.productHash,
      hash,
      entryName + ' changed its established visual product',
    );
}
const stale = {
  ...read.workspace,
  lock: {
    ...read.workspace.lock,
    compilerFingerprint: 'ashfox-asset-compiler:workspace+typed-hir+instantiation+canonical:v1',
  },
};
const rejected = compileAssetWorkspaceEntry(stale, { packageName: 'creatures', entryName: 'fox' });
assert.equal(
  rejected.ok,
  false,
  'The previous compiler lock must not be accepted by a compatibility path',
);
