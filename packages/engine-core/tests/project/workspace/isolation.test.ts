import assert from 'node:assert/strict';

import {
  resolveWorkspaceEntryCompilation,
  validateWorkspaceEntries,
} from '../../../src/project/workspace/graph';
import { workspaceFixture } from './fixtures';

const malformed = 'ashfox 1\nmodel broken {';
const fixture = (unusedSource = malformed) =>
  workspaceFixture(
    [
      { path: 'dragon/main.ashfox', source: 'ashfox 1\nmodel main {}' },
      { path: 'dragon/other.ashfox', source: malformed },
      { path: 'dragon/unused.ashfox', source: unusedSource },
    ],
    {
      entries: [
        { name: 'main', path: 'main.ashfox' },
        { name: 'other', path: 'other.ashfox' },
      ],
      modules: [{ subpath: './unused', path: 'unused.ashfox' }],
    },
  );

const selected = resolveWorkspaceEntryCompilation(fixture(), {
  packageName: 'dragon',
  entryName: 'main',
});
assert.equal(
  selected.ok,
  true,
  selected.ok ? '' : selected.diagnostics.map((item) => item.code).join(', '),
);
if (!selected.ok) throw new Error('valid selected entry was rejected by an unrelated source');
assert.deepEqual(
  selected.value.closure.files.map((file) => file.identity.path),
  ['dragon/main.ashfox'],
);

const malformedEntry = resolveWorkspaceEntryCompilation(fixture(), {
  packageName: 'dragon',
  entryName: 'other',
});
assert.equal(malformedEntry.ok, false);
if (!malformedEntry.ok) {
  assert.equal(malformedEntry.diagnostics.length, 1);
  assert.equal(malformedEntry.diagnostics[0]?.source?.path, 'dragon/other.ashfox');
}

const wholeDiagnostics = validateWorkspaceEntries(fixture());
assert.ok(wholeDiagnostics.some((item) => item.source?.path === 'dragon/other.ashfox'));
const unusedDiagnostics = wholeDiagnostics.filter(
  (item) => item.source?.path === 'dragon/unused.ashfox',
);
assert.equal(
  unusedDiagnostics.length,
  1,
  'whole validation must parse an unused malformed module once',
);

const baseline = resolveWorkspaceEntryCompilation(fixture(), {
  packageName: 'dragon',
  entryName: 'main',
});
const changed = resolveWorkspaceEntryCompilation(
  fixture(`${malformed}\n// unrelated source bytes`),
  { packageName: 'dragon', entryName: 'main' },
);
assert.equal(baseline.ok, true);
assert.equal(changed.ok, true);
if (baseline.ok && changed.ok) {
  assert.equal(changed.value.build.buildKey, baseline.value.build.buildKey);
  assert.equal(changed.value.closure.build.buildKey, baseline.value.closure.build.buildKey);
}

console.log('workspace selected-entry isolation and whole-validation checks ok');
