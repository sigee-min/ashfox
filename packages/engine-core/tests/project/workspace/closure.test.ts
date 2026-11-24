import assert from 'node:assert/strict';

import { type AuthoredAssetWorkspace } from '../../../src/project/workspace';
import { resolveWorkspaceEntryCompilation } from '../../../src/project/workspace/graph';
import { assetSource, moduleSource, packagesFixture, workspaceFixture } from './fixtures';

const local = workspaceFixture(
  [
    {
      path: 'dragon/main.ashfox',
      source:
        'ashfox-model 1\nasset main { import "./util.ashfox" as first; import "./util.ashfox" as second; }',
    },
    { path: 'dragon/util.ashfox', source: moduleSource('util') },
    { path: 'dragon/unused.ashfox', source: moduleSource('unused') },
  ],
  {
    modules: [
      { subpath: './util', path: 'util.ashfox' },
      { subpath: './unused', path: 'unused.ashfox' },
    ],
  },
);
const localResult = resolveWorkspaceEntryCompilation(local, {
  packageName: 'dragon',
  entryName: 'main',
});
assert.equal(localResult.ok, true, localResult.ok ? '' : localResult.diagnostics[0]?.message);
if (!localResult.ok) throw new Error('local closure fixture did not resolve');
const localClosure = localResult.value.closure;
assert.equal(localClosure.root.identity.packageName, 'dragon');
assert.equal(localClosure.root.identity.path, 'dragon/main.ashfox');
assert.equal(localClosure.root.identity.unitName, 'main');
assert.equal(localClosure.root.unit.kind, 'asset');
assert.deepEqual(
  localClosure.files.map((file) => file.identity.path),
  ['dragon/util.ashfox', 'dragon/main.ashfox'],
);
assert.equal(
  localClosure.files.some((file) => file.identity.path.includes('unused')),
  false,
);
assert.equal(localClosure.files[0]?.unit.kind, 'module');
assert.equal(localClosure.files[0]?.identity.unitName, 'util');
assert.equal(localClosure.files[0]?.exportedNames.length, 0);
assert.equal(localClosure.imports.length, 2);
assert.notEqual(localClosure.imports[0]?.alias, localClosure.imports[1]?.alias);
assert.equal(
  localClosure.imports[0]?.target.key,
  localClosure.imports[1]?.target.key,
  'import aliases must not enter source or symbol identity',
);
assert.equal(
  localClosure.imports[0]?.key.startsWith(`${localClosure.imports[0]?.importer.key}\u0000`),
  true,
);
assert.equal(Object.isFrozen(localClosure), true);
assert.equal(Object.isFrozen(localClosure.files), true);
assert.equal(Object.isFrozen(localClosure.imports), true);

const localWithUnrelatedChange = workspaceFixture(
  [
    {
      path: 'dragon/main.ashfox',
      source:
        'ashfox-model 1\nasset main { import "./util.ashfox" as first; import "./util.ashfox" as second; }',
    },
    { path: 'dragon/util.ashfox', source: moduleSource('util') },
    { path: 'dragon/unused.ashfox', source: `${moduleSource('unused')}\n// unrelated byte` },
  ],
  {
    modules: [
      { subpath: './util', path: 'util.ashfox' },
      { subpath: './unused', path: 'unused.ashfox' },
    ],
  },
);
const unrelatedResult = resolveWorkspaceEntryCompilation(localWithUnrelatedChange, {
  packageName: 'dragon',
  entryName: 'main',
});
assert.equal(unrelatedResult.ok, true);
if (unrelatedResult.ok) {
  assert.deepEqual(
    unrelatedResult.value.closure.files.map((file) => file.identity.key),
    localClosure.files.map((file) => file.identity.key),
    'unrelated workspace source must not alter reachable source identities',
  );
  assert.equal(unrelatedResult.value.closure.build.closureHash, localClosure.build.closureHash);
}

const localWithUnrelatedManifest = workspaceFixture(
  [
    {
      path: 'dragon/main.ashfox',
      source:
        'ashfox-model 1\nasset main { import "./util.ashfox" as first; import "./util.ashfox" as second; }',
    },
    { path: 'dragon/util.ashfox', source: moduleSource('util') },
    { path: 'dragon/unused.ashfox', source: moduleSource('unused') },
    { path: 'dragon/new.ashfox', source: moduleSource('new') },
  ],
  {
    modules: [
      { subpath: './util', path: 'util.ashfox' },
      { subpath: './unused', path: 'unused.ashfox' },
      { subpath: './new', path: 'new.ashfox' },
    ],
  },
);
const unrelatedManifestResult = resolveWorkspaceEntryCompilation(localWithUnrelatedManifest, {
  packageName: 'dragon',
  entryName: 'main',
});
assert.equal(unrelatedManifestResult.ok, true);
if (unrelatedManifestResult.ok) {
  assert.deepEqual(
    unrelatedManifestResult.value.closure.files.map((file) => file.identity.key),
    localClosure.files.map((file) => file.identity.key),
    'unrelated manifest declarations must not alter reachable source identities',
  );
  assert.equal(
    unrelatedManifestResult.value.closure.build.closureHash,
    localClosure.build.closureHash,
  );
}

