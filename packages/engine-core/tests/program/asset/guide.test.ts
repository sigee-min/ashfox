import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { openAssetProject, measureSceneGeometry } from '../../../src';
import { rasterizeCanonicalTexture } from '../../../src/textures/textureRecipe/raster';
import { workspaceFixture } from '../../project/workspace/fixtures';

const guide = readFileSync(resolve(__dirname, '../../../../../docs/guides/precision-modeling.md'), 'utf8');
const source = /```text\n([\s\S]*?)\n```/u.exec(guide)?.[1];
assert.ok(source, 'guide includes a complete executable source');
const syntaxGuide = readFileSync(resolve(__dirname,
  '../../../../../docs/architecture/asset-language.md'), 'utf8');
const completeExample = [...syntaxGuide.matchAll(/```text\n([\s\S]*?)\n```/gu)]
  .map((match) => match[1])
  .find((example) => example.startsWith('ashfox-model 1\nasset sample {'));
assert.ok(completeExample, 'language reference provides a complete starting asset');
const startingAsset = openAssetProject({
  workspace: workspaceFixture([{ path: 'sample/main.ashfox', source: completeExample }], {
    root: 'sample', packageName: 'sample', entries: [{ name: 'sample', path: 'main.ashfox' }]
  }),
  entry: { packageName: 'sample', entryName: 'sample' },
  identity: { id: 'project:syntax-guide', revision: 'revision:1', createdAt: '2026-01-01T00:00:00.000Z' }
});
assert.ok(startingAsset.ok, startingAsset.ok ? '' : JSON.stringify(startingAsset.diagnostics));
if (startingAsset.ok) {
  assert.deepEqual(Object.values(startingAsset.project.document.animations)
    .map((clip) => clip.name), ['idle']);
}
for (const width of [4, 6]) {
  const candidate = source.replace('width: unit = 4u;', `width: unit = ${width}u;`);
  const workspace = workspaceFixture([{ path: 'study/main.ashfox', source: candidate }], {
    root: 'study', packageName: 'study', entries: [{ name: 'study', path: 'main.ashfox' }]
  });
  const result = openAssetProject({ workspace,
    entry: { packageName: 'study', entryName: 'study' },
    identity: { id: 'project:guide', revision: 'revision:1', createdAt: '2026-01-01T00:00:00.000Z' }
  });
  assert.ok(result.ok, result.ok ? '' : JSON.stringify(result.diagnostics));
  if (result.ok) {
    const document = result.project.document;
    const node = Object.values(document.scene.nodes).find((item) => item.kind === 'cube');
    assert.ok(node);
    const measured = measureSceneGeometry(document, { nodeId: node.id, scope: 'node', groundY: 0, tolerance: 0 });
    assert.ok(measured.ok);
    if (measured.ok) {
      assert.deepEqual(measured.value.dimensions, [width, 4, 4]);
      assert.equal(measured.value.ground.relation, 'touching');
    }
    assert.equal(node.kind, 'cube');
    if (node.kind !== 'cube') continue;
    const face = node.faces.north;
    assert.ok(face.enabled);
    assert.ok(face.textureId);
    assert.ok(face.uv);
    assert.equal(face.rotation ?? 0, 0);
    const texture = document.textures[face.textureId];
    assert.ok(texture?.raster);
    assert.equal(texture.sampling, 'nearest');
    const image = rasterizeCanonicalTexture(texture.width, texture.height, {
      background: texture.raster.background,
      backgroundAlpha: texture.raster.backgroundAlpha,
      canvasDetails: texture.raster.canvasDetails,
      alphaMasks: texture.raster.alphaMasks ?? []
    });
    const [u0, v0, u1, v1] = face.uv;
    assert.deepEqual([u1 - u0, v1 - v0], [width, 4], 'UV pixel span follows the resized geometry');
    const eyePixels: number[][] = [];
    for (let y = 0; y < texture.height; y += 1) for (let x = 0; x < texture.width; x += 1) {
      const offset = (y * texture.width + x) * 4;
      if (image.rgba.at(offset) === 9 && image.rgba.at(offset + 1) === 7 &&
        image.rgba.at(offset + 2) === 7 && image.rgba.at(offset + 3) === 255) {
        eyePixels.push([x - u0, y - v0]);
      }
    }
    assert.deepEqual(eyePixels, [[1, 1], [width - 2, 1]],
      'exactly two opaque eye pixels survive grain/tone: left inset stays fixed and right anchor follows width');
  }
}
