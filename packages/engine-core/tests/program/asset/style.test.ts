import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { readWorkspaceFile } from '../../../src/project/container/codec';
import { compileAssetWorkspaceEntry } from '../../../src/compiler/program/asset/compile';

// Approved Lv4 Hytale showroom rebuild: articulated anatomy, painterly surfaces, and three clips per creature.
// Hashes cover canonical geometry, all texture recipe/raster data, and all authored animation channels.
const baseline = {
  fox: 'sha256:814c9a6f128a458557af33e367e62b1882194db5811e716e17c1e16d0207e0b2',
  goblin: 'sha256:d8f699dfd678d36c7290245e9d0c8cd34c0f10ffb222643085266dcade6aa7af',
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
