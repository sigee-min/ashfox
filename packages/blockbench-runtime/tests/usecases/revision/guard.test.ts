import assert from 'node:assert/strict';
import {
  decideRevision,
  type RevisionGuardDeps,
} from '../../../src/usecases/revision/revisionGuard';
import type { ProjectState, ToolError } from '@ashfox/blockbench-contracts/types/internal';

const makeProject = (revision: string): ProjectState => ({
  id: 'project-1',
  active: true,
  name: 'demo',
  format: 'geckolib',
  revision,
  counts: {
    bones: 0,
    cubes: 0,
    textures: 0,
    animations: 0,
  },
});

const makeState = (revision: string) => ({
  ok: true as const,
  value: { project: makeProject(revision) },
});

const makeErrorState = () => ({
  ok: false as const,
  error: {
    code: 'invalid_state',
    message: 'state missing',
  } satisfies ToolError,
});

const baseDeps: RevisionGuardDeps = {
  requiresRevision: true,
  allowAutoRetry: false,
  getProjectState: () => makeState('r1'),
};

const noGuard = decideRevision(undefined, { ...baseDeps, requiresRevision: false });
assert.equal(noGuard.ok, true);
if (noGuard.ok) {
  assert.equal(noGuard.action, 'proceed');
}

const missing = decideRevision(undefined, baseDeps);
assert.equal(missing.ok, false);
if (!missing.ok) {
  assert.equal(missing.error.code, 'invalid_state');
}

const mismatchRetry = decideRevision('r0', { ...baseDeps, allowAutoRetry: true });
assert.equal(mismatchRetry.ok, true);
if (mismatchRetry.ok) {
  assert.equal(mismatchRetry.action, 'retry');
  assert.equal(mismatchRetry.currentRevision, 'r1');
}

const mismatchError = decideRevision('r0', baseDeps);
assert.equal(mismatchError.ok, false);
if (!mismatchError.ok) {
  assert.equal(mismatchError.error.code, 'invalid_state_revision_mismatch');
}

const match = decideRevision('r1', baseDeps);
assert.equal(match.ok, true);
if (match.ok) {
  assert.equal(match.action, 'proceed');
  assert.equal(match.currentRevision, 'r1');
}

const stateError = decideRevision('r1', { ...baseDeps, getProjectState: makeErrorState });
assert.equal(stateError.ok, false);
if (!stateError.ok) {
  assert.equal(stateError.error.code, 'invalid_state');
}
