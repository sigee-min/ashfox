import assert from 'node:assert/strict';

import type {
  ProjectDocument,
  SceneNode
} from '@ashfox/engine-core';
import { effectivelyVisibleSceneNodeIds } from '@ashfox/engine-core';

import {
  createBuildCapturePlan,
  MAX_BUILD_CAPTURE_FRAMES
} from '@ashfox/render-core/capture/buildCaptureTimeline';
import { createWorkbenchProject } from '../fixtures/project';

const document = createWorkbenchProject().document;
const effectivelyVisible = effectivelyVisibleSceneNodeIds(document);
const renderables = Object.values(document.scene.nodes).filter(
  (node): node is Extract<SceneNode, { kind: 'cube' | 'plane' }> =>
    effectivelyVisible.has(node.id) &&
    (node.kind === 'cube' || node.kind === 'plane')
);
const textured = renderables.filter((node) =>
  Object.values(node.faces).some(
    (face) => face.enabled && face.textureId !== null
  )
);
const plan = createBuildCapturePlan(document);

assert.deepEqual(
  plan.events.filter((event) => event.category === 'geometry')
    .map((event) => event.nodeId),
  renderables.map((node) => node.id),
  'geometry must replay every visible element in canonical insertion order'
);
assert.deepEqual(
  plan.events.filter((event) => event.category === 'texture')
    .map((event) => event.nodeId),
  textured.map((node) => node.id),
  'texture must be applied once per owning visible element'
);
assert.equal(
  new Set(plan.events.map((event) => event.id)).size,
  plan.events.length,
  'replay event IDs must be unique'
);
assert.equal(plan.events[0]?.category, 'start');
assert.equal(plan.events.at(-1)?.category, 'complete');
assert.equal(
  plan.events.filter((event) => event.category === 'motion').length,
  Object.keys(document.animations).length === 0 ? 0 : 1
);
assert.equal(
  plan.frames.length,
  plan.events.reduce((total, event) => total + event.holdFrames, 0)
);
assert.equal(Object.isFrozen(plan.events), true);
assert.equal(Object.isFrozen(plan.frames), true);
assert.equal(Object.isFrozen(plan), true);
assert.equal(plan.events.every(Object.isFrozen), true);
assert.equal(plan.frames.every(Object.isFrozen), true);
assert.equal(plan.frames[0]?.progress, 0);
assert.equal(plan.frames.at(-1)?.progress, 1);
assert.equal(
  plan.frames.every((frame, index) =>
    index === 0 || frame.progress > (plan.frames[index - 1]?.progress ?? -1)
  ),
  true,
  'frame progress must be strictly monotonic'
);
assert.ok(plan.frames.length <= MAX_BUILD_CAPTURE_FRAMES);

const otherRevision = {
  ...document,
  revision: 'unrelated-revision'
};
assert.deepEqual(
  createBuildCapturePlan(otherRevision).events,
  plan.events,
  'revision labels must not change the source build replay'
);

const empty: ProjectDocument = {
  ...document,
  scene: { roots: [], nodes: {} }
};
assert.throws(
  () => createBuildCapturePlan(empty),
  /requires visible model geometry/
);

const sourceNode = renderables.find(
  (node): node is Extract<SceneNode, { kind: 'cube' }> =>
    node.kind === 'cube'
);
if (!sourceNode) throw new Error('Fixture requires a renderable cube.');
const sourceBone = Object.values(document.scene.nodes).find(
  (node): node is Extract<SceneNode, { kind: 'bone' }> =>
    node.kind === 'bone'
);
if (!sourceBone) throw new Error('Fixture requires a bone.');
const hiddenParent: Extract<SceneNode, { kind: 'bone' }> = {
  ...structuredClone(sourceBone),
  id: 'hidden_parent',
  name: 'hidden_parent',
  parentId: null,
  visible: false
};
const hiddenChild: typeof sourceNode = {
  ...structuredClone(sourceNode),
  id: 'hidden_child',
  name: 'hidden_child',
  parentId: hiddenParent.id,
  visible: true
};
const hiddenByAncestor: ProjectDocument = {
  ...document,
  scene: {
    roots: [hiddenParent.id],
    nodes: {
      [hiddenParent.id]: hiddenParent,
      [hiddenChild.id]: hiddenChild
    }
  },
  animations: {}
};
assert.throws(
  () => createBuildCapturePlan(hiddenByAncestor),
  /requires visible model geometry/,
  'geometry hidden by an ancestor must never produce an invisible replay step'
);

const withFaceTextures = (
  node: typeof sourceNode,
  textureIds: readonly string[]
): typeof sourceNode => {
  let enabledIndex = 0;
  const faces = Object.fromEntries(
    Object.entries(node.faces).map(([direction, face]) => {
      const textureId = face.enabled && textureIds.length > 0
        ? textureIds[enabledIndex % textureIds.length] ?? null
        : null;
      if (face.enabled) enabledIndex += 1;
      return [direction, { ...face, textureId }];
    })
  ) as typeof node.faces;
  return { ...structuredClone(node), faces };
};
const untexturedNode: typeof sourceNode = {
  ...withFaceTextures(sourceNode, []),
  id: 'untextured',
  name: 'untextured',
  parentId: null
};
const multiTextureNode: typeof sourceNode = {
  ...withFaceTextures(sourceNode, ['base', 'accent']),
  id: 'multi_texture',
  name: 'multi_texture',
  parentId: null
};
const base = Object.values(document.textures)[0];
if (!base) throw new Error('Fixture requires a texture.');
const mixedMaterials: ProjectDocument = {
  ...document,
  scene: {
    roots: [untexturedNode.id, multiTextureNode.id],
    nodes: {
      [untexturedNode.id]: untexturedNode,
      [multiTextureNode.id]: multiTextureNode
    }
  },
  textures: {
    base: { ...base, id: 'base', name: 'base' },
    accent: { ...base, id: 'accent', name: 'accent' }
  },
  animations: {}
};
const mixedPlan = createBuildCapturePlan(mixedMaterials);
assert.deepEqual(
  mixedPlan.events.filter((event) => event.category === 'texture')
    .map((event) => event.nodeId),
  ['multi_texture'],
  'all materials on one element must be applied atomically in one texture step'
);
assert.deepEqual(
  mixedPlan.events.map((event) => event.category),
  ['start', 'geometry', 'geometry', 'texture', 'complete'],
  'untextured geometry must remain in the replay without a phantom texture step'
);

const crowded = (count: number): ProjectDocument => {
  const crowdedNodes: Record<string, SceneNode> = {};
  for (let index = 0; index < count; index += 1) {
    const id = `crowded_${String(index).padStart(3, '0')}`;
    crowdedNodes[id] = {
      ...structuredClone(untexturedNode),
      id,
      name: id,
      parentId: null
    };
  }
  return {
    ...document,
    scene: {
      roots: Object.keys(crowdedNodes),
      nodes: crowdedNodes
    },
    textures: {},
    animations: {}
  };
};
assert.equal(
  createBuildCapturePlan(crowded(280)).frames.length,
  MAX_BUILD_CAPTURE_FRAMES,
  'the exact frame limit must remain valid'
);
assert.throws(
  () => createBuildCapturePlan(crowded(281)),
  /exact limit/,
  'one frame beyond the exact limit must fail without truncating the replay'
);
