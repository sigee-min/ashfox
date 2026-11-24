import assert from 'node:assert/strict';

import {
  computeWorkspaceHash,
  readAuthoredAssetWorkspace,
  resolveWorkspaceEntry,
  validateWorkspaceEntries,
  type AuthoredAssetWorkspace,
  type Sha256Digest,
} from '../../../src/project/workspace';
import * as workspaceApi from '../../../src/project/workspace';
import { stageWorkspaceChangeSet } from '../../../src/project/workspace/change';
import { resolveWorkspaceEntryCompilation } from '../../../src/project/workspace/graph';
import { assetSource, moduleSource, packagesFixture, workspaceFixture } from './fixtures';

const digest = (character: string): Sha256Digest =>
  `sha256:${character.repeat(64)}` as Sha256Digest;

const expectOneDiagnostic = (
  result: ReturnType<typeof resolveWorkspaceEntry>,
  code: string,
): void => {
  assert.equal(result.ok, false);
  if (result.ok) throw new Error(`Expected ${code}.`);
  assert.equal(
    result.diagnostics.length,
    1,
    `${code} must halt with one diagnostic, not a diagnostic flood`,
  );
  assert.equal(result.diagnostics[0]?.code, code);
};

const base = workspaceFixture(
  [
    { path: 'dragon/main.ashfox', source: assetSource('main', ['./util.ashfox']) },
    { path: 'dragon/util.ashfox', source: moduleSource('util') },
  ],
  { modules: [{ subpath: './util', path: 'util.ashfox' }] },
);

