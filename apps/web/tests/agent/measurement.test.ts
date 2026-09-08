import assert from 'node:assert/strict';
import { IDENTITY_TRANSFORM, validateProjectDocument, type CubeNode } from '@ashfox/engine-core';
import { inspectProject } from '../../src/features/agent/inspect';
import { parseInspectRequest } from '../../src/features/agent/parseInspectRequest';
import { createWorkbenchProject } from '../fixtures/project';

const project = createWorkbenchProject();
const report = validateProjectDocument(project.document);
const request = { kind: 'measurement' as const, expectedRevision: project.revision,
  expectedWorkspaceHash: project.build.workspaceHash, expectedBuildKey: project.build.buildKey,
  nodeId: 'missing', scope: 'subtree' as const, groundY: 0, tolerance: 0.001 };
assert.equal(parseInspectRequest(request).ok, true);
for (const invalid of [{ ...request, extra: true }, { ...request, groundY: Infinity },
  { ...request, tolerance: -1 }, { ...request, expectedRevision: '' },
  { ...request, expectedBuildKey: 'unversioned' }, { ...request, scope: 'animated' }]) {
  assert.equal(parseInspectRequest(invalid).ok, false);
}
for (const key of ['expectedRevision', 'expectedWorkspaceHash', 'expectedBuildKey'] as const) {
  const result = inspectProject(project, null, report, { ...request, [key]: 'stale' });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, 'stale_revision');
}
const missing = inspectProject(project, null, report, request);
assert.equal(missing.ok, false);
if (!missing.ok) assert.equal(missing.error.code, 'not_found');
const surface = { kind: 'surface' as const, nodeId: 'missing',
  expectedRevision: project.revision, expectedWorkspaceHash: project.build.workspaceHash,
  expectedBuildKey: project.build.buildKey };
assert.equal(parseInspectRequest(surface).ok, true);
assert.equal(parseInspectRequest({ ...surface, groundY: 0 }).ok, false);
assert.equal(inspectProject(project, null, report, surface).ok, false);
const face = { enabled: true, textureId: null };
const cube: CubeNode = { id: 'cube', name: 'cube', kind: 'cube', geometryMode: 'axis-box',
  parentId: null, visible: true, transform: { ...IDENTITY_TRANSFORM },
  bounds: { from: [0, 2, 0], to: [2, 4, 6] }, inflate: 0, mirror: false, boxUv: false,
  faces: { north: face, south: face, east: face, west: face, up: face, down: face } };
const populated = { ...project, document: { ...project.document,
  scene: { roots: ['cube'], nodes: { cube } } } };
const before = JSON.stringify(populated);
const measured = inspectProject(populated, null, report, { ...request, nodeId: 'cube' });
assert.ok(measured.ok);
if (measured.ok) {
  const data = measured.data as { build: { buildKey: string }; evidence: { ground: { signedGap: number } } };
  assert.equal(data.build.buildKey, project.build.buildKey);
  assert.equal(data.evidence.ground.signedGap, 2);
}
assert.equal(inspectProject(populated, null, report, { ...surface, nodeId: 'cube' }).ok, true);
assert.equal(JSON.stringify(populated), before, 'measurement cannot mutate the project');
const inventory = { kind: 'nodes' as const, expectedRevision: project.revision,
  expectedWorkspaceHash: project.build.workspaceHash, expectedBuildKey: project.build.buildKey,
  offset: 0, limit: 1 };
assert.equal(parseInspectRequest(inventory).ok, true);
for (const bad of [{ ...inventory, limit: 33 }, { ...inventory, offset: -1 },
  { ...inventory, nodeId: 'cube' }]) assert.equal(parseInspectRequest(bad).ok, false);
const listed = inspectProject(populated, null, report, inventory);
assert.ok(listed.ok);
if (listed.ok) assert.deepEqual((listed.data as { evidence: unknown }).evidence, {
  nodes: [{ id: 'cube', name: 'cube', kind: 'cube', parentId: null, visible: true }],
  total: 1, offset: 0, nextOffset: null
});
assert.equal(inspectProject(populated, null, report, { ...inventory, offset: 2 }).ok, false);
assert.equal(inspectProject(populated, null, report, { ...inventory, expectedRevision: 'stale' }).ok, false);
console.log('closed version-bound measurement and surface inspection requests ok');
