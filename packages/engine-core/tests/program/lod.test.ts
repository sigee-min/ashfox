import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  compileDirectoryWorkspace,
  openAssetProject,
  parseStructureSource,
  compileStructureUnits,
  virtualLibrarySpecifierFromPath,
  type DirectoryFile,
} from '../../src';

const loadStdLibs = (
  dir = path.resolve(__dirname, '../../../../library/std'),
  rel = '',
  out = new Map<string, string>(),
): Map<string, string> => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const next = rel ? `${rel}/${e.name}` : e.name;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) loadStdLibs(full, next, out);
    else if (e.isFile() && e.name.endsWith('.ashfox')) {
      const spec = virtualLibrarySpecifierFromPath(`library/std/${next}`);
      if (spec) out.set(spec, fs.readFileSync(full, 'utf8'));
    }
  }
  return out;
};
import { adaptProjectForExport } from '../../src/export/adapter';
import { validateExportTarget } from '../../src/export/pipeline/validate';
import { buildGltf, exportGltf } from '../../src/export/targets/gltf/exporter';
import {
  attachModelLods,
  attachStructureLods,
  DEFAULT_LOD_HYSTERESIS,
  DEFAULT_MODEL_LOD_DISTANCES,
  DEFAULT_STRUCTURE_LOD_DISTANCES,
  type GltfLodDocument,
} from '../../src/export/targets/gltf/lodEmit';
import {
  buildModelLod1Document,
  buildModelLod2Mesh,
  computeModelBoundsAndPartSizes,
} from '../../src/export/targets/gltf/modelLod';
import { buildStructureGltf } from '../../src/export/targets/gltf/structureGltf';
import { workspaceFixture } from '../project/workspace/fixtures';

interface ValidatorReport {
  issues: {
    numErrors: number;
    numWarnings: number;
    messages: { severity: number; code: string; message: string }[];
  };
}

const validator = require('gltf-validator') as {
  validateBytes: (
    data: Uint8Array,
    opts?: { externalResourceFunction?: (uri: string) => Promise<Uint8Array> },
  ) => Promise<ValidatorReport>;
};

const REPO_ROOT = path.resolve(__dirname, '../../../..');

const walkFiles = (rootDir: string, base: string): DirectoryFile[] => {
  const out: DirectoryFile[] = [];
  for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
    if (entry.name === 'dist' || entry.name === 'build') continue;
    const rel = base ? `${base}/${entry.name}` : entry.name;
    const full = path.join(rootDir, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(full, rel));
    else if (entry.name.endsWith('.ashfox'))
      out.push({ path: rel, source: fs.readFileSync(full, 'utf8') });
  }
  return out;
};

const toGlbBytes = (doc: GltfLodDocument, bin: Uint8Array): Uint8Array => {
  const jsonBuf = Buffer.from(JSON.stringify(doc), 'utf8');
  const jsonPad = (jsonBuf.length + 3) & ~3;
  const binPad = (bin.length + 3) & ~3;
  const out = Buffer.alloc(12 + 8 + jsonPad + 8 + binPad, 0x20);
  out.writeUInt32LE(0x46546c67, 0);
  out.writeUInt32LE(2, 4);
  out.writeUInt32LE(out.length, 8);
  out.writeUInt32LE(jsonPad, 12);
  out.writeUInt32LE(0x4e4f534a, 16);
  jsonBuf.copy(out, 20);
  out.writeUInt32LE(binPad, 20 + jsonPad);
  out.writeUInt32LE(0x004e4942, 24 + jsonPad);
  Buffer.from(bin).copy(out, 28 + jsonPad);
  return out;
};

const triCountOf = (batches: readonly { indices: readonly number[] }[]): number =>
  batches.reduce((sum, batch) => sum + batch.indices.length / 3, 0);