const packageWorkspace = packagesFixture([
  {
    name: 'app',
    root: 'app',
    entries: [{ name: 'main', path: 'main.ashfox' }],
    modules: [],
    dependencies: ['lib', 'other'],
    files: [
      { path: 'app/main.ashfox', source: assetSource('main', ['lib/common', 'other/common']) },
    ],
  },
  {
    name: 'lib',
    root: 'lib',
    entries: [],
    modules: [{ subpath: './common', path: 'common.ashfox' }],
    files: [{ path: 'lib/common.ashfox', source: moduleSource('common') }],
  },
  {
    name: 'other',
    root: 'other',
    entries: [],
    modules: [{ subpath: './common', path: 'common.ashfox' }],
    files: [{ path: 'other/common.ashfox', source: moduleSource('common') }],
  },
]);
const packageResult = resolveWorkspaceEntryCompilation(packageWorkspace, {
  packageName: 'app',
  entryName: 'main',
});
assert.equal(packageResult.ok, true, packageResult.ok ? '' : packageResult.diagnostics[0]?.message);
if (!packageResult.ok) throw new Error('package closure fixture did not resolve');
const packageClosure = packageResult.value.closure;
const libFile = packageClosure.files.find((file) => file.identity.packageName === 'lib');
assert.ok(libFile);
if (libFile === undefined) throw new Error('package module was not included');
const libLock = packageWorkspace.lock.packages.find((pkg) => pkg.name === 'lib');
assert.ok(libLock);
if (libLock === undefined) throw new Error('package lock is missing');
assert.equal(libFile.identity.packageInstanceKey.length > 0, true);
assert.equal(
  packageClosure.files.some((file) => file.identity.packageName === 'other'),
  true,
);
const otherFile = packageClosure.files.find((file) => file.identity.packageName === 'other');
assert.ok(otherFile);
if (otherFile === undefined) throw new Error('second package module was not included');
assert.equal(libFile.identity.path.endsWith('common.ashfox'), true);
assert.equal(otherFile.identity.path.endsWith('common.ashfox'), true);
assert.notEqual(
  libFile.identity.key,
  otherFile.identity.key,
  'package-qualified source identity must not collapse same relative paths',
);
assert.notEqual(libFile.identity.packageInstanceKey, otherFile.identity.packageInstanceKey);
assert.equal(packageClosure.imports.length, 2);
assert.deepEqual(packageClosure.imports.map((edge) => edge.target.packageName).sort(), [
  'lib',
  'other',
]);

const selectedRoot = workspaceFixture(
  [
    { path: 'dragon/main.ashfox', source: assetSource('main') },
    { path: 'dragon/other.ashfox', source: assetSource('other') },
  ],
  {
    entries: [
      { name: 'main', path: 'main.ashfox' },
      { name: 'other', path: 'other.ashfox' },
    ],
  },
);
const otherResult = resolveWorkspaceEntryCompilation(selectedRoot, {
  packageName: 'dragon',
  entryName: 'other',
});
assert.equal(otherResult.ok, true);
if (otherResult.ok) {
  assert.equal(otherResult.value.closure.root.identity.path, 'dragon/other.ashfox');
}

const mismatch = workspaceFixture([
  {
    path: 'dragon/main.ashfox',
    source: assetSource('not_main'),
  },
]);
assert.equal(
  resolveWorkspaceEntryCompilation(mismatch, {
    packageName: 'dragon',
    entryName: 'main',
  }).ok,
  false,
  'manifest selector must bind the exact root asset name',
);

const bounded = resolveWorkspaceEntryCompilation(
  local,
  {
    packageName: 'dragon',
    entryName: 'main',
  },
  { limits: { maxImportEdges: 1 } },
);
assert.equal(bounded.ok, false);
if (!bounded.ok) assert.equal(bounded.diagnostics[0]?.code, 'workspace.budget.import_edges');

const duplicateAlias = workspaceFixture(
  [
    {
      path: 'dragon/main.ashfox',
      source:
        'ashfox-model 1\nasset main { import "./util.ashfox" as same; import "./util.ashfox" as same; }',
    },
    { path: 'dragon/util.ashfox', source: moduleSource('util') },
  ],
  { modules: [{ subpath: './util', path: 'util.ashfox' }] },
);
const duplicateAliasResult = resolveWorkspaceEntryCompilation(duplicateAlias, {
  packageName: 'dragon',
  entryName: 'main',
});
assert.equal(duplicateAliasResult.ok, false);
if (!duplicateAliasResult.ok) {
  assert.equal(duplicateAliasResult.diagnostics[0]?.code, 'workspace.import.duplicate_alias');
  assert.equal(duplicateAliasResult.diagnostics[0]?.source?.start.offset, 67);
}

const malformedBase = structuredClone(local) as AuthoredAssetWorkspace;
const malformed: AuthoredAssetWorkspace = {
  ...malformedBase,
  lock: {
    ...malformedBase.lock,
    packages: malformedBase.lock.packages.map((pkg) => ({
      ...pkg,
      contentHash: `sha256:${'0'.repeat(64)}` as typeof pkg.contentHash,
    })),
  },
};
const malformedResult = resolveWorkspaceEntryCompilation(malformed, {
  packageName: 'dragon',
  entryName: 'main',
});
assert.equal(malformedResult.ok, false);
const repeated = resolveWorkspaceEntryCompilation(local, {
  packageName: 'dragon',
  entryName: 'main',
});
assert.equal(repeated.ok, true);
if (repeated.ok)
  assert.deepEqual(
    repeated.value.closure.files.map((file) => file.identity.key),
    localClosure.files.map((file) => file.identity.key),
  );

console.log('workspace selected-entry compilation closure contract ok');