const staleCompiler: AuthoredAssetWorkspace = {
  ...base,
  lock: { ...base.lock, compilerFingerprint: 'forged-compiler' },
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

const staleContent: AuthoredAssetWorkspace = {
  ...base,
  lock: {
    ...base.lock,
    packages: base.lock.packages.map((pkg, index) =>
      index === 0 ? { ...pkg, contentHash: digest('0') } : pkg,
    ),
  },
};
const staleContentResult = readAuthoredAssetWorkspace(staleContent);
assert.equal(staleContentResult.ok, false);
assert.ok(
  !staleContentResult.ok &&
    staleContentResult.diagnostics.some((item) => item.code === 'workspace.lock.stale_content'),
);

const staleInterface: AuthoredAssetWorkspace = {
  ...base,
  lock: {
    ...base.lock,
    packages: base.lock.packages.map((pkg, index) =>
      index === 0 ? { ...pkg, interfaceHash: digest('f') } : pkg,
    ),
  },
};
const staleInterfaceResult = resolveWorkspaceEntry(staleInterface, {
  packageName: 'dragon',
  entryName: 'main',
});
assert.equal(staleInterfaceResult.ok, true);
const staleInterfaceValidation = validateWorkspaceEntries(staleInterface);
assert.ok(staleInterfaceValidation.some((item) => item.code === 'workspace.lock.stale_interface'));

const sameRoot = packagesFixture([
  {
    name: 'first',
    root: 'shared',
    entries: [{ name: 'first', path: 'first.ashfox' }],
    modules: [],
    files: [{ path: 'shared/first.ashfox', source: assetSource('first') }],
  },
  {
    name: 'second',
    root: 'shared',
    entries: [{ name: 'second', path: 'second.ashfox' }],
    modules: [],
    files: [{ path: 'shared/second.ashfox', source: assetSource('second') }],
  },
]);
const sameRootResult = readAuthoredAssetWorkspace(sameRoot);
assert.equal(sameRootResult.ok, false);
assert.ok(
  !sameRootResult.ok &&
    sameRootResult.diagnostics.some((item) => item.code === 'workspace.package.overlap'),
);

const sharedFile = {
  path: 'deps/library/main.ashfox',
  source: assetSource('main'),
};
const aliasedOwnershipInput = packagesFixture([
  {
    name: 'root',
    root: '',
    entries: [{ name: 'main', path: 'deps/library/main.ashfox' }],
    modules: [],
    files: [sharedFile],
  },
  {
    name: 'library',
    root: 'deps/library',
    entries: [{ name: 'main', path: 'main.ashfox' }],
    modules: [],
    files: [sharedFile],
  },
]);
const aliasedOwnership: AuthoredAssetWorkspace = {
  ...aliasedOwnershipInput,
  files: Object.freeze([sharedFile]),
};

const packageWorkspace = (unusedSource: string): AuthoredAssetWorkspace =>
  packagesFixture([
    {
      name: 'application',
      root: 'application',
      entries: [{ name: 'main', path: 'main.ashfox' }],
      modules: [],
      dependencies: ['library'],
      files: [{ path: 'application/main.ashfox', source: assetSource('main', ['library/shared']) }],
    },
    {
      name: 'library',
      root: 'library',
      entries: [],
      modules: [
        { subpath: './shared', path: 'shared.ashfox' },
        { subpath: './unused', path: 'unused.ashfox' },
      ],
      files: [
        { path: 'library/shared.ashfox', source: moduleSource('shared') },
        { path: 'library/unused.ashfox', source: unusedSource },
      ],
    },
  ]);

const packageBefore = resolveWorkspaceEntryCompilation(packageWorkspace(moduleSource('unused')), {
  packageName: 'application',
  entryName: 'main',
});
const packageAfter = resolveWorkspaceEntryCompilation(
  packageWorkspace(`${moduleSource('unused')}\n// unrelated byte change`),
  { packageName: 'application', entryName: 'main' },
);
assert.equal(packageBefore.ok, true, packageBefore.ok ? '' : packageBefore.diagnostics[0]?.message);
assert.equal(packageAfter.ok, true, packageAfter.ok ? '' : packageAfter.diagnostics[0]?.message);
if (packageBefore.ok && packageAfter.ok)
  assert.equal(
    packageAfter.value.build.closureHash,
    packageBefore.value.build.closureHash,
    'an unrelated package module must not invalidate a selected entry closure',
  );
const closureBefore = packageBefore.ok ? packageBefore.value.closure : undefined;
const closureAfter = packageAfter.ok ? packageAfter.value.closure : undefined;
assert.ok(
  closureBefore !== undefined && closureAfter !== undefined,
  'an internal resolved entry must return its semantic closure',
);
const sharedIdentityBefore = closureBefore?.files.find(
  (file) =>
    file.identity.packageName === 'library' && file.identity.path === 'library/shared.ashfox',
)?.identity.key;
const sharedIdentityAfter = closureAfter?.files.find(
  (file) =>
    file.identity.packageName === 'library' && file.identity.path === 'library/shared.ashfox',
)?.identity.key;

expectOneDiagnostic(
  resolveWorkspaceEntry(
    base,
    { packageName: 'dragon', entryName: 'main' },
    { limits: { maxFiles: 0 } },
  ),
  'workspace.budget.invalid',
);

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
expectOneDiagnostic(
  resolveWorkspaceEntry(cycle, { packageName: 'dragon', entryName: 'main' }),
  'workspace.import.cycle',
);

const depth = workspaceFixture(
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
expectOneDiagnostic(
  resolveWorkspaceEntry(
    depth,
    { packageName: 'dragon', entryName: 'main' },
    { limits: { maxImportDepth: 1 } },
  ),
  'workspace.budget.import_depth',
);

const edges = workspaceFixture(
  [
    { path: 'dragon/main.ashfox', source: assetSource('main', ['./a.ashfox', './b.ashfox']) },
    { path: 'dragon/a.ashfox', source: moduleSource('a') },
    { path: 'dragon/b.ashfox', source: moduleSource('b') },
  ],
  {
    modules: [
      { subpath: './a', path: 'a.ashfox' },
      { subpath: './b', path: 'b.ashfox' },
    ],
  },
);
expectOneDiagnostic(
  resolveWorkspaceEntry(
    edges,
    { packageName: 'dragon', entryName: 'main' },
    { limits: { maxImportEdges: 1 } },
  ),
  'workspace.budget.import_edges',
);

const noOp = stageWorkspaceChangeSet(base, {
  expectedWorkspaceHash: computeWorkspaceHash(base),
  writes: [],
  deletes: [],
});
assert.equal(noOp.ok, true, noOp.ok ? '' : noOp.diagnostics[0]?.message);
if (noOp.ok) assert.equal(noOp.workspaceHash, computeWorkspaceHash(base));
assert.equal(
  'applyWorkspaceChangeSet' in workspaceApi,
  false,
  'the workspace barrel must not expose an authoritative apply operation',
);

const failures: string[] = [];
if (sharedIdentityBefore !== sharedIdentityAfter) {
  failures.push('unrelated package bytes change a reachable nominal source identity');
}
if (readAuthoredAssetWorkspace(aliasedOwnership).ok) {
  failures.push('one logical file can be owned by two packages');
}
assert.deepEqual(failures, [], failures.join('; '));

console.log('workspace adversarial authority, graph, CAS, and staging gates ok');
