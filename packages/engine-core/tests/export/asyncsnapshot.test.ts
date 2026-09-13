import assert from 'node:assert/strict';

import { compileProjectBundleResolved,
  verifyExportBundleForProject } from '../../src/export/pipeline/compile';
import { verifyExportBundleLineage } from '../../src/export/pipeline/bundle';
import { canonicalTextureBytes } from '../../src/export/texture';
import { BlobResolutionError,
  type BinaryExportFile } from '../../src/export/contract';
import { validateResolvedTexture } from
  '../../src/export/targets/gltf/textures';
import type { AssetProject } from '../../src/project/asset';
import { exportProject } from './fixture';

declare global {
  // The engine test harness waits for asynchronous module fixtures.
  var __ashfoxEngineTestPromises: Promise<void>[] | undefined;
}

const glbJson = (file: BinaryExportFile): Readonly<Record<string, unknown>> => {
  const view = new DataView(file.data.buffer, file.data.byteOffset,
    file.data.byteLength);
  assert.equal(view.getUint32(0, true), 0x46546c67);
  const jsonLength = view.getUint32(12, true);
  assert.equal(view.getUint32(16, true), 0x4e4f534a);
  const text = new TextDecoder().decode(file.data.slice(20, 20 + jsonLength));
  return JSON.parse(text.trim()) as Readonly<Record<string, unknown>>;
};

const run = async (): Promise<void> => {
  const authority = exportProject(undefined, 'async-export-snapshot');
  const document = structuredClone(authority.document);
  const project: AssetProject = { ...authority, document };
  const originalNodeCount = Object.keys(document.scene.nodes).length;
  assert.ok(originalNodeCount > 0);
  const textureBytes = new Map(Object.values(document.textures).map(
    (texture) => [texture.source.key, {
      bytes: canonicalTextureBytes(document, texture),
      contentType: texture.source.contentType
    }]
  ));
  let enterResolver: (() => void) | undefined;
  let releaseResolver: (() => void) | undefined;
  const entered = new Promise<void>((resolveEntered) => {
    enterResolver = resolveEntered;
  });
  const release = new Promise<void>((resolveRelease) => {
    releaseResolver = resolveRelease;
  });
  const pending = compileProjectBundleResolved(project, {
    target: 'glb', modelPath: 'async_snapshot'
  }, { resolveBlob: async (blob) => {
    enterResolver?.();
    await release;
    return textureBytes.get(blob.key) ?? null;
  } });
  await entered;
  document.scene.nodes = {};
  releaseResolver?.();
  const bundle = await pending;
  assert.equal(verifyExportBundleLineage(bundle), true);
  assert.equal(verifyExportBundleForProject(bundle, project), false,
    'A caller mutation after the entry snapshot must stale document lineage.');
  const model = bundle.files.find((file): file is BinaryExportFile =>
    file.kind === 'binary' && file.role === 'model');
  assert.ok(model);
  const json = glbJson(model);
  assert.equal(Array.isArray(json.nodes), true);
  assert.equal((json.nodes as unknown[]).length, originalNodeCount,
    'The async artifact must consume the immutable entry scene snapshot.');
  const sealedModelBytes = model.data.slice();
  for (const resolved of textureBytes.values()) resolved.bytes.fill(0);
  assert.deepEqual(model.data, sealedModelBytes,
    'Resolver-owned bytes must not remain aliased into the artifact.');

  const fresh = exportProject(undefined, 'async-export-hash');
  const freshTexture = Object.values(fresh.document.textures)[0]!;
  const corruptBytes = canonicalTextureBytes(fresh.document, freshTexture);
  corruptBytes[corruptBytes.length - 1] ^= 1;
  await assert.rejects(compileProjectBundleResolved(fresh, {
    target: 'glb', modelPath: 'async_hash'
  }, { resolveBlob: async () => ({ bytes: corruptBytes,
    contentType: freshTexture.source.contentType }) }),
  (error: unknown) => error instanceof BlobResolutionError &&
    error.code === 'blob.content_hash_mismatch');

  let resolvedReads = 0;
  const accessorBlob = { contentType: freshTexture.source.contentType } as
    Record<string, unknown>;
  Object.defineProperty(accessorBlob, 'bytes', { enumerable: true,
    get: () => { resolvedReads += 1; return corruptBytes; } });
  await assert.rejects(compileProjectBundleResolved(fresh, {
    target: 'glb', modelPath: 'async_accessor'
  }, { resolveBlob: async () => accessorBlob as never }),
  (error: unknown) => error instanceof BlobResolutionError &&
    error.code === 'blob.invalid_bytes');
  assert.equal(resolvedReads, 0,
    'Resolved blob accessors must reject without one attacker read.');

  const validBytes = canonicalTextureBytes(fresh.document, freshTexture);
  class ForeignBytes extends Uint8Array {}
  const symbolBytes = validBytes.slice();
  let iteratorReads = 0;
  Object.defineProperty(symbolBytes, Symbol.iterator, { configurable: true,
    get: () => { iteratorReads += 1; throw new Error('iterator read'); } });
  const extraBytes = validBytes.slice() as Uint8Array & { extra?: number };
  extraBytes.extra = 1;
  const fakeHole = Object.create(Uint8Array.prototype) as Record<string, number>;
  Object.defineProperty(fakeHole, '0', { value: validBytes[0],
    enumerable: true });
  const disguised = new Uint16Array(validBytes);
  Object.setPrototypeOf(disguised, Uint8Array.prototype);
  const dataView = new DataView(new ArrayBuffer(validBytes.length));
  Object.setPrototypeOf(dataView, Uint8Array.prototype);
  const detached = validBytes.slice();
  structuredClone(detached.buffer, { transfer: [detached.buffer] });
  const proxied = new Proxy(validBytes, { get() { throw new Error('caller getter'); } });
  for (const bytes of [new ForeignBytes(validBytes), symbolBytes, extraBytes,
    fakeHole, disguised, dataView, detached, proxied]) assert.throws(() => validateResolvedTexture(freshTexture, {
      bytes: bytes as Uint8Array, contentType: freshTexture.source.contentType
    }), (error: unknown) => error instanceof BlobResolutionError &&
      error.code === 'blob.invalid_bytes');
  assert.equal(iteratorReads, 0,
    'Exact byte validation must not consult a caller iterator.');
  const offsetBuffer = new Uint8Array(validBytes.length + 16);
  offsetBuffer.set(validBytes, 8);
  const offsetView = offsetBuffer.subarray(8, 8 + validBytes.length);
  const independent = validateResolvedTexture(freshTexture, {
    bytes: offsetView, contentType: freshTexture.source.contentType
  }).bytes;
  offsetView.fill(0);
  assert.deepEqual(independent, validBytes,
    'Native byte copying must respect view offsets and detach output from caller storage.');

  let toStringReads = 0;
  const hostileType = {};
  Object.defineProperty(hostileType, 'toString', { get: () => {
    toStringReads += 1;
    throw new Error('content type coercion');
  }});
  assert.throws(() => validateResolvedTexture(freshTexture, {
    bytes: validBytes, contentType: hostileType as never
  }), (error: unknown) => error instanceof BlobResolutionError &&
    error.code === 'blob.content_type_mismatch');
  assert.equal(toStringReads, 0,
    'A non-string content type must reject before attacker coercion.');
  console.log('async export authority and blob snapshots ok');
};

const pending = run();
if (globalThis.__ashfoxEngineTestPromises) {
  globalThis.__ashfoxEngineTestPromises.push(pending);
} else {
  void pending.catch((error: unknown) => {
    setImmediate(() => { throw error; });
  });
}
