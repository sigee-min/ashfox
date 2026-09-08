import assert from 'node:assert/strict';

import {
  applyWorkspaceChangeSet,
  computeSourceContentHash,
  computeWorkspaceHash
} from '../../../src';
import { workspaceFixture } from '../../project/workspace/fixtures';
import { VALID_ASSET_SOURCE, validAssetWorkspace } from './fixture';

const current = validAssetWorkspace();
const noChange = applyWorkspaceChangeSet(current, {
  expectedWorkspaceHash: computeWorkspaceHash(current),
  writes: [],
  deletes: []
});
assert.equal(noChange.ok, true, noChange.ok ? '' :
  noChange.diagnostics.map((item) => item.code).join(', '));
if (noChange.ok) {
  assert.deepEqual(Object.keys(noChange).sort(), ['ok', 'workspace', 'workspaceHash']);
  assert.ok(Object.isFrozen(noChange));
  assert.ok(Object.isFrozen(noChange.workspace));
}

const invalidSource = VALID_ASSET_SOURCE.replace('size = (4u, 4u, 4u);',
  'size = (5u, 4u, 4u);');
const invalidWorkspace = validAssetWorkspace(invalidSource);
const invalid = applyWorkspaceChangeSet(current, {
  expectedWorkspaceHash: computeWorkspaceHash(current),
  writes: [{
    path: 'wolf/main.ashfox',
    source: invalidSource,
    expectedHash: computeSourceContentHash(VALID_ASSET_SOURCE)
  }],
  deletes: []
});
assert.equal(invalid.ok, false, 'semantic failure must reject the entire staged workspace');
if (!invalid.ok) {
  assert.deepEqual(Object.keys(invalid).sort(), ['diagnostics', 'ok']);
  assert.ok(invalid.diagnostics.some((item) =>
    item.code === 'asset.texture.chart-size-mismatch'));
}

const stale = applyWorkspaceChangeSet(current, {
  expectedWorkspaceHash: invalidWorkspace.lock.packages[0]!.contentHash,
  writes: [],
  deletes: []
});
assert.equal(stale.ok, false);
if (!stale.ok) assert.ok(stale.diagnostics.some((item) => item.code === 'workspace.cas.stale'));

const foxSource = VALID_ASSET_SOURCE.replaceAll('wolf', 'fox');
const multiCurrent = workspaceFixture([
  { path: 'pack/wolf.ashfox', source: VALID_ASSET_SOURCE },
  { path: 'pack/fox.ashfox', source: foxSource }
], {
  root: 'pack',
  packageName: 'pack',
  entries: [
    { name: 'fox', path: 'fox.ashfox' },
    { name: 'wolf', path: 'wolf.ashfox' }
  ]
});
const invalidWolf = VALID_ASSET_SOURCE.replace('size = (4u, 4u, 4u);',
  'size = (5u, 4u, 4u);');
const invalidFox = foxSource.replace('size = (4u, 4u, 4u);',
  'size = (5u, 4u, 4u);');
const bounded = applyWorkspaceChangeSet(multiCurrent, {
  expectedWorkspaceHash: computeWorkspaceHash(multiCurrent),
  writes: [
    { path: 'pack/fox.ashfox', source: invalidFox },
    { path: 'pack/wolf.ashfox', source: invalidWolf }
  ],
  deletes: []
}, { limits: { maxDiagnostics: 1 } });
assert.equal(bounded.ok, false);
if (!bounded.ok) assert.equal(bounded.diagnostics.length, 1,
  'the atomic semantic gate must honor the caller diagnostic budget globally');

const hostile = applyWorkspaceChangeSet(new Proxy(current, {
  get(target, property, receiver) {
    if (property === 'files') throw new Error('hostile getter');
    return Reflect.get(target, property, receiver);
  }
}), {
  expectedWorkspaceHash: computeWorkspaceHash(current),
  writes: [],
  deletes: []
});
assert.equal(hostile.ok, false, 'workspace changes must contain hostile object access');
if (!hostile.ok) assert.deepEqual(hostile.diagnostics.map((item) => item.code), [
  'workspace.change.failure'
]);

const unknownKey = applyWorkspaceChangeSet(current, {
  expectedWorkspaceHash: computeWorkspaceHash(current),
  writes: [],
  deletes: [],
  extra: true
} as never);
assert.equal(unknownKey.ok, false);
if (!unknownKey.ok) assert.equal(unknownKey.diagnostics[0]?.code,
  'workspace.cas.changeset');

const unknownLimit = applyWorkspaceChangeSet(current, {
  expectedWorkspaceHash: computeWorkspaceHash(current),
  writes: [],
  deletes: []
}, { limits: { unexpected: 1 } } as never);
assert.equal(unknownLimit.ok, false);
if (!unknownLimit.ok) assert.equal(unknownLimit.diagnostics[0]?.code,
  'workspace.budget.invalid');

console.log('asset workspace atomic semantic change gate ok');