const testStructureThreeTierLod = async (): Promise<void> => {
  const dir = path.join(REPO_ROOT, 'showcase');
  const cfg = fs.readFileSync(path.join(dir, '.ashfoxworkspace'), 'utf8');
  const compiled = compileDirectoryWorkspace(
    cfg,
    walkFiles(dir, '').filter((f) => !f.path.startsWith('dist/') && !f.path.startsWith('.ashfox')),
    loadStdLibs(),
  );
  assert.equal(compiled.ok, true);
  if (!compiled.ok) return;

  for (const product of compiled.products) {
    if (product.kind !== 'structure') continue;
    const s = product.structure;
    assert.ok(s.lodLevels, `${product.entry.entryName} missing lodLevels`);
    const lod1 = s.lodLevels.lod1;
    const lod2 = s.lodLevels.lod2;
    const t0 = triCountOf(s.bakedMesh.batches);
    const t1 = triCountOf(lod1.batches);
    const t2 = triCountOf(lod2.batches);

    assert.equal(lod1.trimCount, 0, `${product.entry.entryName} LOD1 must omit trims`);
    assert.ok(t1 > 0 && t1 <= t0 * 0.25, `${product.entry.entryName} LOD1 ${t1}/${t0} > 25%`);
    assert.equal(lod2.batches.length, 1, `${product.entry.entryName} LOD2 must merge to 1 batch`);
    assert.equal(lod2.batches[0]!.layer, 'opaque');
    assert.equal(lod2.batches[0]!.textureId, '');
    assert.equal(lod2.batches[0]!.uvs.length, 0);
    assert.equal(lod2.batches[0]!.colors.length, lod2.batches[0]!.positions.length);
    assert.equal(Object.keys(lod2.textures).length, 0);
    assert.equal(lod2.instances.length, 0);
    assert.ok(t2 > 0 && t2 <= t1);

    const gltf = buildStructureGltf(s).compiled;
    const withLod = attachStructureLods(gltf, s);
    const names = new Set(withLod.document.nodes.map((n) => n.name));
    assert.ok(names.has(`${s.id}_LOD0`) && names.has(`${s.id}_LOD1`) && names.has(`${s.id}_LOD2`));
    const lod0 = withLod.document.nodes.find((n) => n.name === `${s.id}_LOD0`)!;
    assert.equal(lod0.extensions?.MSFT_lod?.ids.length, 2);
    assert.deepEqual(lod0.extras?.MSFT_screencoverage, [0.5, 0.2, 0.05]);
    const rootIdx = withLod.document.scenes[0]?.nodes?.[0] ?? 0;
    const wrap = withLod.document.nodes[rootIdx]!;
    assert.equal(wrap.name, s.id);
    assert.deepEqual(wrap.extras?.ashfox?.lod?.distances, DEFAULT_STRUCTURE_LOD_DISTANCES);
    assert.equal(wrap.extras?.ashfox?.lod?.hysteresis, DEFAULT_LOD_HYSTERESIS);

    const report = await validator.validateBytes(toGlbBytes(withLod.document, withLod.binary));
    assert.equal(report.issues.numErrors, 0, JSON.stringify(report.issues.messages));
    assert.equal(report.issues.numWarnings, 0, JSON.stringify(report.issues.messages));
  }
};

const testStairWedgeAndWindowGlowPreservation = (): void => {
  const src = `ashfox 1
structure stair_hall {
  size = (7b, 6b, 7b);
  palette {
    stone = "minecraft:stone_bricks";
    glass = "minecraft:glass_pane";
    stair = "minecraft:oak_stairs[facing=north,half=bottom]";
    air = "minecraft:air";
  }
  box { from = (0b, 0b, 0b); to = (6b, 4b, 6b); block = stone; }
  box { from = (1b, 1b, 1b); to = (5b, 3b, 5b); block = air; }
  box { from = (1b, 1b, 1b); to = (4b, 1b, 1b); block = stair; }
  set { at = (3b, 2b, 0b); block = glass; }
}`;
  const parsed = parseStructureSource(src, 'stair_hall.ashfox');
  const out = compileStructureUnits(
    'stair_hall.ashfox',
    new Map([['stair_hall.ashfox', parsed]]),
    {},
    (_o, spec) => spec,
  );
  const lod1 = out.lodLevels!.lod1;
  assert.ok(lod1.trimCount === 0);
  assert.ok(triCountOf(lod1.batches) < triCountOf(out.bakedMesh.batches));
  assert.ok(lod1.batches.some((b) => b.textureId.startsWith('struct_atlas_')));
};

