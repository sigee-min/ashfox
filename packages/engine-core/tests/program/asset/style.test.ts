import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { readWorkspaceFile } from '../../../src/projectFile/workspace/codec';
import { compileAssetWorkspaceEntry } from '../../../src/compiler/program/asset/compile';

// Captured before the precision hard cut at 6d72df1. Hashes cover canonical
// geometry, all texture recipe/raster data, and all authored animation channels.
const baseline = {
  fox: 'sha256:06a5581bda152e91c6a3dc79b0283ecebc6c945fc36736853f0e6426c5405c99',
  goblin: 'sha256:30a7d1db235de53718c9f7a1c2cfb3ee8dbe0d2d69666da3ece3a27691c31a6d'
};
const source = readFileSync(resolve(__dirname, '../../../../../examples/shared-creatures.ashfoxworkspace'), 'utf8');
const read = readWorkspaceFile(source);
assert.equal(read.ok, true);
if (!read.ok) throw new Error('Showcase workspace failed to open.');
for (const [entryName, hash] of Object.entries(baseline)) {
  const result = compileAssetWorkspaceEntry(read.workspace, { packageName: 'creatures', entryName });
  assert.equal(result.ok, true, result.ok ? '' : result.diagnostics.map((item) => item.message).join('\n'));
  if (result.ok) assert.equal(result.build.productHash, hash, entryName + ' changed its established visual product');
}
const stale = { ...read.workspace, lock: { ...read.workspace.lock,
  compilerFingerprint: 'ashfox-asset-compiler:workspace+typed-hir+instantiation+canonical:v1' } };
const rejected = compileAssetWorkspaceEntry(stale, { packageName: 'creatures', entryName: 'fox' });
assert.equal(rejected.ok, false, 'The previous compiler lock must not be accepted by a compatibility path');
