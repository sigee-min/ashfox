import assert from 'node:assert/strict';
import path from 'node:path';
import { encodeUtf8 } from '@ashfox/internal-contracts';
import {
  encodeCanonicalPng,
  evaluateGlbPerformance,
  inspectGlbPerformance,
  type CanonicalTextureRaster,
} from '../../src/index';
import type { GameAssetPack } from '../../src/project/directory/pack';
import type { Artifact, CatalogAsset } from '../../../asset-build/src/bundle/contract';
import { compileGamePack } from '../../../asset-build/src/packs/game/compile';
import { deduplicateSharedGlbTextures } from '../../../asset-build/src/packs/game/sharedTextures';

const validator = require('gltf-validator');

const makeTestPng = (w: number, h: number, seed: number): Uint8Array => {
  const bytes = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i += 1) {
    bytes.set([(i * 17 + seed) & 255, (i * 31 + seed) & 255, (i * 53 + seed) & 255, 255], i * 4);
  }
  const rgba = Object.freeze({
    length: bytes.length,
    at: (i: number) => bytes[i]!,
    copy: () => new Uint8Array(bytes),
    [Symbol.iterator]: () => bytes[Symbol.iterator](),
  });
  return encodeCanonicalPng({ width: w, height: h, rgba } as CanonicalTextureRaster);
};

const packGlb = (doc: Record<string, unknown>, bin: Uint8Array): Uint8Array => {
  const jRaw = encodeUtf8(JSON.stringify(doc));
  const jLen = (jRaw.byteLength + 3) & ~3;
  const bLen = (bin.byteLength + 3) & ~3;
  const total = 12 + 8 + jLen + (bLen > 0 ? 8 + bLen : 0);
  const out = new Uint8Array(total);
  const v = new DataView(out.buffer);
  v.setUint32(0, 0x46546c67, true);
  v.setUint32(4, 2, true);
  v.setUint32(8, total, true);
  v.setUint32(12, jLen, true);
  v.setUint32(16, 0x4e4f534a, true);
  out.set(jRaw, 20);
  out.fill(0x20, 20 + jRaw.byteLength, 20 + jLen);
  if (bLen > 0) {
    v.setUint32(20 + jLen, bLen, true);
    v.setUint32(24 + jLen, 0x004e4942, true);
    out.set(bin, 28 + jLen);
  }
  return out;
};

interface SyntheticOpts {
  lod0Tris: number;
  lod0Prims?: number;
  lod1Tris?: number;
  lod2Prims?: number;
  skinned?: boolean;
  instancedCount?: number;
  png?: Uint8Array;
  padBytes?: number;
}

const makeIdx = (tris: number): Uint8Array => {
  const buf = new Uint8Array(tris * 6);
  const v = new DataView(buf.buffer);
  for (let t = 0; t < tris; t += 1) {
    v.setUint16(t * 6, 0, true);
    v.setUint16(t * 6 + 2, 1, true);
    v.setUint16(t * 6 + 4, 2, true);
  }
  return buf;
};

