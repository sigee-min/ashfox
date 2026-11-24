import assert from 'node:assert/strict';

import {
  ASHFOX_WORKSPACE_COMPILER_FINGERPRINT,
  resolveWorkspaceEntry,
  type AuthoredAssetWorkspace,
} from '../../../src/project/workspace';
import { assetSource, moduleSource, packagesFixture, workspaceFixture } from './fixtures';

const graphWorkspace = workspaceFixture(
  [
    { path: 'dragon/main.ashfox', source: assetSource('main', ['./util.ashfox']) },
    { path: 'dragon/util.ashfox', source: moduleSource('util') },
    { path: 'dragon/other.ashfox', source: assetSource('other') },
  ],
  {
    entries: [
      { name: 'main', path: 'main.ashfox' },
      { name: 'other', path: 'other.ashfox' },
    ],
    modules: [{ subpath: './util', path: 'util.ashfox' }],
  },
);

const resolved = resolveWorkspaceEntry(graphWorkspace, {
  packageName: 'dragon',
  entryName: 'main',
});
assert.equal(resolved.ok, true, resolved.ok ? '' : resolved.diagnostics[0]?.message);
if (!resolved.ok) throw new Error('graph fixture should resolve');
assert.deepEqual(
  resolved.value.nodes.map((node) => node.name),
  ['./util', 'main'],
);
assert.equal(resolved.value.edges[0]?.from, 'dragon:dragon/main.ashfox');
assert.equal(resolved.value.edges[0]?.to, 'dragon:dragon/util.ashfox');
assert.equal(resolved.value.compilerFingerprint, ASHFOX_WORKSPACE_COMPILER_FINGERPRINT);
assert.notEqual(resolved.value.closureHash, resolved.value.buildKey);

const unrelated = workspaceFixture(
  [
    { path: 'dragon/main.ashfox', source: assetSource('main', ['./util.ashfox']) },
    { path: 'dragon/util.ashfox', source: moduleSource('util') },
    { path: 'dragon/other.ashfox', source: assetSource('other_changed') },
  ],
  {
    entries: [
      { name: 'main', path: 'main.ashfox' },
      { name: 'other_changed', path: 'other.ashfox' },
    ],
    modules: [{ subpath: './util', path: 'util.ashfox' }],
  },
);
const unrelatedResult = resolveWorkspaceEntry(unrelated, {
  packageName: 'dragon',
  entryName: 'main',
});
assert.equal(unrelatedResult.ok, true);
if (unrelatedResult.ok) assert.equal(unrelatedResult.value.closureHash, resolved.value.closureHash);

const changedDependency = workspaceFixture(
  [
    { path: 'dragon/main.ashfox', source: assetSource('main', ['./util.ashfox']) },
    { path: 'dragon/util.ashfox', source: moduleSource('util_changed') },
    { path: 'dragon/other.ashfox', source: assetSource('other') },
  ],
  {
    entries: [
      { name: 'main', path: 'main.ashfox' },
      { name: 'other', path: 'other.ashfox' },
    ],
    modules: [{ subpath: './util', path: 'util.ashfox' }],
  },
);
const changedResult = resolveWorkspaceEntry(changedDependency, {
  packageName: 'dragon',
  entryName: 'main',
});
assert.equal(changedResult.ok, true);
if (changedResult.ok) assert.notEqual(changedResult.value.closureHash, resolved.value.closureHash);

const cycle = workspaceFixture(
  [
    { path: 'dragon/main.ashfox', source: assetSource('main', ['./a.ashfox']) },
    { path: 'dragon/a.ashfox', source: moduleSource('a', ['./b.ashfox']) },
    { path: 'dragon/b.ashfox', source: moduleSource('b', ['./a.ashfox']) },
  ],
  {
    modules: [
      { subpath: './a', path: 'a.ashfox' },
      { subpath: './b', path: 'b.ashfox' },
    ],
  },
);
const cycleResult = resolveWorkspaceEntry(cycle, { packageName: 'dragon', entryName: 'main' });
assert.equal(cycleResult.ok, false);
assert.ok(
  !cycleResult.ok && cycleResult.diagnostics.some((item) => item.code === 'workspace.import.cycle'),
);

const staleCompilerCopy = structuredClone(graphWorkspace);
const staleCompiler: AuthoredAssetWorkspace = {
  ...staleCompilerCopy,
  lock: { ...staleCompilerCopy.lock, compilerFingerprint: 'not-current' },
};
const staleCompilerResult = resolveWorkspaceEntry(staleCompiler, {
  packageName: 'dragon',
  entryName: 'main',
});
assert.equal(staleCompilerResult.ok, false);
assert.ok(
  !staleCompilerResult.ok &&
    staleCompilerResult.diagnostics.some(
      (item) => item.code === 'workspace.lock.compiler_fingerprint',
    ),
);

const deepWorkspace = workspaceFixture(
  [
    { path: 'dragon/main.ashfox', source: assetSource('main', ['./a.ashfox']) },
    { path: 'dragon/a.ashfox', source: moduleSource('a', ['./b.ashfox']) },
    { path: 'dragon/b.ashfox', source: moduleSource('b') },
  ],
  {
    modules: [
      { subpath: './a', path: 'a.ashfox' },
      { subpath: './b', path: 'b.ashfox' },
    ],
  },
);
const budgetResult = resolveWorkspaceEntry(
  deepWorkspace,
  { packageName: 'dragon', entryName: 'main' },
  { limits: { maxImportDepth: 1 } },
);
assert.equal(budgetResult.ok, false);
assert.ok(
  !budgetResult.ok &&
    budgetResult.diagnostics.some((item) => item.code === 'workspace.budget.import_depth'),
);

const packageGraph = packagesFixture([
  {
    name: 'app',
    root: 'app',
    entries: [{ name: 'main', path: 'main.ashfox' }],
    modules: [],
    dependencies: ['lib'],
    files: [{ path: 'app/main.ashfox', source: assetSource('main', ['lib/common']) }],
  },
  {
    name: 'lib',
    root: 'lib',
    entries: [],
    modules: [{ subpath: './common', path: 'common.ashfox' }],
    files: [{ path: 'lib/common.ashfox', source: moduleSource('common') }],
  },
]);
const packageResult = resolveWorkspaceEntry(packageGraph, {
  packageName: 'app',
  entryName: 'main',
});
assert.equal(packageResult.ok, true, packageResult.ok ? '' : packageResult.diagnostics[0]?.message);
if (packageResult.ok) {
  assert.equal(
    packageResult.value.nodes.some((node) => node.packageName === 'lib'),
    true,
  );
  assert.equal(packageResult.value.edges[0]?.to, 'lib:lib/common.ashfox');
}

console.log('workspace parser-bound graph, closure, cycle, and budget checks ok');
