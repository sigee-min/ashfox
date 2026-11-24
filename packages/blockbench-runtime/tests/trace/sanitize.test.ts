import assert from 'node:assert/strict';

import {
  isProjectDiffContract,
  isProjectStateContract,
} from '@ashfox/blockbench-contracts/types/project/contract';
import { FINITE_JSON_CONTRACT_MAX_CONTAINERS } from '@ashfox/internal-contracts';
import { normalizeTraceContractValue, sanitizeTraceValue } from '../../src/trace/format';

const nestedTriggerValue = (depth: number): Record<string, unknown> => {
  let value: Record<string, unknown> = {};
  for (let index = 0; index < depth; index += 1) {
    value = { child: value };
  }
  return value;
};

// Bounded array sanitization reads only length and the first MAX_ARRAY slots.
{
  let descriptorReads = 0;
  let propertyReads = 0;
  let ownKeysReads = 0;
  const target = new Array(10_000);
  target[0] = 'first';
  target[49] = 'last-inspected';
  target[50] = 'must-not-be-inspected';
  const source = new Proxy(target, {
    get: (inner, key, receiver) => {
      propertyReads += 1;
      return Reflect.get(inner, key, receiver);
    },
    getOwnPropertyDescriptor: (inner, key) => {
      descriptorReads += 1;
      return Reflect.getOwnPropertyDescriptor(inner, key);
    },
    ownKeys: (inner) => {
      ownKeysReads += 1;
      return Reflect.ownKeys(inner);
    },
  });

  const sanitized = sanitizeTraceValue(source) as unknown[];
  assert.equal(propertyReads, 0);
  assert.equal(ownKeysReads, 0);
  assert.equal(descriptorReads, 51);
  assert.equal(sanitized.length, 51);
  assert.equal(sanitized[0], 'first');
  assert.equal(sanitized[1], null);
  assert.equal(sanitized[49], 'last-inspected');
  assert.equal(sanitized[50], '[truncated]');
}

// Accessors are represented without invocation, including redacted accessors.
{
  let getterCalls = 0;
  const source: Record<string, unknown> = {};
  Object.defineProperty(source, 'secret', {
    enumerable: true,
    get: () => {
      getterCalls += 1;
      throw new Error('trace sanitizer must not invoke accessors');
    },
  });
  Object.defineProperty(source, 'image', {
    enumerable: true,
    get: () => {
      getterCalls += 1;
      throw new Error('redaction must not invoke accessors');
    },
  });

  assert.deepEqual(sanitizeTraceValue(source), {
    secret: '[accessor]',
    image: '<redacted>',
  });
  assert.deepEqual(normalizeTraceContractValue(source), {
    secret: null,
    image: '<redacted>',
  });
  assert.equal(getterCalls, 0);
}

// Reflection failures are total and deterministic in both sanitizer modes.
{
  const reflected = new Proxy(
    {},
    {
      ownKeys: () => {
        throw new Error('hostile ownKeys');
      },
    },
  );
  assert.equal(sanitizeTraceValue(reflected), '[unavailable]');
  assert.equal(normalizeTraceContractValue(reflected), null);

  const revocable = Proxy.revocable({}, {});
  revocable.revoke();
  assert.equal(sanitizeTraceValue(revocable.proxy), '[unavailable]');
  assert.equal(normalizeTraceContractValue(revocable.proxy), null);
}

// A shared-alias DAG consumes one aggregate budget and cannot expand fully.
{
  let containerReads = 0;
  let descriptorReads = 0;
  let propertyReads = 0;
  const observe = <T extends Record<string, unknown>>(target: T): T =>
    new Proxy(target, {
      get: (inner, key, receiver) => {
        propertyReads += 1;
        return Reflect.get(inner, key, receiver);
      },
      getOwnPropertyDescriptor: (inner, key) => {
        descriptorReads += 1;
        return Reflect.getOwnPropertyDescriptor(inner, key);
      },
      ownKeys: (inner) => {
        containerReads += 1;
        return Reflect.ownKeys(inner);
      },
    });

  let shared: Record<string, unknown> = observe({ leaf: true });
  for (let depth = 0; depth < 20; depth += 1) {
    shared = observe({ left: shared, right: shared });
  }

  assert.equal(normalizeTraceContractValue(shared), null);
  assert.equal(propertyReads, 0);
  assert.ok(containerReads <= FINITE_JSON_CONTRACT_MAX_CONTAINERS);
  assert.ok(descriptorReads <= FINITE_JSON_CONTRACT_MAX_CONTAINERS * 2);
}

// Full normalization accepts the maximum runtime cube cardinality. Primitive
// fields and descriptors must not consume the finite container authority.
{
  const faces = () => ({
    north: { enabled: true, uv: [0, 0, 16, 16] },
    south: { enabled: true, uv: [0, 0, 16, 16] },
    east: { enabled: true, uv: [0, 0, 16, 16] },
    west: { enabled: true, uv: [0, 0, 16, 16] },
    up: { enabled: true, uv: [0, 0, 16, 16] },
    down: { enabled: true, uv: [0, 0, 16, 16] },
  });
  const cubes = Array.from({ length: 2048 }, (_entry, index) => ({
    name: `cube-${index}`,
    from: [0, 0, 0],
    to: [16, 16, 16],
    bone: 'root',
    faces: faces(),
  }));
  const state = {
    id: 'max-cube-state',
    active: true,
    name: null,
    format: null,
    revision: 'r1',
    counts: {
      bones: 0,
      cubes: cubes.length,
      textures: 0,
      animations: 0,
    },
    cubes,
  };

  assert.equal(isProjectStateContract(state), true);
  const normalized = normalizeTraceContractValue(state);
  assert.equal(isProjectStateContract(normalized), true);
  assert.deepEqual(normalized, state);
}

// The full formatter preserves finite trigger values at the v1 depth limit.
{
  const state = {
    id: 'p1',
    active: true,
    name: null,
    format: null,
    revision: 'r1',
    counts: {
      bones: 0,
      cubes: 0,
      textures: 0,
      animations: 1,
    },
    animations: [
      {
        name: 'timeline',
        length: 1,
        loop: false,
        triggers: [
          {
            type: 'timeline' as const,
            keys: [{ time: 0, value: nestedTriggerValue(64) }],
          },
        ],
      },
    ],
  };
  assert.equal(isProjectStateContract(state), true);
  const normalizedState = normalizeTraceContractValue(state);
  assert.equal(isProjectStateContract(normalizedState), true);
  assert.deepEqual(normalizedState, state);

  const zero = { added: 0, removed: 0, changed: 0 };
  const diff = {
    sinceRevision: 'r0',
    currentRevision: 'r1',
    counts: {
      bones: zero,
      cubes: zero,
      textures: zero,
      animations: { added: 0, removed: 0, changed: 1 },
    },
    animations: {
      added: [],
      removed: [],
      changed: [
        {
          key: 'timeline',
          before: {
            name: 'timeline',
            length: 1,
            loop: false,
            triggers: [
              {
                type: 'timeline' as const,
                keys: [{ time: 0, value: nestedTriggerValue(64) }],
              },
            ],
          },
          after: { name: 'timeline', length: 1, loop: false },
        },
      ],
    },
  };
  assert.equal(isProjectDiffContract(diff), true);
  const normalizedDiff = normalizeTraceContractValue(diff);
  assert.equal(isProjectDiffContract(normalizedDiff), true);
  assert.deepEqual(normalizedDiff, diff);
}
