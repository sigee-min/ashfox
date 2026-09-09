import assert from 'node:assert/strict';

import {
  createWorkbenchProject
} from '../fixtures/project';
import {
  resolveBuildReviewClip
} from '@ashfox/render-core/capture/buildReviewClip';

const document = structuredClone(createWorkbenchProject().document);
const source = {
  id: 'source',
  name: 'Source',
  durationSeconds: 1,
  fps: 20,
  loop: 'loop' as const,
  channels: {
    rotation: {
      id: 'rotation',
      targetNodeId: document.scene.roots[0]!,
      property: 'rotation' as const,
      keys: [{
        id: 'rotation-0',
        timeSeconds: 0,
        value: [0, 0, 0] as const,
        interpolation: 'linear' as const
      }]
    }
  },
  triggers: {}
};

document.animations = {
  'clip-secondary': {
    ...structuredClone(source),
    id: 'clip-secondary',
    name: 'walk'
  },
  'clip-idle-hash': {
    ...structuredClone(source),
    id: 'clip-idle-hash',
    name: 'idle'
  }
};
assert.equal(
  resolveBuildReviewClip(document)?.id,
  'clip-idle-hash',
  'build replay selects the canonical authored idle name, not an internal ID'
);

document.animations = {
  ...document.animations,
  'clip-idle-hash': {
    ...document.animations['clip-idle-hash'],
    startDelay: {
      kind: 'molang',
      source: 'query.life_time'
    }
  }
};
assert.equal(
  resolveBuildReviewClip(document),
  null,
  'an unfaithful preferred clip must fail closed instead of partially rendering or substituting another clip'
);

document.animations = {
  'clip-idle-hash': {
    ...structuredClone(source),
    id: 'clip-idle-hash',
    name: 'idle',
    channels: {}
  }
};
assert.equal(
  resolveBuildReviewClip(document),
  null,
  'an empty review clip must leave the build capture in its rest pose'
);