const buildSyntheticGlb = (opts: SyntheticOpts): Uint8Array => {
  const pos = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const uv = new Float32Array([0, 0, 1, 0, 0, 1]);
  const chunks: Uint8Array[] = [];
  const bvs: Record<string, unknown>[] = [];
  let cur = 0;
  const push = (data: Uint8Array, target?: number): number => {
    const off = (cur + 3) & ~3;
    if (off > cur) chunks.push(new Uint8Array(off - cur));
    chunks.push(data);
    cur = off + data.byteLength;
    const bv: Record<string, unknown> = { buffer: 0, byteOffset: off, byteLength: data.byteLength };
    if (target) bv.target = target;
    return bvs.push(bv) - 1;
  };
  const posBv = push(new Uint8Array(pos.buffer), 34962);
  const uvBv = push(new Uint8Array(uv.buffer), 34962);
  const idx0Bv = push(makeIdx(opts.lod0Tris), 34963);
  const idx1Bv = opts.lod1Tris ? push(makeIdx(opts.lod1Tris), 34963) : undefined;
  const idx2Bv = opts.lod2Prims ? push(makeIdx(opts.lod2Prims * 2), 34963) : undefined;
  const instBv = opts.instancedCount ? push(new Uint8Array(opts.instancedCount * 12)) : undefined;
  const pngBv = opts.png ? push(opts.png) : undefined;
  if (opts.padBytes) push(new Uint8Array(opts.padBytes));
  const accs: Record<string, unknown>[] = [
    {
      bufferView: posBv,
      componentType: 5126,
      count: 3,
      type: 'VEC3',
      min: [0, 0, 0],
      max: [1, 1, 0],
    },
    { bufferView: uvBv, componentType: 5126, count: 3, type: 'VEC2' },
    { bufferView: idx0Bv, componentType: 5123, count: opts.lod0Tris * 3, type: 'SCALAR' },
  ];
  const addAcc = (bv: number, count: number, type = 'SCALAR', componentType = 5123) =>
    accs.push({ bufferView: bv, componentType, count, type }) - 1;
  const idx1 = idx1Bv !== undefined ? addAcc(idx1Bv, opts.lod1Tris! * 3) : undefined;
  const idx2 = idx2Bv !== undefined ? addAcc(idx2Bv, opts.lod2Prims! * 6) : undefined;
  const inst =
    instBv !== undefined ? addAcc(instBv, opts.instancedCount!, 'VEC3', 5126) : undefined;
  const attrs = { POSITION: 0, TEXCOORD_0: 1 };
  const prims = (n: number, idx: number, mat?: number) =>
    Array.from({ length: n }, () => ({
      attributes: attrs,
      indices: idx,
      mode: 4,
      ...(mat !== undefined ? { material: mat } : {}),
    }));
  const meshes: Record<string, unknown>[] = [
    { primitives: prims(opts.lod0Prims ?? 1, 2, pngBv !== undefined ? 0 : undefined) },
  ];
  const extInst =
    inst !== undefined ? { EXT_mesh_gpu_instancing: { attributes: { TRANSLATION: inst } } } : {};
  const nodes: Record<string, unknown>[] = [
    {
      name: 'a_LOD0',
      mesh: 0,
      ...(opts.skinned ? { skin: 0 } : {}),
      ...(inst !== undefined ? { extensions: extInst } : {}),
    },
  ];
  const sceneNodes = [0];
  if (idx1 !== undefined) {
    const n1 =
      nodes.push({ name: 'a_LOD1', mesh: meshes.push({ primitives: prims(1, idx1) }) - 1 }) - 1;
    sceneNodes.push(n1);
    if (idx2 !== undefined) {
      const n2 =
        nodes.push({
          name: 'a_LOD2',
          mesh: meshes.push({ primitives: prims(opts.lod2Prims!, idx2) }) - 1,
        }) - 1;
      sceneNodes.push(n2);
      nodes[0] = { ...nodes[0], extensions: { ...extInst, MSFT_lod: { ids: [n1, n2] } } };
    }
  }
  const bin = new Uint8Array(cur);
  for (let p = 0, i = 0; i < chunks.length; p += chunks[i]!.byteLength, i += 1)
    bin.set(chunks[i]!, p);
  const mat = {
    pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0, roughnessFactor: 1 },
  };
  const texProps =
    pngBv !== undefined
      ? {
          images: [{ bufferView: pngBv, mimeType: 'image/png', name: 'tex' }],
          samplers: [{ magFilter: 9728, minFilter: 9728, wrapS: 10497, wrapT: 10497 }],
          textures: [{ sampler: 0, source: 0 }],
          materials: [mat],
        }
      : {};
  return packGlb(
    {
      asset: { version: '2.0', generator: 'ashfox-test' },
      scene: 0,
      scenes: [{ nodes: sceneNodes }],
      nodes,
      meshes,
      accessors: accs,
      bufferViews: bvs,
      buffers: [{ byteLength: bin.byteLength }],
      ...(opts.skinned ? { skins: [{ joints: [0] }] } : {}),
      ...(opts.instancedCount ? { extensionsUsed: ['EXT_mesh_gpu_instancing'] } : {}),
      ...texProps,
    },
    bin,
  );
};

const testPerformanceInspectionAndBudgets = (): void => {
  const png = makeTestPng(32, 32, 11);
  const okCreature = buildSyntheticGlb({
    lod0Tris: 600,
    lod0Prims: 2,
    lod1Tris: 300,
    lod2Prims: 1,
    skinned: true,
    png,
  });
  const m = inspectGlbPerformance(okCreature);
  assert.deepEqual(
    [m.drawCalls, m.triangles, m.lod1Triangles, m.lod2DrawCalls, m.skinned, m.textureCount],
    [2, 1200, 300, 1, true, 1],
  );
  assert.ok(m.estimatedVramBytes >= Math.round(32 * 32 * 4 * 1.33));
  assert.equal(evaluateGlbPerformance(okCreature, 'creature').passed, true);
  const drawFail = evaluateGlbPerformance(
    buildSyntheticGlb({ lod0Tris: 200, lod0Prims: 3, skinned: true }),
    'creature',
  );
  assert.equal(drawFail.passed, false);
  assert.ok(drawFail.violations.some((v) => v.metric === 'drawCalls'));
  const multiFail = evaluateGlbPerformance(
    buildSyntheticGlb({
      lod0Tris: 1600,
      lod0Prims: 1,
      lod1Tris: 1000,
      lod2Prims: 2,
      padBytes: 46 * 1024,
    }),
    'creature',
  );
  assert.equal(multiFail.passed, false);
  for (const k of ['triangles', 'glbBytes', 'lod1Ratio', 'lod2DrawCalls'] as const) {
    assert.ok(multiFail.violations.some((v) => v.metric === k));
  }
  const inst = buildSyntheticGlb({
    lod0Tris: 500,
    lod0Prims: 2,
    instancedCount: 10,
    lod1Tris: 2000,
    lod2Prims: 1,
    png,
  });
  const structRep = evaluateGlbPerformance(inst, 'structure');
  assert.deepEqual(
    [structRep.metrics.drawCalls, structRep.metrics.triangles, structRep.passed],
    [2, 10000, true],
  );
  assert.equal(evaluateGlbPerformance(inst, 'compound').passed, true);
};

