import assert from 'node:assert/strict';

import {
  createBlankWorkbenchProject
} from '../../src/features/workbench/newProject';
import {
  INITIAL_WORKBENCH_PROJECT_ID
} from '../../src/application/projectIdentity';

const blank = createBlankWorkbenchProject('2026-07-29T00:00:00.000Z');
assert.equal(blank.id, INITIAL_WORKBENCH_PROJECT_ID);
assert.equal(blank.revision, blank.document.revision);
assert.equal(blank.entry.packageName, 'workbench');
assert.equal(blank.entry.entryName, 'workbench');
assert.match(blank.build.workspaceHash, /^sha256:[a-f0-9]{64}$/u);
assert.ok(blank.document.scene.roots.length > 0);
assert.ok(Object.keys(blank.document.textures).length > 0);
assert.ok(Object.values(blank.document.animations).some(
  (clip) => clip.name === 'idle'
));
assert.equal(Object.isFrozen(blank), true);
