import assert from 'node:assert/strict';
import {
  applyWorkspaceChangeSet, compileAssetWorkspaceEntry, computeWorkspaceHash
} from '../../../src';
import {
  computePackageContentHash, computePackageInterfaceHash, computePackageManifestHash,
  computeSourceContentHash, readAuthoredAssetWorkspace, validateWorkspaceEntries,
  type AuthoredAssetWorkspace, type WorkspaceChangeSet, type WorkspaceManifest
} from '../../../src/project/workspace';
import { stageWorkspaceChangeSet } from '../../../src/project/workspace/change';
import { VALID_ASSET_SOURCE, validAssetWorkspace } from '../../program/asset/fixture';

const base = validAssetWorkspace();
const baseHash = computeWorkspaceHash(base);
const entry = { packageName: 'wolf', entryName: 'wolf' };
const edit = (workspace: AuthoredAssetWorkspace, source: string): WorkspaceChangeSet => ({
  expectedWorkspaceHash: computeWorkspaceHash(workspace),
  writes: [{ path: 'wolf/main.ashfox', source }], deletes: []
});
const source = VALID_ASSET_SOURCE.replace('seed = 23;', 'seed = 24;');
const changed = applyWorkspaceChangeSet(base, edit(base, source));
assert.ok(changed.ok, changed.ok ? '' : JSON.stringify(changed.diagnostics));
if (!changed.ok) throw new Error('Seed-only source edit must reseal its local lock.');
assert.equal(computeWorkspaceHash(base), baseHash, 'candidate sealing never mutates current authority');
const pkg = changed.workspace.manifest.packages[0]!;
const lock = changed.workspace.lock.packages[0]!;
assert.equal(lock.files[0]!.contentHash, computeSourceContentHash(source));
assert.equal(lock.contentHash, computePackageContentHash(pkg, changed.workspace.files));
assert.equal(lock.manifestHash, computePackageManifestHash(pkg));
assert.equal(lock.interfaceHash, computePackageInterfaceHash(pkg));
assert.deepEqual(validateWorkspaceEntries(changed.workspace), []);
assert.ok(readAuthoredAssetWorkspace(changed.workspace).ok);
assert.ok(Object.isFrozen(changed.workspace.lock.packages));
assert.deepEqual(applyWorkspaceChangeSet(base, edit(base, source)), changed,
  'sealing is deterministic');
const noOp = applyWorkspaceChangeSet(changed.workspace, {
  expectedWorkspaceHash: changed.workspaceHash, writes: [], deletes: []
});
assert.ok(noOp.ok);
if (noOp.ok) assert.equal(noOp.workspaceHash, changed.workspaceHash);

// Even a fully correct caller-authored lock is rejected by the hard-cut input.
for (const supplied of [base.lock, changed.workspace.lock, undefined]) {
  const retiredInput = { ...edit(base, source), lock: supplied };
  const rejected = stageWorkspaceChangeSet(base, retiredInput);
  assert.equal(rejected.ok, false);
  if (!rejected.ok) assert.equal(rejected.diagnostics[0]!.code, 'workspace.cas.changeset');
}
const stalePersisted = readAuthoredAssetWorkspace({ ...base,
  files: [{ path: 'wolf/main.ashfox', source }] });
assert.equal(stalePersisted.ok, false, 'persisted workspaces still require exact lock metadata');
if (!stalePersisted.ok) assert.ok(stalePersisted.diagnostics.some((item) => item.code === 'workspace.lock.stale_content'));

const partsSource = 'ashfox-model 1 module dims { export design D { seed: integer = 23; } }';
const dependentSource = VALID_ASSET_SOURCE
  .replace('asset wolf {', 'asset wolf { import "parts/dims" as dims;')
  .replace('seed = 23;', 'seed = dims.D.seed;');
const dependentManifest: WorkspaceManifest = { ...base.manifest, packages: [
  { ...base.manifest.packages[0]!, manifest: { ...base.manifest.packages[0]!.manifest,
    dependencies: [{ name: 'parts' }] } },
  { name: 'parts', root: 'parts', manifest: { ...base.manifest.packages[0]!.manifest,
    entries: [], modules: [{ subpath: './dims', path: 'dims.ashfox' }] } }
] };
const added = applyWorkspaceChangeSet(base, {
  expectedWorkspaceHash: baseHash, manifest: dependentManifest,
  writes: [{ path: 'wolf/main.ashfox', source: dependentSource },
    { path: 'parts/dims.ashfox', source: partsSource, expectedHash: null }], deletes: []
});
assert.ok(added.ok, added.ok ? '' : JSON.stringify(added.diagnostics));
if (!added.ok) throw new Error('Adding a local package and module must succeed.');
const partsBefore = added.workspace.lock.packages.find((item) => item.name === 'parts')!;
const alteredModule = partsSource.replace('23', '31');
const dependent = applyWorkspaceChangeSet(added.workspace, {
  expectedWorkspaceHash: added.workspaceHash,
  writes: [{ path: 'parts/dims.ashfox', source: alteredModule }], deletes: []
});
assert.ok(dependent.ok, dependent.ok ? '' : JSON.stringify(dependent.diagnostics));
if (!dependent.ok) throw new Error('ABI source edits must refresh local dependency pins.');
const partsAfter = dependent.workspace.lock.packages.find((item) => item.name === 'parts')!;
assert.notEqual(partsAfter.interfaceHash, partsBefore.interfaceHash);
assert.notEqual(partsAfter.contentHash, partsBefore.contentHash);
assert.deepEqual(dependent.workspace.lock.packages.find((item) => item.name === 'wolf')!.dependencies,
  [{ name: 'parts', contentHash: partsAfter.contentHash, interfaceHash: partsAfter.interfaceHash }]);
