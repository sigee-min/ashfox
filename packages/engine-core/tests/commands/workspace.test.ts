import assert from 'node:assert/strict';

import {
  executeAgentCommandBatch,
  executeSystemCommandBatch,
  executeWebCommandBatch,
  type CommandBatch
} from '../../src/commands';
import {
  AGENT_ACCESSIBLE_COMMAND_NAMES,
  commandAllowedForSource
} from '../../src/commands/registry';
import { openAssetProject } from '../../src';
import {
  computeSourceContentHash,
  computeWorkspaceHash
} from '../../src/project/workspace';
import { VALID_ASSET_SOURCE, validAssetWorkspace } from '../program/asset/fixture';

const entry = Object.freeze({ packageName: 'wolf', entryName: 'wolf' });
const identity = {
  id: 'project:command',
  revision: 'revision:1',
  createdAt: '2026-01-01T00:00:00.000Z'
};
const opened = openAssetProject({
  workspace: validAssetWorkspace(),
  entry,
  identity
});
assert.equal(opened.ok, true, opened.ok ? '' : opened.diagnostics[0]?.message);
if (!opened.ok) throw new Error('valid command fixture did not open');

const changedSource = VALID_ASSET_SOURCE.replace(
  'origin = (-2u, 0u, -2u);',
  'origin = (-1u, 0u, -2u);'
);
const change = {
  expectedWorkspaceHash: computeWorkspaceHash(opened.project.workspace),
  writes: [{
    path: 'wolf/main.ashfox',
    source: changedSource,
    expectedHash: computeSourceContentHash(VALID_ASSET_SOURCE)
  }],
  deletes: []
};

const batch = (payload: CommandBatch['operations'][number]['payload']): CommandBatch => ({
  batchId: 'batch:workspace',
  baseProjectId: opened.project.id,
  baseRevision: opened.project.revision,
  operations: [{ name: 'workspace.apply', payload }]
});

const applied = executeAgentCommandBatch(opened.project, batch({
  entry,
  changes: change
}));
assert.equal(applied.ok, true, applied.ok ? '' : applied.error.message);
if (applied.ok) {
  assert.ok(applied.project.build.workspaceHash !== opened.project.build.workspaceHash);
  assert.equal('document' in applied, false);
  assert.equal(applied.project.entry.packageName, 'wolf');
}

const noOp = executeAgentCommandBatch(opened.project, batch({
  entry,
  changes: {
    expectedWorkspaceHash: computeWorkspaceHash(opened.project.workspace),
    writes: [],
    deletes: []
  }
}));
assert.equal(noOp.ok, false);
if (!noOp.ok) assert.equal(noOp.error.code, 'no_change');

const retiredChanges = { ...change, lock: opened.project.workspace.lock };
const retiredLock = executeAgentCommandBatch(opened.project, batch({ entry, changes: retiredChanges }));
assert.equal(retiredLock.ok, false, 'write command rejects caller-authored locks');
if (!retiredLock.ok) assert.match(retiredLock.error.path ?? '', /changes/u);

const invalidSource = 'ashfox-model 1\nasset wolf {';
const invalid = executeAgentCommandBatch(opened.project, batch({
  entry,
  changes: {
    expectedWorkspaceHash: computeWorkspaceHash(opened.project.workspace),
    writes: [{ path: 'wolf/main.ashfox', source: invalidSource }],
    deletes: []
  }
}));
assert.equal(invalid.ok, false);
if (!invalid.ok) {
  assert.equal(invalid.error.code, 'invalid_state');
  assert.match(invalid.error.path ?? '', /wolf\/main\.ashfox/u);
}

const tooMany = executeAgentCommandBatch(opened.project, {
  ...batch({ entry, changes: change }),
  operations: [
    { name: 'workspace.apply', payload: { entry, changes: change } },
    { name: 'workspace.apply', payload: { entry, changes: change } }
  ]
});
assert.equal(tooMany.ok, false);
if (!tooMany.ok) assert.equal(tooMany.error.code, 'invalid_batch');

assert.deepEqual(AGENT_ACCESSIBLE_COMMAND_NAMES, ['workspace.apply']);
assert.equal(commandAllowedForSource('workspace.apply', 'web'), true);
assert.equal(commandAllowedForSource('workspace.apply', 'system'), true);
assert.equal(commandAllowedForSource('workspace.apply', 'agent'), true);
assert.equal(commandAllowedForSource('workspace.apply', 'import'), true);

const web = executeWebCommandBatch(opened.project, batch({ entry, changes: change }));
const system = executeSystemCommandBatch(opened.project, batch({ entry, changes: change }));
assert.equal(web.ok, true, web.ok ? '' : web.error.message);
assert.equal(system.ok, true, system.ok ? '' : system.error.message);

console.log('workspace command boundary ok');
