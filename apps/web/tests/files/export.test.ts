import assert from 'node:assert/strict';

import { encodeCanonicalPng, rasterizeTexture } from '@ashfox/engine-core';
import { createTargetArtifact } from '../../src/features/files/browserFileWorkflow';
import { readStoredZip } from '../../src/features/files/zip';
import { createWorkbenchProject } from '../fixtures/project';

const embeddedTextureBytes = (glb: Uint8Array): Uint8Array => {
  const view = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
  assert.equal(view.getUint32(0, true), 0x46546c67);
  const jsonLength = view.getUint32(12, true);
  assert.equal(view.getUint32(16, true), 0x4e4f534a);
  const document = JSON.parse(new TextDecoder().decode(
    glb.subarray(20, 20 + jsonLength)
  )) as {
    images: readonly [{ bufferView: number }];
    bufferViews: readonly { byteOffset?: number; byteLength: number }[];
  };
  const viewDescriptor = document.bufferViews[
    document.images[0]!.bufferView
  ]!;
  const binaryHeader = 20 + jsonLength;
  assert.equal(view.getUint32(binaryHeader + 4, true), 0x004e4942);
  const binaryStart = binaryHeader + 8;
  return glb.slice(
    binaryStart + (viewDescriptor.byteOffset ?? 0),
    binaryStart + (viewDescriptor.byteOffset ?? 0) + viewDescriptor.byteLength
  );
};

export const test = (async (): Promise<void> => {
  const project = createWorkbenchProject();
  const texture = Object.values(project.document.textures)[0];
  assert.ok(texture?.raster, 'the export fixture requires an authored raster');

  const artifact = await createTargetArtifact(project, {}, {
    target: 'glb',
    modelPath: 'workbench'
  });
  const modelEntry = readStoredZip(artifact.bytes).find((entry) =>
    entry.path === 'workbench.glb');
  assert.ok(modelEntry, 'the GLB artifact must include its model');
  assert.deepEqual(
    embeddedTextureBytes(modelEntry.bytes),
    encodeCanonicalPng(rasterizeTexture(project.document, texture)),
    'authored raster export must use canonical PNG bytes, not renderer encoding'
  );

  console.log('browser authored raster export preserves canonical PNG lineage');
})();
