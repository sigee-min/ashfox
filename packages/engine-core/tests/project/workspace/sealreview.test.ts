import assert from 'node:assert/strict';
import { computeWorkspaceHash, type AuthoredAssetWorkspace } from '../../../src/project/workspace';
import { stageWorkspaceChangeSet } from '../../../src/project/workspace/change';
import { assetSource, packagesFixture } from './fixtures';

const fixture = packagesFixture([
  { name: 'local', root: 'local', entries: [{ name: 'main', path: 'main.ashfox' }], modules: [],
    dependencies: ['vendor'], files: [{ path: 'local/main.ashfox', source: assetSource('main') }] },
  { name: 'vendor', root: 'vendor', entries: [{ name: 'main', path: 'main.ashfox' }], modules: [],
    files: [{ path: 'vendor/main.ashfox', source: assetSource('vendor') }] }
]);
const base: AuthoredAssetWorkspace = { ...fixture,
  manifest: { ...fixture.manifest, packages: fixture.manifest.packages.filter((pkg) => pkg.name === 'local') },
  lock: { ...fixture.lock, packages: fixture.lock.packages.map((pkg) => pkg.name === 'vendor'
    ? { ...pkg, source: 'cas', digest: pkg.contentHash } : pkg) }
};
const before = JSON.stringify(base);
const result = stageWorkspaceChangeSet(base, {
  expectedWorkspaceHash: computeWorkspaceHash(base), deletes: [],
  writes: [{ path: 'vendor/main.ashfox', source: assetSource('vendor') + '\n' }]
});
assert.equal(result.ok, false);
if (!result.ok) {
  const immutable = result.diagnostics.find((item) => item.code === 'workspace.cas.immutable');
  assert.ok(immutable, JSON.stringify(result.diagnostics));
  assert.equal(immutable.source?.path, 'vendor/main.ashfox', 'CAS rejection must expose its source owner');
  assert.equal(immutable.source?.packageName, 'vendor');
}
assert.equal(JSON.stringify(base), before, 'failed sealing must leave base bytes and pins unchanged');
