import assert from 'node:assert/strict';
import { exportProject } from './fixture';
import type { PlaneNode } from '../../src/model';
import { GltfBinaryWriter } from '../../src/export/targets/gltf/binary';
import { compileGltfCubePrimitiveData } from '../../src/export/targets/gltf/cube';
import { compileGltfPlanePrimitiveData } from '../../src/export/targets/gltf/plane';

const document = exportProject().document;
const cube = Object.values(document.scene.nodes).find(node => node.kind === 'cube');
assert.ok(cube && cube.kind === 'cube');
const texture = Object.values(document.textures)[0];
assert.ok(texture);
const face = { enabled: true, textureId: texture.id, uv: [0, 0, 2, 2] as [number, number, number, number], rotation: 0 as const };
const options = { writer: new GltfBinaryWriter(false), unitScale: 1,
  materialByTextureId: new Map([[texture.id, 0]]), singleSidedMaterialByTextureId: new Map([[texture.id, 0]]) };
const texturedCube = { ...cube, faces: { north: face, south: face, east: face, west: face, up: face, down: face } };
const plane: PlaneNode = { ...cube, kind: 'plane', coverageId: 'test', size: [2, 2], sidedness: 'double', faces: { front: face, back: face } };
for (const primitives of [compileGltfCubePrimitiveData(document, texturedCube, options), compileGltfPlanePrimitiveData(document, plane, options)]) {
  assert.ok(primitives.length > 0);
  for (const primitive of primitives) {
    assert.ok(primitive.uvs);
    const vertical = primitive.uvs.filter((_, index) => index % 2 === 1);
    // A top-left atlas patch must remain at the top of the exported PNG.
    // glTF defines (0,0) at the upper left, unlike WebGL texture UVs.
    assert.equal(Math.min(...vertical), 0);
    assert.equal(Math.max(...vertical), 2 / texture.height);
  }
}
console.log('glTF cube and plane atlas coordinates retain the upper-left texture origin');
