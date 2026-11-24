import assert from 'node:assert/strict';

import {
  analyzeAnimationPreview,
  animationPreviewIssues,
  sampleComposedNumericTransformChannel,
  sampleNumericTransformChannel,
  type AnimationClip,
  type TransformChannel,
} from '../../src';

const assertVectorClose = (
  actual: readonly number[] | null,
  expected: readonly number[],
  message: string,
): void => {
  assert.ok(actual, message);
  expected.forEach((value, index) => {
    assert.ok(
      Math.abs((actual?.[index] ?? Number.NaN) - value) < 0.000001,
      `${message}: component ${index}`,
    );
  });
};

const channel = (interpolation: 'linear' | 'step' | 'catmullrom'): TransformChannel => ({
  id: `channel-${interpolation}`,
  targetNodeId: 'bone-body',
  property: 'rotation',
  keys: [
    {
      id: 'start',
      timeSeconds: 0,
      value: [0, 0, 0],
      interpolation,
    },
    {
      id: 'middle',
      timeSeconds: 1,
      value: [1, 0, 0],
      interpolation,
    },
    {
      id: 'end',
      timeSeconds: 2,
      value: [0, 0, 0],
      interpolation,
    },
  ],
});

assert.deepEqual(sampleNumericTransformChannel(channel('linear'), 0.5), [0.5, 0, 0]);
assert.deepEqual(sampleNumericTransformChannel(channel('step'), 0.5), [0, 0, 0]);
assert.deepEqual(
  sampleNumericTransformChannel(channel('catmullrom'), 0.5),
  [0.5625, 0, 0],
  'viewport and baked glTF must share one Catmull-Rom evaluator',
);

const delayed: TransformChannel = {
  ...channel('linear'),
  keys: [
    {
      id: 'delayed',
      timeSeconds: 1,
      value: [10, 0, 0],
      interpolation: 'linear',
    },
  ],
};
assert.deepEqual(
  sampleNumericTransformChannel(delayed, 0.5),
  [5, 0, 0],
  'a delayed numeric key must interpolate from the rest pose like glTF',
);

const unsupported: TransformChannel = {
  ...channel('linear'),
  rotationSpace: 'entity',
  keys: [
    {
      id: 'expression',
      timeSeconds: 0,
      value: [{ kind: 'molang', source: 'query.life_time' }, 0, 0],
      interpolation: 'linear',
      preValue: [0, 0, 0],
      easing: { type: 'easeInQuad' },
    },
  ],
};
assert.deepEqual(
  animationPreviewIssues(unsupported).map((issue) => issue.code),
  ['entity_rotation', 'molang', 'easing', 'split_value'],
);
assert.equal(sampleNumericTransformChannel(unsupported, 0), null);

const constantChannel = (
  id: string,
  property: TransformChannel['property'],
  value: readonly [number, number, number],
): TransformChannel => ({
  id,
  targetNodeId: 'bone-body',
  property,
  keys: [
    {
      id: `${id}-key`,
      timeSeconds: 0,
      value,
      interpolation: 'linear',
    },
  ],
});

assert.deepEqual(
  sampleComposedNumericTransformChannel(constantChannel('position', 'position', [1, 2, 3]), 0, {
    restValue: [4, 8, 12],
    translationScale: 0.5,
  }),
  [4.5, 9, 13.5],
  'translation must add a unit-scaled animation delta to the rest pose',
);
assert.deepEqual(
  sampleComposedNumericTransformChannel(constantChannel('scale', 'scale', [1.5, 0.5, 2]), 0, {
    restValue: [2, 3, 4],
  }),
  [3, 1.5, 8],
  'scale animation must multiply the non-identity rest scale',
);
assertVectorClose(
  sampleComposedNumericTransformChannel(constantChannel('rotation', 'rotation', [4, 5, 6]), 0, {
    restValue: [10, 20, 30],
  }),
  [11.061422211817163, 26.325230793564007, 35.7565656181796],
  'rotation must compose rest and animation quaternions before Euler XYZ output',
);

const unsupportedClip: AnimationClip = {
  id: 'clip-unsupported-preview',
  name: 'Idle',
  durationSeconds: 1,
  fps: 20,
  loop: 'loop',
  startDelay: { kind: 'molang', source: '0.1' },
  loopDelay: { kind: 'molang', source: '0.2' },
  animationTimeUpdate: {
    kind: 'molang',
    source: 'query.anim_time',
  },
  blendWeight: 0.5,
  overridePreviousAnimation: true,
  channels: { [unsupported.id]: unsupported },
  triggers: {
    'trigger-particle': {
      id: 'trigger-particle',
      type: 'particle',
      keys: [
        {
          id: 'particle-key',
          timeSeconds: 0.25,
          value: { effect: 'ashfox:test' },
        },
      ],
    },
    'trigger-sound': {
      id: 'trigger-sound',
      type: 'sound',
      keys: [
        {
          id: 'sound-key',
          timeSeconds: 0.25,
          value: { effect: 'ashfox:test' },
        },
      ],
    },
    'trigger-timeline': {
      id: 'trigger-timeline',
      type: 'timeline',
      keys: [
        {
          id: 'timeline-key',
          timeSeconds: 0.25,
          value: 'variable.test = 1;',
        },
      ],
    },
  },
};
assert.deepEqual(
  analyzeAnimationPreview(unsupportedClip).map((issue) => issue.code),
  [
    'entity_rotation',
    'molang',
    'easing',
    'split_value',
    'start_delay',
    'loop_delay',
    'animation_time_update',
    'blend_weight',
    'override_previous_animation',
    'particle_trigger',
    'sound_trigger',
    'timeline_trigger',
  ],
  'the clip analyzer must disclose every semantic omitted by live preview',
);
