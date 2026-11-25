import assert from 'node:assert/strict';

import { isAssetProjectAuthorityValid, openAssetProject } from '../../src';
import { VALID_ASSET_SOURCE, validAssetWorkspace } from '../program/asset/fixture';

const entry = Object.freeze({ packageName: 'wolf', entryName: 'wolf' });
const identity = {
  id: 'project:command',
  revision: 'revision:1',
  createdAt: '2026-01-01T00:00:00.000Z',
};
const opened = openAssetProject({
  workspace: validAssetWorkspace(),
  entry,
  identity,
});
assert.equal(opened.ok, true, opened.ok ? '' : opened.diagnostics[0]?.message);
if (!opened.ok) throw new Error('valid project fixture did not open');

assert.equal(opened.project.entry.packageName, 'wolf');
assert.equal(isAssetProjectAuthorityValid(opened.project), true);

const reopened = openAssetProject({
  workspace: validAssetWorkspace(),
  entry,
  identity,
});
assert.equal(reopened.ok, true);
if (reopened.ok) {
  assert.equal(reopened.project.build.workspaceHash, opened.project.build.workspaceHash);
  assert.equal(reopened.project.build.buildKey, opened.project.build.buildKey);
}

const invalidWorkspace = {
  ...validAssetWorkspace(),
  files: validAssetWorkspace().files.map((file) =>
    file.path === 'wolf/main.ashfox'
      ? { ...file, source: 'ashfox-model 1\nasset wolf {' }
      : { ...file },
  ),
};
const invalid = openAssetProject({
  workspace: {
    ...invalidWorkspace,
    lock: undefined as never,
  },
  entry,
  identity,
});
assert.equal(invalid.ok, false);

const tamperedSource = {
  ...opened.project,
  workspace: {
    ...opened.project.workspace,
    files: opened.project.workspace.files.map((file) =>
      file.path === 'wolf/main.ashfox' ? { ...file, source: VALID_ASSET_SOURCE + '\n' } : file,
    ),
  },
};
assert.equal(isAssetProjectAuthorityValid(tamperedSource), false);

console.log('workspace project boundary ok');
