import assert from 'node:assert/strict';

import { effectivelyVisibleSceneNodeIds, isSceneNodeEffectivelyVisible } from '../../src';
import { createSceneProject } from '../helpers';

{
  const project = createSceneProject();
  project.scene.nodes['bone-root'].visible = false;
  assert.equal(isSceneNodeEffectivelyVisible(project, 'cube-body'), false);
  assert.deepEqual([...effectivelyVisibleSceneNodeIds(project)], []);
}

{
  const project = structuredClone(createSceneProject());
  const root = project.scene.nodes['bone-root'];
  const cube = project.scene.nodes['cube-body'];
  if (root.kind !== 'bone' || cube.kind !== 'cube') {
    throw new Error('visibility fixture nodes missing');
  }
  project.scene = {
    ...project.scene,
    nodes: {
      ...project.scene.nodes,
      'bone-hidden': {
        ...root,
        id: 'bone-hidden',
        name: 'hidden',
        parentId: 'bone-root',
        visible: false,
      },
      'cube-body': {
        ...cube,
        parentId: 'bone-hidden',
        visible: true,
      },
    },
  };
  assert.deepEqual([...effectivelyVisibleSceneNodeIds(project)].sort(), ['bone-root']);
}

{
  const project = structuredClone(createSceneProject());
  const root = project.scene.nodes['bone-root'];
  const cube = project.scene.nodes['cube-body'];
  if (root.kind !== 'bone' || cube.kind !== 'cube') {
    throw new Error('visibility fixture nodes missing');
  }
  project.scene = {
    ...project.scene,
    roots: [],
    nodes: {
      'bone-root': {
        ...root,
        parentId: 'cube-body',
      },
      'cube-body': {
        ...cube,
        parentId: 'bone-root',
      },
    },
  };
  assert.deepEqual([...effectivelyVisibleSceneNodeIds(project)], []);
  assert.equal(isSceneNodeEffectivelyVisible(project, 'missing-node'), false);
}