assert.deepEqual(validateWorkspaceEntries(dependent.workspace), []);
const compiled = compileAssetWorkspaceEntry(dependent.workspace, entry);
assert.ok(compiled.ok);
const expected = compileAssetWorkspaceEntry(validAssetWorkspace(VALID_ASSET_SOURCE.replace('seed = 23;', 'seed = 31;')), entry);
assert.ok(expected.ok);
if (compiled.ok && expected.ok) assert.equal(compiled.build.productHash, expected.build.productHash);
const removed = applyWorkspaceChangeSet(dependent.workspace, {
  expectedWorkspaceHash: dependent.workspaceHash, manifest: base.manifest,
  writes: [{ path: 'wolf/main.ashfox', source: VALID_ASSET_SOURCE }],
  deletes: [{ path: 'parts/dims.ashfox' }]
});
assert.ok(removed.ok, removed.ok ? '' : JSON.stringify(removed.diagnostics));
if (removed.ok) assert.equal(removed.workspaceHash, baseHash,
  'removing a local package removes its lock and dependency pins');

// Add and remove a declared module without adding a package.
const localSource = dependentSource.replace('parts/dims', './dims.ashfox');
const localManifest = { ...base.manifest, packages: [{ ...base.manifest.packages[0]!,
  manifest: { ...base.manifest.packages[0]!.manifest,
    modules: [{ subpath: './dims', path: 'dims.ashfox' }] } }] };
const localAdded = applyWorkspaceChangeSet(base, {
  expectedWorkspaceHash: baseHash, manifest: localManifest,
  writes: [{ path: 'wolf/main.ashfox', source: localSource },
    { path: 'wolf/dims.ashfox', source: partsSource }], deletes: []
});
assert.ok(localAdded.ok, localAdded.ok ? '' : JSON.stringify(localAdded.diagnostics));
if (localAdded.ok) {
  const localRemoved = applyWorkspaceChangeSet(localAdded.workspace, {
    expectedWorkspaceHash: localAdded.workspaceHash, manifest: base.manifest,
    writes: [{ path: 'wolf/main.ashfox', source: VALID_ASSET_SOURCE }],
    deletes: [{ path: 'wolf/dims.ashfox' }]
  });
  assert.ok(localRemoved.ok);
  if (localRemoved.ok) assert.equal(localRemoved.workspaceHash, baseHash);
}

for (const bad of ['ashfox-model 1 asset wolf {',
  VALID_ASSET_SOURCE.replace('asset wolf {', 'asset wolf { design D { check impossible = false; }')]) {
  const result = applyWorkspaceChangeSet(base, edit(base, bad));
  assert.equal(result.ok, false);
  assert.equal('workspace' in result, false);
  assert.equal(computeWorkspaceHash(base), baseHash);
}

// Structural source limits win before the malformed candidate can be parsed.
const bounded = stageWorkspaceChangeSet(base,
  edit(base, source + '\n' + 'invalid '.repeat(100)),
  { limits: { maxSourceCodeUnits: VALID_ASSET_SOURCE.length + 10 } });
assert.equal(bounded.ok, false);
if (!bounded.ok) {
  assert.ok(bounded.diagnostics.some((item) => item.code === 'workspace.budget.source_code_units'));
  assert.ok(bounded.diagnostics.every((item) => !item.code.startsWith('workspace.source.')));
}
const missing = stageWorkspaceChangeSet(base, {
  expectedWorkspaceHash: baseHash, writes: [{ path: 'orphan.ashfox', source: 'invalid' }], deletes: []
});
assert.equal(missing.ok, false);
if (!missing.ok) assert.ok(missing.diagnostics.every((item) => !item.code.startsWith('workspace.source.')));
const missingDependency = stageWorkspaceChangeSet(base, {
  ...edit(base, 'invalid'), manifest: { ...base.manifest, packages: [{ ...pkg,
    manifest: { ...pkg.manifest, dependencies: [{ name: 'missing' }] } }] }
});
assert.equal(missingDependency.ok, false);
if (!missingDependency.ok) {
  assert.equal(missingDependency.diagnostics[0]!.code, 'workspace.lock.dependency_missing');
  assert.equal(missingDependency.diagnostics[0]!.source?.path, 'ashfox.workspace.json');
  assert.equal(missingDependency.diagnostics[0]!.source?.packageName, 'wolf');
}

