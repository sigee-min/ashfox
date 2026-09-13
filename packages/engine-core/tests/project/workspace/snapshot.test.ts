import assert from 'node:assert/strict';
import {
  prepareCompilationSnapshot, resolveWorkspaceEntryCompilationFromSnapshot,
  validateCompilationSnapshot
} from '../../../src/project/workspace/graph';
import { moduleSource, workspaceFixture } from './fixtures';

const workspace = workspaceFixture([
  { path: 'dragon/main.ashfox', source: 'ashfox-model 1\nasset main { import "./util.ashfox" as util; }' },
  { path: 'dragon/other.ashfox', source: 'ashfox-model 1\nasset other { import "./util.ashfox" as util; }' },
  { path: 'dragon/util.ashfox', source: moduleSource('util') }
], {
  entries: [{ name: 'main', path: 'main.ashfox' }, { name: 'other', path: 'other.ashfox' }],
  modules: [{ subpath: './util', path: 'util.ashfox' }]
});
const prepared = prepareCompilationSnapshot(workspace, {});
assert.ok(prepared.ok);
if (!prepared.ok) throw new Error('Fixture must prepare');
assert.deepEqual(validateCompilationSnapshot(prepared.value), []);
const main = resolveWorkspaceEntryCompilationFromSnapshot(prepared.value, { packageName: 'dragon', entryName: 'main' });
const other = resolveWorkspaceEntryCompilationFromSnapshot(prepared.value, { packageName: 'dragon', entryName: 'other' });
assert.ok(main.ok && other.ok);
if (!main.ok || !other.ok) throw new Error('Fixture entries must resolve');
const shared = main.value.closure.files.find(file => file.identity.path === 'dragon/util.ashfox')!;
assert.equal(other.value.closure.files.find(file => file.identity.path === shared.identity.path)!.unit, shared.unit,
  'Entries in the same build consume one parsed shared module.');
const next = prepareCompilationSnapshot(workspace, {});
assert.ok(next.ok);
if (!next.ok) throw new Error('Second snapshot must prepare');
const fresh = resolveWorkspaceEntryCompilationFromSnapshot(next.value, { packageName: 'dragon', entryName: 'main' });
assert.ok(fresh.ok);
if (fresh.ok) {
  assert.notEqual(fresh.value.closure.root.unit, main.value.closure.root.unit,
    'A new invocation must not inherit the previous parser cache.');
  assert.deepEqual(fresh.value.build, main.value.build);
}
const bounded = prepareCompilationSnapshot(workspace, { limits: { maxFiles: 1 } });
assert.equal(bounded.ok, false, 'An earlier successful snapshot must not bypass a tighter resource limit.');
console.log('workspace parser snapshot shares modules only within one validated invocation');