const testCreatureModelsThreeTierLod = async (): Promise<void> => {
  const wsDir = path.join(REPO_ROOT, 'showcase');
  const ws = fs.readFileSync(path.join(wsDir, '.ashfoxworkspace'), 'utf8');
  const files = walkFiles(wsDir, '').filter(
    (f) => !f.path.startsWith('dist/') && !f.path.startsWith('.ashfox'),
  );
  const compiledShowcase = compileDirectoryWorkspace(ws, files, loadStdLibs());
  assert.equal(compiledShowcase.ok, true);
  if (!compiledShowcase.ok) return;
  const cases: readonly string[] = ['griffin_boss', 'red_fox', 'goblin_raider'];
  for (const entryName of cases) {
    const prod = compiledShowcase.products.find(
      (p) => p.kind === 'model' && p.entry.entryName === entryName,
    );
    assert.ok(prod && prod.kind === 'model', `Missing showcase model ${entryName}`);
    if (!prod || prod.kind !== 'model') continue;
    const opened = openAssetProject({
      workspace: prod.workspace,
      entry: prod.entry,
      identity: { id: entryName, revision: 'r1', createdAt: '2026-01-01T00:00:00.000Z' },
    });
    assert.equal(opened.ok, true, opened.ok ? '' : JSON.stringify(opened.diagnostics));
    if (!opened.ok) continue;
    const doc = opened.project.document;
    const a0 = computeModelBoundsAndPartSizes(doc);
    const doc1 = buildModelLod1Document(doc);
    const a1 = computeModelBoundsAndPartSizes(doc1);
    const mesh2 = buildModelLod2Mesh(doc);
    const b0 = Object.values(doc.scene.nodes).filter((n) => n.kind === 'bone').length;
    const b1 = Object.values(doc1.scene.nodes).filter((n) => n.kind === 'bone').length;

    assert.equal(Object.values(doc1.scene.nodes).filter((n) => n.kind === 'plane').length, 0);
    assert.ok(a1.lod0TriCount <= a0.lod0TriCount * 0.55, `${entryName} LOD1 tris > 55%`);
    assert.ok(b1 <= b0, `${entryName} bones ${b0} -> ${b1}`);
    for (const clip of Object.values(doc.animations)) {
      for (const ch of Object.values(clip.channels)) {
        if (doc.scene.nodes[ch.targetNodeId]?.kind === 'bone') {
          assert.ok(
            doc1.scene.nodes[ch.targetNodeId],
            `${entryName} LOD1 dropped animated bone ${ch.targetNodeId}`,
          );
        }
      }
    }
    const rootBoneId = Object.values(doc.scene.nodes).find(
      (n) => n.kind === 'bone' && n.parentId === null,
    )?.id;
    assert.ok(rootBoneId, `${entryName} missing root bone`);
    const withStaticLeaf = {
      ...structuredClone(doc),
      scene: {
        ...structuredClone(doc.scene),
        nodes: {
          ...structuredClone(doc.scene.nodes),
          __static_leaf_test: {
            id: '__static_leaf_test',
            name: '__static_leaf_test',
            kind: 'bone' as const,
            parentId: rootBoneId,
            visible: true,
            transform: {
              position: [0, 0, 0] as const,
              rotation: [0, 0, 0] as const,
              scale: [1, 1, 1] as const,
              pivot: [0, 0, 0] as const,
            },
          },
        },
      },
    };
    const lod1WithStaticLeaf = buildModelLod1Document(withStaticLeaf);
    assert.equal(
      lod1WithStaticLeaf.scene.nodes.__static_leaf_test,
      undefined,
      `${entryName} LOD1 should flatten un-animated static leaf bone`,
    );
    assert.ok(mesh2.indices.length > 0 && mesh2.colors.length === mesh2.positions.length);

    const adapted = adaptProjectForExport(doc, { target: 'glb', modelPath: entryName });
    const validated = validateExportTarget(adapted, { profileId: 'gltf.2', errorMessage: 'err' });
    const compiled = buildGltf(validated.document);
    const withLod = attachModelLods(compiled, doc);
    const sceneNodes = withLod.document.scenes[0]?.nodes ?? [];
    const lod0 = withLod.document.nodes.find((n) => n.name === `${doc.id}_LOD0`)!;
    assert.ok(lod0 && lod0.extensions?.MSFT_lod?.ids.length === 2);
    assert.deepEqual(lod0.extras?.ashfox?.lod?.distances, DEFAULT_MODEL_LOD_DISTANCES);
    const lod1Idx = withLod.document.nodes.findIndex((n) => n.name === `${doc.id}_LOD1`);
    const lod2Idx = withLod.document.nodes.findIndex((n) => n.name === `${doc.id}_LOD2`);
    assert.ok(sceneNodes.includes(lod1Idx) && sceneNodes.includes(lod2Idx));

    const texByName = new Map<string, Uint8Array>();
    for (const tf of compiled.textureFiles) {
      if (tf.kind === 'binary') texByName.set(path.basename(tf.path), tf.data);
    }
    const report = await validator.validateBytes(toGlbBytes(withLod.document, withLod.binary), {
      externalResourceFunction: async (uri) =>
        texByName.get(path.basename(uri)) ?? new Uint8Array(),
    });
    assert.equal(report.issues.numErrors, 0, JSON.stringify(report.issues.messages));
    assert.equal(report.issues.numWarnings, 0, JSON.stringify(report.issues.messages));
  }
};

