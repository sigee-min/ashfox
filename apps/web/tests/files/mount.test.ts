import assert from 'node:assert/strict';
import { mountFileOperation } from '../../src/features/files/operationMount';
import { fileOperationReducer, INITIAL_FILE_OPERATION } from '../../src/features/files/fileOperationState';

const mounted = { current: true };
const active: { current: { controller: AbortController } | null } = { current: null };
const cleanup = mountFileOperation(mounted, active);
cleanup();
assert.equal(mounted.current, false);

// React StrictMode replays setup after cleanup while retaining the same refs.
const unmount = mountFileOperation(mounted, active);
assert.equal(mounted.current, true, 'replayed setup must allow progress and settlement');
const controller = new AbortController();
active.current = { controller };
let state = fileOperationReducer(INITIAL_FILE_OPERATION, {
  type: 'start', operationId: 1, kind: 'open', message: 'Opening workspace'
});
if (mounted.current) state = fileOperationReducer(state, {
  type: 'progress', operationId: 1, message: 'Reading workspace'
});
if (mounted.current) state = fileOperationReducer(state, {
  type: 'settle', operationId: 1, phase: 'succeeded', message: 'Workspace opened', result: null
});
assert.equal(state.phase, 'succeeded');
assert.equal(controller.signal.aborted, false);

let observedDetached = false;
controller.signal.addEventListener('abort', () => {
  observedDetached = !mounted.current && active.current === null;
});
unmount();
assert.equal(mounted.current, false);
assert.equal(active.current, null);
assert.equal(controller.signal.aborted, true);
assert.equal(observedDetached, true, 'abort listeners must observe detached, unmounted work');
unmount();
assert.equal(active.current, null, 'cleanup remains idempotent');
console.log('file operation effect replay restores progress and settlement liveness');
