import assert from 'node:assert/strict';

import { resolveAnimationTimePolicy } from '../../src/domain/animation/timePolicy';
import { ProjectSession, type SessionState } from '../../src/session';
import { applySessionMutation, type SessionMutation } from '../../src/session/stateReducer';

const bonePivot: [number, number, number] = [1, 2, 3];
const faceUv: [number, number, number, number] = [0, 0, 8, 8];
const meshPosition: [number, number, number] = [0, 1, 2];
const meshFaceUv: [number, number] = [4, 5];
const channelValue: [number, number, number] = [10, 20, 30];
const triggerList = ['alpha', 'beta'];
const triggerNested = { count: 1 };
const triggerRecord: Record<string, unknown> = {
  names: triggerList,
  nested: triggerNested,
};

const attachedState: SessionState = {
  id: 'isolation-project',
  format: 'geckolib',
  formatId: 'geckolib_model',
  name: 'isolated',
  bones: [{ name: 'root', pivot: bonePivot }],
  cubes: [
    {
      name: 'body',
      bone: 'root',
      from: [0, 0, 0],
      to: [8, 8, 8],
      faces: {
        north: { enabled: true, uv: faceUv },
      },
    },
  ],
  meshes: [
    {
      name: 'fin',
      vertices: [{ id: 'v0', pos: meshPosition }],
      faces: [
        {
          id: 'f0',
          vertices: ['v0'],
          uv: [{ vertexId: 'v0', uv: meshFaceUv }],
        },
      ],
    },
  ],
  textures: [{ name: 'skin', width: 16, height: 16 }],
  animations: [
    {
      name: 'idle',
      length: 1,
      loop: true,
      channels: [
        {
          bone: 'root',
          channel: 'rot',
          keys: [{ time: 0, value: channelValue }],
        },
      ],
      triggers: [
        {
          type: 'timeline',
          keys: [{ time: 0, value: triggerRecord }],
        },
      ],
    },
  ],
  animationTimePolicy: resolveAnimationTimePolicy(),
};

const session = new ProjectSession();
assert.equal(session.attach(attachedState).ok, true);

bonePivot[0] = 99;
faceUv[0] = 99;
meshPosition[0] = 99;
meshFaceUv[0] = 99;
channelValue[0] = 99;
triggerList[0] = 'mutated';
triggerNested.count = 99;

const afterInputMutation = session.snapshot();
assert.equal(afterInputMutation.bones[0].pivot[0], 1);
assert.equal(afterInputMutation.cubes[0].faces?.north?.uv?.[0], 0);
assert.equal(afterInputMutation.meshes?.[0].vertices[0].pos[0], 0);
assert.equal(afterInputMutation.meshes?.[0].faces[0].uv?.[0].uv[0], 4);
assert.equal(afterInputMutation.animations[0].channels?.[0].keys[0].value[0], 10);
assert.deepEqual(afterInputMutation.animations[0].triggers?.[0].keys[0].value, {
  names: ['alpha', 'beta'],
  nested: { count: 1 },
});

afterInputMutation.bones[0].pivot[0] = 77;
const northFaceUv = afterInputMutation.cubes[0].faces?.north?.uv;
if (northFaceUv) northFaceUv[0] = 77;
const returnedMesh = afterInputMutation.meshes?.[0];
if (returnedMesh) {
  returnedMesh.vertices[0].pos[0] = 77;
  const returnedFaceUv = returnedMesh.faces[0].uv?.[0].uv;
  if (returnedFaceUv) returnedFaceUv[0] = 77;
}
const returnedChannel = afterInputMutation.animations[0].channels?.[0];
if (returnedChannel) returnedChannel.keys[0].value[0] = 77;

const deterministicSnapshot = session.snapshot();
assert.equal(deterministicSnapshot.bones[0].pivot[0], 1);
assert.equal(deterministicSnapshot.cubes[0].faces?.north?.uv?.[0], 0);
assert.equal(deterministicSnapshot.meshes?.[0].vertices[0].pos[0], 0);
assert.equal(deterministicSnapshot.meshes?.[0].faces[0].uv?.[0].uv[0], 4);
assert.equal(deterministicSnapshot.animations[0].channels?.[0].keys[0].value[0], 10);
assert.notEqual(deterministicSnapshot.bones, afterInputMutation.bones);
assert.notEqual(deterministicSnapshot.bones[0], afterInputMutation.bones[0]);
assert.deepEqual(session.snapshot(), deterministicSnapshot);

const addedPivot: [number, number, number] = [3, 2, 1];
session.addBone({ name: 'added', pivot: addedPivot });
addedPivot[0] = 88;
assert.equal(session.snapshot().bones.find((bone) => bone.name === 'added')?.pivot[0], 3);

const updatedPosition: [number, number, number] = [5, 6, 7];
const updatedFaceUv: [number, number] = [6, 7];
const updatedVertices = [{ id: 'v1', pos: updatedPosition }];
const updatedFaces = [
  {
    id: 'f1',
    vertices: ['v1'],
    uv: [{ vertexId: 'v1', uv: updatedFaceUv }],
  },
];
assert.equal(
  session.updateMesh('fin', {
    vertices: updatedVertices,
    faces: updatedFaces,
  }),
  true,
);
updatedVertices[0].pos[0] = 88;
updatedFaces[0].vertices[0] = 'mutated';
updatedFaces[0].uv[0].uv[0] = 88;

const afterUpdateMutation = session.snapshot().meshes?.[0];
assert.equal(afterUpdateMutation?.vertices[0].pos[0], 5);
assert.equal(afterUpdateMutation?.faces[0].vertices[0], 'v1');
assert.equal(afterUpdateMutation?.faces[0].uv?.[0].uv[0], 6);

const queuedState = session.snapshot();
const mutationQueue: readonly SessionMutation[] = [
  {
    type: 'add_bone',
    bone: { name: 'queued', pivot: [0, 0, 0] },
  },
  {
    type: 'update_bone',
    name: 'queued',
    updates: { visibility: false },
  },
];
for (const mutation of mutationQueue) {
  applySessionMutation(queuedState, mutation);
}
assert.equal(queuedState.bones.find((bone) => bone.name === 'queued')?.visibility, false);
