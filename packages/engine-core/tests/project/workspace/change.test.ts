import assert from 'node:assert/strict';

import {
  computeSourceContentHash,
  computeWorkspaceHash,
  type Sha256Digest,
  type WorkspaceChangeSet
} from '../../../src/project/workspace';
import { stageWorkspaceChangeSet } from '../../../src/project/workspace/change';
import { assetSource, moduleSource, workspaceFixture } from './fixtures';

const current = workspaceFixture([
  { path: 'dragon/main.ashfox', source: assetSource('main', ['./util.ashfox']) },
  { path: 'dragon/util.ashfox', source: moduleSource('util') }
], { modules: [{ subpath: './util', path: 'util.ashfox' }] });
const currentHash = computeWorkspaceHash(current);

const noOp = stageWorkspaceChangeSet(current, {
  expectedWorkspaceHash: currentHash,
  writes: [],
  deletes: []
});
assert.equal(noOp.ok, true, noOp.ok ? '' : noOp.diagnostics[0]?.message);
if (!noOp.ok) throw new Error('no-op change should succeed');
assert.equal(computeWorkspaceHash(noOp.candidate), noOp.workspaceHash);
assert.notEqual(noOp.candidate, current);

const stale = stageWorkspaceChangeSet(current, {
  expectedWorkspaceHash: ('sha256:' + '0'.repeat(64)) as Sha256Digest,
  writes: [],
  deletes: []
});
assert.equal(stale.ok, false);
assert.ok(!stale.ok && stale.diagnostics.some((item) => item.code === 'workspace.cas.stale'));

const changedSource = `${assetSource('main', ['./util.ashfox'])}\n// changed`;
const update: WorkspaceChangeSet = {
  expectedWorkspaceHash: currentHash,
  writes: [{
    path: 'dragon/main.ashfox',
    source: changedSource,
    expectedHash: computeSourceContentHash(assetSource('main', ['./util.ashfox']))
  }],
  deletes: []
};
const staged = stageWorkspaceChangeSet(current, update);
assert.equal(staged.ok, true, staged.ok ? '' : staged.diagnostics[0]?.message);
if (staged.ok) assert.equal(staged.candidate.files[0]?.path, 'dragon/main.ashfox');

const race = stageWorkspaceChangeSet(current, {
  expectedWorkspaceHash: currentHash,
  writes: [{
    path: 'dragon/main.ashfox',
    source: changedSource,
    expectedHash: ('sha256:' + 'f'.repeat(64)) as Sha256Digest
  }],
  deletes: []
});
assert.equal(race.ok, false);
assert.ok(!race.ok && race.diagnostics.some((item) => item.code === 'workspace.cas.file_race'));

const invalid = workspaceFixture([
  { path: 'dragon/main.ashfox', source: 'ashfox-model 1\nasset main {' },
  { path: 'dragon/util.ashfox', source: moduleSource('util') }
], { modules: [{ subpath: './util', path: 'util.ashfox' }] });
const structuralStage = stageWorkspaceChangeSet(current, {
  expectedWorkspaceHash: currentHash,
  writes: [{ path: 'dragon/main.ashfox', source: invalid.files[0]!.source }],
  deletes: []
});
assert.equal(structuralStage.ok, false, 'local lock sealing requires syntactically valid source');
if (!structuralStage.ok) assert.ok(structuralStage.diagnostics.some((item) =>
  item.code.startsWith('workspace.source.')));

console.log('workspace structural change staging and CAS checks ok');
