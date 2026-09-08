import assert from 'node:assert/strict';

import { createWorkbenchProject } from '../fixtures/project';
import {
  resolveActiveClipId,
  resolveSelectedNodeId,
  synchronizeActiveClipId
} from '../../src/features/workbench/state/workbenchSelection';

const document = createWorkbenchProject().document;
const firstRoot = document.scene.roots[0];
const firstClip = Object.keys(document.animations)[0];

assert.equal(resolveSelectedNodeId(document, firstRoot), firstRoot);
assert.equal(resolveSelectedNodeId(document, 'missing-node'), firstRoot);
assert.equal(resolveSelectedNodeId(document, null), null);
assert.equal(resolveActiveClipId(document, firstClip), firstClip);
assert.equal(resolveActiveClipId(document, 'missing-clip'), firstClip);
assert.equal(
  resolveActiveClipId(document, null),
  null,
  'an explicit no-clip presentation must not silently select an animation'
);
assert.equal(
  synchronizeActiveClipId(document, null, false),
  null,
  'an explicit no-clip state must remain at the rest pose'
);
assert.equal(
  synchronizeActiveClipId(document, null, true),
  firstClip,
  'a newly loaded document selects its first clip'
);
assert.equal(
  synchronizeActiveClipId(document, firstClip, true),
  firstClip,
  'a project change must select the first clip'
);
assert.equal(
  synchronizeActiveClipId(document, 'missing-clip', false),
  firstClip,
  'a deleted clip must fall back to the first clip'
);

const emptyDocument = {
  ...document,
  scene: {
    roots: [],
    nodes: {}
  },
  animations: {}
};
assert.equal(resolveSelectedNodeId(emptyDocument, null), null);
assert.equal(resolveActiveClipId(emptyDocument, null), null);
assert.equal(synchronizeActiveClipId(emptyDocument, firstClip, true), null);
