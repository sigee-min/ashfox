import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { readWorkspaceFile } from '../../../src/projectFile/workspace/codec';
import { compileAssetWorkspaceEntry } from '../../../src/compiler/program/asset/compile';

// Approved showroom motion update: planted fox idle and three clips per creature. Hashes cover canonical
// geometry, all texture recipe/raster data, and all authored animation channels.
const baseline = {
  fox: 'sha256:65ee6094aa66891c04858cd9fa343dc0b8ae1877bf80b82a39a22274d8a913db',
  goblin: 'sha256:9989d5a1f5536c38b2e8e0ee27791c376d3231b291d67579c90aaec2b19c436a'
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
