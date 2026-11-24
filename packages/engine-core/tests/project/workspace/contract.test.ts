import assert from 'node:assert/strict';

import {
  ASHFOX_LOCK_FORMAT,
  ASHFOX_WORKSPACE_COMPILER_FINGERPRINT,
  ASHFOX_PACKAGE_FORMAT,
  ASHFOX_WORKSPACE_FORMAT,
  ASHFOX_WORKSPACE_VERSION,
  computeWorkspaceHash,
  decodeUtf8Source,
  normalizeLogicalPath,
  readAuthoredAssetWorkspace,
  readWorkspaceLock,
  readWorkspaceManifest,
  withWorkspaceLimits,
} from '../../../src/project/workspace';
import { assetSource, workspaceFixture } from './fixtures';

const source = assetSource('main');
const workspace = workspaceFixture([{ path: 'dragon/main.ashfox', source }]);
const opened = readAuthoredAssetWorkspace(workspace);
assert.equal(opened.ok, true, opened.ok ? '' : opened.diagnostics[0]?.message);
if (!opened.ok) throw new Error('fixture should be a valid workspace');
assert.equal(Object.isFrozen(opened.value), true);
assert.equal(Object.isFrozen(opened.value.files), true);
assert.equal(computeWorkspaceHash(opened.value), computeWorkspaceHash(workspace));

for (const unknownKey of [
  { format: ASHFOX_WORKSPACE_FORMAT, version: 1, packages: [], extra: true },
  { format: ASHFOX_LOCK_FORMAT, version: 1, compilerFingerprint: 'x', packages: [], extra: true },
]) {
  const result =
    'compilerFingerprint' in unknownKey
      ? readWorkspaceLock(unknownKey)
      : readWorkspaceManifest(unknownKey);
  assert.equal(result.ok, false, 'closed readers reject unknown keys');
}

for (const badPath of [
  '../escape.ashfox',
  '/absolute.ashfox',
  'a//b.ashfox',
  'a/./b.ashfox',
  'a/../b.ashfox',
  'a\\b.ashfox',
  'a%2Fb.ashfox',
])
  assert.throws(() => normalizeLogicalPath(badPath));
assert.throws(() => normalizeLogicalPath('e\u0301.ashfox'));
assert.throws(() => normalizeLogicalPath('bad\uD800.ashfox'));
const malformedSource = readAuthoredAssetWorkspace({
  ...workspace,
  files: [{ path: 'dragon/main.ashfox', source: 'bad\uD800' }],
});
assert.equal(malformedSource.ok, false);

const duplicate = readAuthoredAssetWorkspace({
  ...workspace,
  files: [
    { path: 'dragon/main.ashfox', source },
    { path: 'dragon/MAIN.ashfox', source },
  ],
});
assert.equal(duplicate.ok, false);

assert.throws(() => decodeUtf8Source(Uint8Array.of(0xc3, 0x28)));
assert.equal(new TextDecoder().decode(new TextEncoder().encode('용')), '용');
assert.throws(() => withWorkspaceLimits({ maxFiles: Number.NaN }));
assert.throws(() => withWorkspaceLimits({ maxFiles: Number.POSITIVE_INFINITY }));
assert.throws(() => withWorkspaceLimits({ maxFiles: 0 }));

const staleLock = structuredClone(workspace);
(staleLock.lock.packages[0] as { contentHash: string }).contentHash = 'sha256:' + '0'.repeat(64);
const stale = readAuthoredAssetWorkspace(staleLock);
assert.equal(stale.ok, false);
assert.ok(
  !stale.ok && stale.diagnostics.some((item) => item.code === 'workspace.lock.stale_content'),
);

console.log('workspace contract readers and authority hash ok');