const testSharedTextureDeduplication = async (): Promise<void> => {
  const png = makeTestPng(64, 64, 7);
  const [glbA, glbB] = [
    buildSyntheticGlb({ lod0Tris: 20, png }),
    buildSyntheticGlb({ lod0Tris: 30, png }),
  ];
  const inputs = [
    { path: 'models/a/a.glb', bytes: glbA },
    { path: 'models/b/b.glb', bytes: glbB },
  ];
  const deduped = deduplicateSharedGlbTextures(inputs);
  assert.equal(deduped.sharedTextures.length, 1);
  const texEntry = deduped.sharedTextures[0]!;
  assert.match(texEntry.path, /^textures\/[a-f0-9]{12}\.png$/);
  assert.deepEqual(texEntry.bytes, png);
  for (const file of deduped.files) {
    assert.ok(file.bytes.byteLength < glbA.byteLength - png.byteLength / 2);
    const res = await validator.validateBytes(file.bytes, {
      externalResourceFunction: async (uri: string) => {
        assert.equal(
          path.posix.normalize(path.posix.join(path.posix.dirname(file.path), uri)),
          texEntry.path,
        );
        return texEntry.bytes;
      },
    });
    assert.equal(res.issues.numErrors, 0, JSON.stringify(res.issues));
  }
  assert.equal(deduplicateSharedGlbTextures(inputs, false).sharedTextures.length, 0);
  const assets: CatalogAsset[] = ['a', 'b'].map((id) => ({
    id,
    kind: 'model',
    directory: `dist/${id}`,
    files: [
      {
        path: `assets/${id}/${id}.glb`,
        sha256: '0'.repeat(64),
        byteLength: id === 'a' ? glbA.byteLength : glbB.byteLength,
      },
    ],
    metadata: { clips: [] },
  }));
  const pack: GameAssetPack = {
    name: 'pack',
    format: 'game_assets',
    directory: 'dist/pack',
    archive: false,
    audio: 'wav',
    unitsPerMeter: 1,
    pixelsPerUnit: 16,
    spriteFilter: 'nearest',
    assets: [
      { id: 'model.a', source: 'a', path: 'models/a' },
      { id: 'model.b', source: 'b', path: 'models/b' },
    ],
  };
  const packed = await compileGamePack(pack, assets, [
    { path: 'assets/a/a.glb', bytes: glbA },
    { path: 'assets/b/b.glb', bytes: glbB },
  ]);
  assert.ok(packed.some((f) => f.path === `game-assets/${texEntry.path}`));
  const manifest = JSON.parse(
    new TextDecoder().decode(packed.find((f) => f.path === 'game-assets/assets.json')!.bytes),
  );
  assert.equal(manifest.sharedTextures.length, 1);
  const glbOut = packed.find((f) => f.path === 'game-assets/models/a/a.glb')!.bytes;
  assert.ok(
    inspectGlbPerformance(glbOut, {
      externalImages: new Map([[`../../${texEntry.path}`, texEntry.bytes]]),
    }).estimatedVramBytes >= Math.round(64 * 64 * 4 * 1.33),
  );
};

const main = async (): Promise<void> => {
  testPerformanceInspectionAndBudgets();
  await testSharedTextureDeduplication();
  console.log('ashfox performance budget & shared texture deduplication tests ok');
};
const pending = main().catch((err) => {
  console.error(err);
  process.exit(1);
});
const bucket = (globalThis as { __ashfoxEngineTestPromises?: Promise<unknown>[] })
  .__ashfoxEngineTestPromises;
if (Array.isArray(bucket)) bucket.push(pending);
