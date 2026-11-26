import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import {
  compileDirectoryWorkspace,
  compileSpriteDocument,
  evaluateAssetQuality,
  evaluateSpriteQuality,
  evaluateStructureQuality,
  parseSpriteSource,
  type CompiledModel,
  type DirectoryFile,
  type ProjectDocument,
  type SpriteProduct,
} from '../../src/index';
import { analyzeAnatomy } from '../../src/audit/anatomy';
import { analyzeSceneGeometry, type AuditObb } from '../../src/audit/geometry';
import { analyzeRasterStats } from '../../src/audit/rasterStats';
import { analyzeSilhouettes, obbsTouchWithin } from '../../src/audit/silhouette';
import { canonicalJsonString } from '../../src/canonicalJson';
import { coherentValue } from '../../src/compiler/program/asset/texture/cluster';
import { rasterizeShapeMask } from '../../src/compiler/sprite/shapes';
import { snapshotExportData } from '../../src/export/pipeline/dataSnapshot';
import { deepFreeze } from '../../src/immutable';
import { lexProgramSource } from '../../src/project/program/syntax/lex';
import { sha256ByteDigest, sha256Digest } from '../../src/provenance/digest';
import { findFullyOccludedCubes } from '../../src/sceneOcclusion';
import { parseSurfaceColor } from '../../src/textures/color';
import {
  expandRampFive,
  generateHueShiftedRamp,
  hexToOklch,
  oklchToHex,
} from '../../src/textures/oklch';
import { rasterizeTextureSpec } from '../../src/textures/textureRecipe/raster';

const REPO_ROOT = path.resolve(__dirname, '../../../..');

const loadWorkspaceFiles = (dir: string, base = ''): DirectoryFile[] => {
  const out: DirectoryFile[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'dist' || entry.name === 'build' || entry.name === 'node_modules') continue;
    const rel = base ? `${base}/${entry.name}` : entry.name;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...loadWorkspaceFiles(full, rel));
    else if (entry.name.endsWith('.ashfox')) {
      out.push({ path: rel, source: fs.readFileSync(full, 'utf8') });
    }
  }
  return out;
};

const compileWorkspaceDir = (relDir: string) => {
  const dir = path.join(REPO_ROOT, relDir);
  const configText = fs.readFileSync(path.join(dir, '.ashfoxworkspace'), 'utf8');
  const files = loadWorkspaceFiles(dir);
  const compiled = compileDirectoryWorkspace(configText, files);
  assert.equal(compiled.ok, true, `expected ${relDir} to compile`);
  if (!compiled.ok) throw new Error(`compile failed: ${relDir}`);
  return compiled.products;
};

const toProjectDoc = (model: CompiledModel): ProjectDocument => ({
  schemaVersion: 1,
  id: model.id,
  name: model.name,
  revision: '0',
  settings: {
    forward: model.forward,
    textureResolution: {
      width: model.textureResolution[0],
      height: model.textureResolution[1],
    },
    surfacePixelDensity: 1,
    coordinateSystem: {
      up: 'y',
      handedness: 'right',
      unit: 'pixel',
      rotationUnit: 'degree',
      rotationOrder: 'xyz',
    },
  },
  scene: model.scene,
  textures: model.textures,
  animations: model.animations,
  createdAt: '',
  updatedAt: '',
});

const referenceCanonicalJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(referenceCanonicalJson).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    const rec = value as Record<string, unknown>;
    return `{${Object.keys(rec)
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
      .map((k) => `${JSON.stringify(k)}:${referenceCanonicalJson(rec[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'undefined';
};

const referenceParseColor = (value: string) => {
  const m = /^#([0-9a-f]{6})$/i.exec(value);
  if (!m) throw new RangeError('Surface colors must use exactly six hexadecimal digits (#rrggbb).');
  const hex = m[1]!;
  return {
    r: Number.parseInt(hex.slice(0, 2), 16),
    g: Number.parseInt(hex.slice(2, 4), 16),
    b: Number.parseInt(hex.slice(4, 6), 16),
  };
};

const referenceSha256 = (bytes: Uint8Array): string =>
  `sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}`;

const verifyDigestAndCanonicalJson = (griffin: CompiledModel): string => {
  const samples = [
    '',
    'a',
    'abc',
    'a'.repeat(55),
    'a'.repeat(56),
    'a'.repeat(64),
    'a'.repeat(128),
    'a'.repeat(5000),
    'ashfox-한글-😀-key',
    'lone-\ud800-surrogate',
  ];
  for (const s of samples) {
    const expected = referenceSha256(Buffer.from(s, 'utf8'));
    assert.equal(sha256Digest(s), expected);
    assert.equal(sha256ByteDigest(Buffer.from(s, 'utf8')), expected);
    assert.equal(sha256ByteDigest(Array.from(Buffer.from(s, 'utf8'))), expected);
  }
  const edgePayload = {
    'z"k': [1, -0, true, false, null, 'hi'],
    'a\\b': { nested: [], empty: {}, undef: [undefined] },
    '\nctrl': 'ok',
  };
  assert.equal(canonicalJsonString(edgePayload), referenceCanonicalJson(edgePayload));
  const modelJson = canonicalJsonString(griffin);
  assert.equal(modelJson, referenceCanonicalJson(griffin));
  const modelDigest = referenceSha256(Buffer.from(modelJson, 'utf8'));
  assert.equal(sha256Digest(modelJson), modelDigest);
  assert.equal(sha256ByteDigest(Buffer.from(modelJson, 'utf8')), modelDigest);
  return modelJson;
};

const verifyTexturesAndColors = (griffin: CompiledModel): void => {
  for (const hex of ['#000000', '#FFFFFF', '#5a657a', '#ff7b00', '#12AbEf']) {
    assert.deepEqual(parseSurfaceColor(hex), referenceParseColor(hex));
    const oklch = hexToOklch(hex);
    const roundtrip = oklchToHex(oklch);
    assert.match(roundtrip, /^#[0-9a-f]{6}$/);
  }
  assert.throws(() => parseSurfaceColor('#12345'), RangeError);
  assert.throws(() => parseSurfaceColor('#12345g'), RangeError);
  assert.throws(() => parseSurfaceColor('1234567'), RangeError);
  const ramp3 = generateHueShiftedRamp('#7b93a8', 'metal');
  assert.equal(expandRampFive(ramp3).length, 5);

  const firstTex = Object.values(griffin.textures)[0]!;
  if (firstTex.raster) {
    const uncachedA = rasterizeTextureSpec(firstTex.width, firstTex.height, {
      background: firstTex.raster.background,
      backgroundAlpha: firstTex.raster.backgroundAlpha,
      canvasDetails: firstTex.raster.canvasDetails,
      alphaMasks: firstTex.raster.alphaMasks,
    });
    const cachedB = rasterizeTextureSpec(firstTex.width, firstTex.height, firstTex.raster);
    assert.deepEqual(uncachedA.rgba.copy(), cachedB.rgba.copy());
  }
  const v = coherentValue([7, 13, 5], [3, 3, 3], 42, 211);
  assert.ok(v >= 0 && v <= 0xffffffff);
};

const verifyCreatureAuditAndOcclusion = (models: readonly CompiledModel[]): void => {
  for (const model of models) {
    const occluded = findFullyOccludedCubes(toProjectDoc(model));
    assert.ok(Array.isArray(occluded));
    const scene = analyzeSceneGeometry(model.scene, model.textures);
    const anatomy = analyzeAnatomy(scene);
    const raster = analyzeRasterStats(scene, model.textures);
    const silhouettes = analyzeSilhouettes(scene.obbs, scene.worldMin, scene.worldMax);
    assert.ok(scene.obbs.length > 0);
    assert.ok(anatomy.structuralObbs.length > 0);
    assert.ok(raster.allFacesCovered);
    assert.ok(silhouettes.avgFillRatio > 0 && silhouettes.avgFillRatio <= 1);
    const reportA = evaluateAssetQuality({ model });
    const reportB = evaluateAssetQuality({ model });
    assert.deepEqual(reportA, reportB);
    assert.equal(reportA.pillars.length, 3);
    assert.ok(reportA.score > 0 && reportA.hardGates.length > 0);
  }
  const obbA: AuditObb = {
    nodeId: 'a',
    parentId: null,
    center: [0, 1, 0],
    half: [1, 1, 1],
    ax: [1, 0, 0],
    ay: [0, 1, 0],
    az: [0, 0, 1],
    corners: [],
    aabbMin: [-1, 0, -1],
    aabbMax: [1, 2, 1],
    volume: 8,
    angled: false,
    isPlane: false,
    solidPlane: false,
    opaque: true,
  };
  const obbB: AuditObb = {
    ...obbA,
    nodeId: 'b',
    center: [1.5, 1, 0],
    aabbMin: [0.5, 0, -1],
    aabbMax: [2.5, 2, 1],
  };
  const obbC: AuditObb = {
    ...obbA,
    nodeId: 'c',
    center: [5, 1, 0],
    aabbMin: [4, 0, -1],
    aabbMax: [6, 2, 1],
  };
  assert.equal(obbsTouchWithin(obbA, obbB, 0.75), true);
  assert.equal(obbsTouchWithin(obbA, obbC, 0.75), false);
};

const verifySnapshotLexerAndSprites = (griffin: CompiledModel): void => {
  const snapped = snapshotExportData(griffin, 'doc', 'snapshot failed');
  assert.equal(canonicalJsonString(snapped), canonicalJsonString(griffin));
  assert.equal(Object.isFrozen(snapped), true);
  assert.notEqual(snapped, griffin);
  const frozen = deepFreeze({ a: [1, { b: 2 }] });
  assert.equal(Object.isFrozen(frozen.a[1]), true);

  const griffinMain = fs.readFileSync(
    path.join(REPO_ROOT, 'examples/griffin/workbench/main.ashfox'),
    'utf8',
  );
  const lexed = lexProgramSource(griffinMain);
  assert.equal(lexed.diagnostics.length, 0);
  assert.equal(lexed.tokens[0]?.value, 'ashfox-model');
  const badLex = lexProgramSource('ashfox-model 1\n/* unclosed');
  assert.ok(badLex.diagnostics.some((d) => d.code === 'program.unclosed-comment'));

  const itemProducts = compileWorkspaceDir('examples/items').filter(
    (p): p is Extract<typeof p, { kind: 'sprite' }> => p.kind === 'sprite',
  );
  assert.ok(itemProducts.length >= 12);
  for (const item of itemProducts) {
    const audit = evaluateSpriteQuality(item.sprite);
    assert.equal(audit.passed, true, `${item.entry.entryName} sprite audit`);
  }
  const polyMask = rasterizeShapeMask(
    {
      kind: 'polygon',
      points: [
        [4, 4],
        [12, 4],
        [12, 12],
        [4, 12],
      ],
    },
    16,
    16,
    'x',
  );
  assert.ok(polyMask.some((v) => v === 1));
  const spriteSrc = `ashfox-model 1
sprite blade_v2 {
  export material steel { ramp { mode = auto; base = #7b93a8; preset = metal; } }
  export material gold { ramp { mode = auto; base = #d8a642; preset = warm; } }
  profile = item;
  canvas = (32px, 32px);
  palette { gem = #4cc9f0; }
  shape blade_body {
    shape { kind = polygon; points = [(24, 4), (27, 4), (27, 7), (12, 22), (9, 19)]; }
    material = steel;
    shade { form = bevel; light = top_left; contrast = 2; specular = 2; axis = [(9, 22), (27, 4)]; }
    grain { mode = directional; axis = diagonal; amount = 1; seed = 11; }
  }
  shape guard {
    shape { kind = capsule; x1 = 6; y1 = 18; x2 = 14; y2 = 26; radius = 1.6; }
    material = gold;
    shade { form = round; light = top_left; contrast = 2; specular = 1; }
  }
  outline edge { mode = sel_out; strength = 2; innerRim = true; }
}`;
  const parsed = parseSpriteSource(spriteSrc, 'blade_v2.ashfox');
  const spriteDoc = {
    masks: parsed.masks,
    materials: parsed.materials,
    stamps: parsed.stamps,
    item: parsed.item!,
  };
  const builtA = compileSpriteDocument(spriteDoc, 'blade_v2.ashfox');
  const builtB = compileSpriteDocument(spriteDoc, 'blade_v2.ashfox');
  assert.equal(builtA.ok, true, builtA.ok ? '' : JSON.stringify(builtA.diagnostics));
  assert.equal(builtB.ok, true, builtB.ok ? '' : JSON.stringify(builtB.diagnostics));
  if (!builtA.ok || !builtB.ok) throw new Error('expected sprite build');
  const prodA: SpriteProduct = builtA.products[0]!;
  const prodB: SpriteProduct = builtB.products[0]!;
  assert.deepEqual(prodA.png, prodB.png);
  assert.equal(prodA.receipt.productHash, prodB.receipt.productHash);
  const spriteAuditA = evaluateSpriteQuality(prodA);
  const spriteAuditB = evaluateSpriteQuality(prodB);
  assert.deepEqual(spriteAuditA, spriteAuditB);
  assert.ok(spriteAuditA.score > 0 && spriteAuditA.pillars.length === 3);
};

const verifyStructureAudit = (): void => {
  const structs = compileWorkspaceDir('examples/structure').filter(
    (p): p is Extract<typeof p, { kind: 'structure' }> => p.kind === 'structure',
  );
  const vc = structs.find((p) => p.entry.entryName === 'village_compound')?.structure;
  assert.ok(vc !== undefined);
  const report = evaluateStructureQuality(
    vc.grid,
    vc.audit.metrics.prefabUses,
    vc.lighting,
    vc.bakedMesh,
  );
  assert.deepEqual(report, vc.audit);
  assert.equal(report.passed, true);
  assert.ok(report.score >= 75);
};

const bench = (fn: () => void, iterations: number): number => {
  for (let i = 0; i < 3; i += 1) fn();
  const t0 = performance.now();
  for (let i = 0; i < iterations; i += 1) fn();
  return Number(((performance.now() - t0) / iterations).toFixed(3));
};

const runBenchmarks = (griffin: CompiledModel): void => {
  const modelJson = canonicalJsonString(griffin);
  const modelBytes = Buffer.from(modelJson, 'utf8');
  const griffinSrc = fs.readFileSync(
    path.join(REPO_ROOT, 'examples/griffin/workbench/main.ashfox'),
    'utf8',
  );
  const lexAfter = bench(() => lexProgramSource(griffinSrc), 20);
  const canonBefore = bench(() => referenceCanonicalJson(griffin), 10);
  const canonAfter = bench(() => canonicalJsonString(griffin), 10);
  const shaAfter = bench(() => sha256ByteDigest(modelBytes), 15);
  const auditAfter = bench(() => evaluateAssetQuality({ model: griffin }), 15);
  const griffinDoc = toProjectDoc(griffin);
  const occAfter = bench(() => findFullyOccludedCubes(griffinDoc), 20);
  assert.ok(canonAfter > 0 && canonBefore > 0 && lexAfter > 0 && shaAfter > 0);
  assert.ok(auditAfter > 0 && occAfter >= 0);
  console.log(
    `perfhotloop ok | canon ${canonBefore}->${canonAfter}ms | sha ${shaAfter}ms | audit ${auditAfter}ms | occ ${occAfter}ms | lex ${lexAfter}ms`,
  );
};

const main = (): void => {
  const creatureProducts = compileWorkspaceDir('examples/shared-creatures').filter(
    (p): p is Extract<typeof p, { kind: 'model' }> => p.kind === 'model',
  );
  const models = creatureProducts.map((p) => p.model);
  const griffin = creatureProducts.find((p) => p.entry.entryName === 'griffin')!.model;
  verifyDigestAndCanonicalJson(griffin);
  verifyTexturesAndColors(griffin);
  verifyCreatureAuditAndOcclusion(models);
  verifySnapshotLexerAndSprites(griffin);
  verifyStructureAudit();
  runBenchmarks(griffin);
};

main();