const testGltfExternalBufferUriAndMixedLod1 = async (): Promise<void> => {
  const wsDir = path.join(REPO_ROOT, 'showcase');
  const ws = fs.readFileSync(path.join(wsDir, '.ashfoxworkspace'), 'utf8');
  const files = walkFiles(wsDir, '').filter(
    (f) => !f.path.startsWith('dist/') && !f.path.startsWith('.ashfox'),
  );
  const compiledShowcase = compileDirectoryWorkspace(ws, files, loadStdLibs());
  assert.equal(compiledShowcase.ok, true);
  if (!compiledShowcase.ok) return;
  const prod = compiledShowcase.products.find(
    (p) => p.kind === 'model' && p.entry.entryName === 'red_fox',
  );
  assert.ok(prod && prod.kind === 'model');
  if (!prod || prod.kind !== 'model') return;
  const opened = openAssetProject({
    workspace: prod.workspace,
    entry: prod.entry,
    identity: { id: 'red_fox', revision: 'r1', createdAt: '2026-01-01T00:00:00.000Z' },
  });
  assert.equal(opened.ok, true);
  if (!opened.ok) return;
  const doc = opened.project.document;

  const gltfBundle = exportGltf(
    adaptProjectForExport(doc, { target: 'gltf', modelPath: 'red_fox' }),
    opened.project.build,
  );
  const gltfFile = gltfBundle.files.find((f) => f.path.endsWith('red_fox.gltf'));
  const binFile = gltfBundle.files.find((f) => f.path.endsWith('red_fox.bin'));
  assert.ok(gltfFile && gltfFile.kind === 'json');
  assert.ok(binFile && binFile.kind === 'binary');
  const parsed = JSON.parse(gltfFile.text) as GltfLodDocument;
  assert.equal(parsed.buffers?.[0]?.uri, 'red_fox.bin');
  assert.equal(parsed.buffers?.[0]?.byteLength, binFile.data.byteLength);

  const ext = new Map<string, Uint8Array>([['fox.bin', binFile.data]]);
  for (const tf of gltfBundle.files) {
    if (tf.kind === 'binary') ext.set(path.posix.basename(tf.path), tf.data);
  }
  const gltfReport = await validator.validateBytes(Buffer.from(gltfFile.text), {
    externalResourceFunction: async (uri) => ext.get(path.posix.basename(uri)) ?? new Uint8Array(),
  });
  assert.equal(gltfReport.issues.numErrors, 0, JSON.stringify(gltfReport.issues.messages));
  assert.equal(gltfReport.issues.numWarnings, 0, JSON.stringify(gltfReport.issues.messages));

  const largestCubeId = [...computeModelBoundsAndPartSizes(doc).parts.values()]
    .filter((p) => p.kind === 'cube')
    .sort((a, b) => b.volume - a.volume)[0]!.id;
  const sampleCube = doc.scene.nodes[largestCubeId]!;
  const staticCube = {
    ...structuredClone(sampleCube),
    id: 'static_pedestal',
    name: 'static_pedestal',
    parentId: null,
  };
  const hybridDoc = {
    ...structuredClone(doc),
    id: 'hybrid',
    scene: {
      ...structuredClone(doc.scene),
      roots: [...doc.scene.roots, staticCube.id],
      nodes: { ...structuredClone(doc.scene.nodes), [staticCube.id]: staticCube },
    },
  };
  const hybridBundle = exportGltf(
    adaptProjectForExport(hybridDoc, { target: 'gltf', modelPath: 'hybrid' }),
    opened.project.build,
  );
  const hybridFile = hybridBundle.files.find((f) => f.path.endsWith('hybrid.gltf'));
  assert.ok(hybridFile && hybridFile.kind === 'json');
  const hybridDocJson = JSON.parse(hybridFile.text) as GltfLodDocument;
  const lod0 = hybridDocJson.nodes.find((n) => n.name === 'hybrid_LOD0');
  const lod1 = hybridDocJson.nodes.find((n) => n.name === 'hybrid_LOD1');
  assert.ok(lod0 && lod1);
  const countMeshesInSubtree = (node: (typeof hybridDocJson.nodes)[number]): number =>
    (node.mesh !== undefined ? 1 : 0) +
    (node.children ?? []).reduce(
      (sum, ci) => sum + countMeshesInSubtree(hybridDocJson.nodes[ci]!),
      0,
    );
  assert.ok(countMeshesInSubtree(lod0) >= 2, 'LOD0 should include both skinned and static meshes');
  assert.ok(countMeshesInSubtree(lod1) >= 2, 'LOD1 should include both skinned and static meshes');
};

const main = async (): Promise<void> => {
  await testStructureThreeTierLod();
  testStairWedgeAndWindowGlowPreservation();
  await testCreatureModelsThreeTierLod();
  await testGltfExternalBufferUriAndMixedLod1();
  console.log('ashfox semantic lod tests ok');
};

const pending = main().catch((err) => {
  console.error(err);
  process.exit(1);
});
const bucket = (globalThis as { __ashfoxEngineTestPromises?: Promise<unknown>[] })
  .__ashfoxEngineTestPromises;
if (Array.isArray(bucket)) bucket.push(pending);
