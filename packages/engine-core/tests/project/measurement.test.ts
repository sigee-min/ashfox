import assert from 'node:assert/strict';
import { exportProject } from '../export/fixture';
import { measureSceneGeometry } from '../../src/model/measurement/geometry';
import { inspectNodeSurface } from '../../src/model/measurement/surface';
import { IDENTITY_TRANSFORM, type BoneNode, type CubeNode, type PlaneNode } from '../../src/model';

const project = exportProject();
const original = Object.values(project.document.scene.nodes).find((node) => node.kind === 'cube');
assert.ok(original);
const cube: CubeNode = { ...original, id: 'cube', parentId: 'bone', geometryMode: 'axis-box',
  bounds: { from: [0, 0, 0], to: [2, 4, 6] }, orientedBox: undefined,
  inflate: 0, transform: { ...IDENTITY_TRANSFORM } };
const bone: BoneNode = { id: 'bone', name: 'bone', kind: 'bone', parentId: null,
  visible: true, transform: { position: [10, 2, 0], pivot: [0, 0, 0],
    rotation: [0, 0, 90], scale: [2, 1, 1] } };
const document = { ...project.document, scene: { roots: ['bone'], nodes: { bone, cube } } };
const request = { nodeId: 'cube', scope: 'node' as const, groundY: 0, tolerance: 1e-8 };
const result = measureSceneGeometry(document, request);
assert.ok(result.ok);
// Child origin subtracts parent's authored origin, then inherits its scale/rotation.
if (result.ok) {
  for (const [actual, expected] of result.value.bounds.min.map((v, i) => [v, [8, -18, 0][i]!])) {
    assert.ok(Math.abs(actual - expected) < 1e-8);
  }
  assert.deepEqual(result.value.dimensions.map(Math.round), [4, 4, 6]);
  assert.equal(result.value.ground.relation, 'penetrating');
}
const plain = { ...document, scene: { roots: ['cube'], nodes: { cube: { ...cube, parentId: null } } } };
const contact = measureSceneGeometry(plain, request);
assert.ok(contact.ok);
if (contact.ok) assert.equal(contact.value.ground.relation, 'touching');
assert.equal(measureSceneGeometry(plain, { ...request, nodeId: 'missing' }).ok, false);
assert.equal(measureSceneGeometry(plain, { ...request, tolerance: NaN }).ok, false);
const openRequest = { ...request, extra: true };
assert.equal(measureSceneGeometry(plain, openRequest).ok, false);
assert.equal(measureSceneGeometry(document, { ...request, nodeId: 'bone' }).ok, false);
assert.equal(measureSceneGeometry(document, { ...request, nodeId: 'bone', scope: 'subtree' }).ok, true);
const cyclic = { ...document, scene: { ...document.scene, nodes: { cube, bone: { ...bone, parentId: 'bone' } } } };
assert.equal(measureSceneGeometry(cyclic, request).ok, false);

const plane: PlaneNode = { id: 'plane', name: 'plane', kind: 'plane', parentId: null,
  visible: false, transform: { ...IDENTITY_TRANSFORM }, size: [2, 3],
  basis: { uAxis: [0, 0, 1], vAxis: [0, 1, 0], normal: [-1, 0, 0], orientation: 'normal' },
  sidedness: 'front', coverageId: 'plane-chart',
  faces: { front: original.faces.north, back: original.faces.south } };
const planeDocument = { ...plain, scene: { roots: ['plane'], nodes: { plane } } };
const planeResult = measureSceneGeometry(planeDocument, { ...request, nodeId: 'plane' });
assert.ok(planeResult.ok);
if (planeResult.ok) assert.deepEqual(planeResult.value.dimensions, [0, 3, 2]);
const surface = inspectNodeSurface(plain, 'cube');
assert.equal(surface?.faces.length, 6);
assert.equal(inspectNodeSurface(document, 'bone'), null);
assert.equal(inspectNodeSurface(plain, '__proto__'), null);
const oriented: CubeNode = { ...cube, parentId: null, geometryMode: 'oriented-box', bounds: undefined,
  orientedBox: { unrotatedFrom: [0, 0, 0], unrotatedTo: [2, 4, 6], pivot: [0, 0, 0],
    rotation: { axis: 'z', angle22_5Units: 2 }, cornerDenominator: 1,
    cornerNumerators: [], cornerDigest: '', faceChartDigest: '', coverProofDigest: '' } };
const orientedResult = measureSceneGeometry({ ...plain, scene: { roots: ['cube'], nodes: { cube: oriented } } }, request);
assert.ok(orientedResult.ok);
if (orientedResult.ok) {
  assert.ok(Math.abs(orientedResult.value.bounds.min[0] + 4 / Math.sqrt(2)) < 1e-8);
  assert.ok(Math.abs(orientedResult.value.dimensions[0] - 6 / Math.sqrt(2)) < 1e-8);
}
const inflated = measureSceneGeometry({ ...plain, scene: { roots: ['cube'], nodes: {
  cube: { ...cube, parentId: null, inflate: 1, transform: { ...IDENTITY_TRANSFORM, scale: [2, 1, 1] } }
} } }, request);
assert.ok(inflated.ok);
if (inflated.ok) assert.deepEqual(inflated.value.bounds, { min: [-2, -1, -1], max: [6, 5, 7] });
console.log('rest-pose measurements, parent transforms, signed planes and face inspection ok');