// Turn a sealed dependency into an embedded CAS package for immutable tests.
const embedded: AuthoredAssetWorkspace = { ...added.workspace,
  manifest: { ...added.workspace.manifest,
    packages: added.workspace.manifest.packages.filter((item) => item.name !== 'parts') },
  lock: { ...added.workspace.lock, packages: added.workspace.lock.packages.map((item) => item.name === 'parts'
    ? { ...item, source: 'cas', digest: item.contentHash } : item) }
};
assert.ok(readAuthoredAssetWorkspace(embedded).ok);
assert.deepEqual(validateWorkspaceEntries(embedded), []);
const embeddedHash = computeWorkspaceHash(embedded);
const immutableRecord = embedded.lock.packages.find((item) => item.name === 'parts');
const localEdit = applyWorkspaceChangeSet(embedded,
  edit(embedded, dependentSource.replace('origin = (-2u, 0u, -2u);', 'origin = (-1u, 0u, -2u);')));
assert.ok(localEdit.ok, localEdit.ok ? '' : JSON.stringify(localEdit.diagnostics));
if (localEdit.ok) {
  assert.deepEqual(localEdit.workspace.lock.packages.find((item) => item.name === 'parts'), immutableRecord);
  assert.equal(localEdit.workspace.files.find((item) => item.path === 'parts/dims.ashfox')!.source, partsSource);
}
for (const change of [
  { writes: [{ path: 'parts/dims.ashfox', source: alteredModule }], deletes: [] },
  { writes: [], deletes: [{ path: 'parts/dims.ashfox' }] },
  { writes: [{ path: 'moved/dims.ashfox', source: partsSource }], deletes: [{ path: 'parts/dims.ashfox' }] },
  { writes: [], deletes: [], manifest: dependentManifest },
  { writes: [], deletes: [], manifest: { ...embedded.manifest, packages: [
    ...embedded.manifest.packages,
    { name: 'takeover', root: 'parts/nested', manifest: { ...pkg.manifest, entries: [], modules: [] } }
  ] } }
]) {
  const rejected = applyWorkspaceChangeSet(embedded, { expectedWorkspaceHash: embeddedHash, ...change });
  assert.equal(rejected.ok, false, JSON.stringify(change));
  if (!rejected.ok) assert.ok(rejected.diagnostics.every((item) => item.source !== undefined));
  assert.equal('workspace' in rejected, false);
  assert.equal(computeWorkspaceHash(embedded), embeddedHash);
}
const tamper = stageWorkspaceChangeSet(embedded, { expectedWorkspaceHash: embeddedHash,
  writes: [{ path: 'parts/dims.ashfox', source: alteredModule }], deletes: [] });
assert.equal(tamper.ok, false);
if (!tamper.ok) {
  assert.equal(tamper.diagnostics[0]!.code, 'workspace.cas.immutable');
  assert.equal(tamper.diagnostics[0]!.source?.path, 'parts/dims.ashfox');
  assert.equal(tamper.diagnostics[0]!.source?.packageName, 'parts');
}

// A CAS package can pin a local dependency. Editing that dependency must not
// rewrite the immutable CAS pin or silently accept the now-stale package.
const withConfig = applyWorkspaceChangeSet(added.workspace, {
  expectedWorkspaceHash: added.workspaceHash,
  manifest: { ...added.workspace.manifest, packages: [
    ...added.workspace.manifest.packages.map((item) => item.name === 'parts'
      ? { ...item, manifest: { ...item.manifest, dependencies: [{ name: 'config' }] } } : item),
    { name: 'config', root: 'config', manifest: { ...pkg.manifest,
      entries: [], modules: [{ subpath: './dims', path: 'dims.ashfox' }] } }
  ] },
  writes: [
    { path: 'parts/dims.ashfox', source: 'ashfox-model 1 module dims { import "config/dims" as c; export design D { seed: integer = c.C.seed; } }' },
    { path: 'config/dims.ashfox', source: 'ashfox-model 1 module dims { export design C { seed: integer = 23; } }' }
  ], deletes: []
});
assert.ok(withConfig.ok, withConfig.ok ? '' : JSON.stringify(withConfig.diagnostics));
if (withConfig.ok) {
  const pinned: AuthoredAssetWorkspace = { ...withConfig.workspace,
    manifest: { ...withConfig.workspace.manifest,
      packages: withConfig.workspace.manifest.packages.filter((item) => item.name !== 'parts') },
    lock: { ...withConfig.workspace.lock, packages: withConfig.workspace.lock.packages.map((item) => item.name === 'parts'
      ? { ...item, source: 'cas', digest: item.contentHash } : item) }
  };
  assert.deepEqual(validateWorkspaceEntries(pinned), []);
  const stalePin = applyWorkspaceChangeSet(pinned, {
    expectedWorkspaceHash: computeWorkspaceHash(pinned), writes: [{ path: 'config/dims.ashfox',
      source: 'ashfox-model 1 module dims { export design C { seed: integer = 24; } }' }], deletes: []
  });
  assert.equal(stalePin.ok, false);
  if (!stalePin.ok) assert.ok(stalePin.diagnostics.some((item) => item.code === 'workspace.lock.dependency_stale'));
}
console.log('engine-owned local resealing, module ABI pins and immutable CAS packages ok');
