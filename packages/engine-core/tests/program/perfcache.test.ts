import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  canonicalJsonString,
  compileDirectoryWorkspace,
  evaluateStructureQuality,
  exportStructureGltfResolved,
  parseStructureSource,
  type DirectoryFile,
  type DirectoryProduct,
  type StructureSourceUnit,
} from '../../src/index';
import { compileDirectoryWorkspace as compileDirectoryWithMode } from '../../src/compiler/directory/compile';
import { buildStructureTileTextures } from '../../src/compiler/structure/atlas';
import type { EvaluatedStructureResult } from '../../src/compiler/structure/contract';
import { evaluateStructure } from '../../src/compiler/structure/eval';

const REPO_ROOT = path.resolve(__dirname, '../../../..');

const walkWorkspaceFiles = (rootDir: string, base = ''): DirectoryFile[] => {
  const out: DirectoryFile[] = [];
  for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
    if (entry.name === 'dist' || entry.name === 'build') continue;
    const rel = base ? `${base}/${entry.name}` : entry.name;
    const full = path.join(rootDir, entry.name);
    if (entry.isDirectory()) out.push(...walkWorkspaceFiles(full, rel));
    else if (entry.name.endsWith('.ashfox')) {
      out.push({ path: rel, source: fs.readFileSync(full, 'utf8') });
    }
  }
  return out;
};

const loadWorkspace = (
  relDir: string,
): { readonly cfg: string; readonly files: readonly DirectoryFile[] } => {
  const dir = path.join(REPO_ROOT, relDir);
  return {
    cfg: fs.readFileSync(path.join(dir, '.ashfoxworkspace'), 'utf8'),
    files: walkWorkspaceFiles(dir),
  };
};

const assertTypedEqual = (
  left: Uint8Array | Int32Array,
  right: Uint8Array | Int32Array,
  label: string,
): void => {
  assert.equal(left.length, right.length, `${label} length`);
  assert.equal(
    Buffer.compare(
      Buffer.from(left.buffer, left.byteOffset, left.byteLength),
      Buffer.from(right.buffer, right.byteOffset, right.byteLength),
    ),
    0,
    `${label} bytes`,
  );
};

const assertStructureBitExact = async (
  left: Extract<DirectoryProduct, { readonly kind: 'structure' }>,
  right: Extract<DirectoryProduct, { readonly kind: 'structure' }>,
  buildKey: string,
): Promise<void> => {
  const id = left.entry.entryName;
  assertTypedEqual(left.structure.nbt, right.structure.nbt, `${id}.nbt`);
  assertTypedEqual(left.structure.grid.voxels, right.structure.grid.voxels, `${id}.voxels`);
  assertTypedEqual(left.structure.lighting.sky, right.structure.lighting.sky, `${id}.sky`);
  assertTypedEqual(left.structure.lighting.blockR, right.structure.lighting.blockR, `${id}.blockR`);
  assertTypedEqual(left.structure.lighting.blockG, right.structure.lighting.blockG, `${id}.blockG`);
  assertTypedEqual(left.structure.lighting.blockB, right.structure.lighting.blockB, `${id}.blockB`);
  assert.equal(
    canonicalJsonString(left.structure.grid),
    canonicalJsonString(right.structure.grid),
    `${id}.grid`,
  );
  assert.equal(
    canonicalJsonString(left.structure.bakedMesh),
    canonicalJsonString(right.structure.bakedMesh),
    `${id}.bakedMesh`,
  );
  assert.equal(
    canonicalJsonString(left.structure.playableMeta),
    canonicalJsonString(right.structure.playableMeta),
    `${id}.playableMeta`,
  );
  assert.equal(
    canonicalJsonString(left.structure.audit),
    canonicalJsonString(right.structure.audit),
    `${id}.audit`,
  );
  assert.equal(
    canonicalJsonString(left.structure.customModels),
    canonicalJsonString(right.structure.customModels),
    `${id}.customModels`,
  );
  const glbA = await exportStructureGltfResolved(left.structure, id, buildKey, {
    encoding: 'portable',
  });
  const glbB = await exportStructureGltfResolved(right.structure, id, buildKey, {
    encoding: 'portable',
  });
  assert.equal(glbA.files.length, glbB.files.length, `${id}.glbFileCount`);
  for (let i = 0; i < glbA.files.length; i += 1) {
    const fa = glbA.files[i]!;
    const fb = glbB.files[i]!;
    assert.equal(fa.path, fb.path);
    assert.equal(fa.kind, fb.kind);
    if (fa.kind === 'binary' && fb.kind === 'binary') {
      assertTypedEqual(fa.data, fb.data, `${id}.${fa.path}`);
    } else if (fa.kind === 'json' && fb.kind === 'json') {
      assert.equal(canonicalJsonString(fa.data), canonicalJsonString(fb.data), `${id}.${fa.path}`);
    }
  }
};

const assertSpriteBitExact = (
  left: Extract<DirectoryProduct, { readonly kind: 'sprite' }>,
  right: Extract<DirectoryProduct, { readonly kind: 'sprite' }>,
): void => {
  const id = left.entry.entryName;
  assertTypedEqual(left.sprite.png, right.sprite.png, `${id}.png`);
  assert.equal(
    canonicalJsonString(left.sprite.receipt),
    canonicalJsonString(right.sprite.receipt),
    `${id}.receipt`,
  );
  assertTypedEqual(left.sprite.raster.rgba.copy(), right.sprite.raster.rgba.copy(), `${id}.rgba`);
  assertTypedEqual(
    left.sprite.stages.silhouette.rgba.copy(),
    right.sprite.stages.silhouette.rgba.copy(),
    `${id}.silhouette`,
  );
  assertTypedEqual(
    left.sprite.stages.shade.rgba.copy(),
    right.sprite.stages.shade.rgba.copy(),
    `${id}.shade`,
  );
  assertTypedEqual(
    left.sprite.stages.grain.rgba.copy(),
    right.sprite.stages.grain.rgba.copy(),
    `${id}.grain`,
  );
};

const verifyWorkspaceBitExact = async (relDir: string): Promise<void> => {
  const { cfg, files } = loadWorkspace(relDir);
  const uncached = compileDirectoryWithMode(cfg, files, evaluateStructureQuality, false);
  const cached = compileDirectoryWorkspace(cfg, files);
  assert.equal(uncached.ok, true, `${relDir} uncached ok`);
  assert.equal(cached.ok, true, `${relDir} cached ok`);
  if (!uncached.ok || !cached.ok) return;

  assert.equal(cached.sourceHash, uncached.sourceHash, `${relDir}.sourceHash`);
  assert.equal(cached.buildKey, uncached.buildKey, `${relDir}.buildKey`);
  assert.equal(
    canonicalJsonString(cached.config),
    canonicalJsonString(uncached.config),
    `${relDir}.config`,
  );
  assert.equal(cached.products.length, uncached.products.length, `${relDir}.products.length`);

  for (let i = 0; i < uncached.products.length; i += 1) {
    const a: DirectoryProduct = uncached.products[i]!;
    const b: DirectoryProduct = cached.products[i]!;
    assert.equal(a.kind, b.kind);
    assert.equal(a.sourcePath, b.sourcePath);
    assert.equal(canonicalJsonString(a.entry), canonicalJsonString(b.entry));
    assert.equal(canonicalJsonString(a.declarations), canonicalJsonString(b.declarations));
    if (a.kind === 'structure' && b.kind === 'structure') {
      await assertStructureBitExact(a, b, cached.buildKey);
    } else if (a.kind === 'sprite' && b.kind === 'sprite') {
      assertSpriteBitExact(a, b);
    } else if (a.kind === 'model' && b.kind === 'model') {
      assert.equal(canonicalJsonString(a.model), canonicalJsonString(b.model));
    }
  }
};

const verifyEvalAndTileCacheIsolation = (): void => {
  const { files } = loadWorkspace('examples/structure');
  const units = new Map<string, StructureSourceUnit>();
  for (const f of files) {
    if (!f.path.includes('models/props')) {
      units.set(f.path, parseStructureSource(f.source, f.path));
    }
  }
  const rel = (owner: string, spec: string): string =>
    path.posix.normalize(path.posix.join(path.posix.dirname(owner), spec));

  const gridCache = new Map<string, EvaluatedStructureResult>();
  const compoundEntry = 'assets/structures/village_compound.ashfox';
  const uncachedCompound = evaluateStructure(compoundEntry, units, rel);
  const cachedCompound = evaluateStructure(compoundEntry, units, rel, gridCache);
  assert.equal(cachedCompound.prefabUses, uncachedCompound.prefabUses);
  assert.equal(
    canonicalJsonString(cachedCompound.grid),
    canonicalJsonString(uncachedCompound.grid),
  );
  assert.ok(gridCache.has('assets/structures/tavern.ashfox'));
  assert.ok(gridCache.has('assets/structures/blacksmith.ashfox'));
  assert.ok(gridCache.has('assets/structures/medieval_cottage.ashfox'));
  assert.ok(gridCache.has('assets/structures/watchtower.ashfox'));
  const cachedTavern = gridCache.get('assets/structures/tavern.ashfox')!;
  assert.equal(Object.isFrozen(cachedTavern), true);
  assert.equal(Object.isFrozen(cachedTavern.grid), true);
  assert.equal(Object.isFrozen(cachedTavern.grid.states), true);

  const cachedTavernDirect = evaluateStructure(
    'assets/structures/tavern.ashfox',
    units,
    rel,
    gridCache,
  );
  assert.equal(cachedTavernDirect, cachedTavern);

  const tileCache = new Map<string, ReturnType<typeof buildStructureTileTextures>[string]>();
  const reqs = [
    { layer: 'opaque' as const, tileId: 'timber_trim' },
    { layer: 'emissive' as const, tileId: 'window_glow' },
    { layer: 'opaque' as const, tileId: 'oak_planks' },
  ];
  const uncached101 = buildStructureTileTextures(reqs, 2, 101);
  const uncached202 = buildStructureTileTextures(reqs, 2, 202);
  const cached101 = buildStructureTileTextures(reqs, 2, 101, tileCache);
  const cached202 = buildStructureTileTextures(reqs, 2, 202, tileCache);
  assert.equal(canonicalJsonString(cached101), canonicalJsonString(uncached101));
  assert.equal(canonicalJsonString(cached202), canonicalJsonString(uncached202));
  assert.equal(cached101.struct_opaque_timber_trim, cached202.struct_opaque_timber_trim);
  assert.equal(cached101.struct_emissive_window_glow, cached202.struct_emissive_window_glow);
  assert.notEqual(cached101.struct_opaque_oak_planks, cached202.struct_opaque_oak_planks);
};

const medianMs = (fn: () => void, iterations = 5): number => {
  fn();
  const times: number[] = [];
  for (let i = 0; i < iterations; i += 1) {
    const t0 = performance.now();
    fn();
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  return times[Math.floor(times.length / 2)]!;
};

const runBenchmarks = (): void => {
  const rows: { workspace: string; beforeMs: number; afterMs: number; speedup: string }[] = [];
  for (const ws of ['examples/structure', 'examples/shared-creatures', 'examples/items']) {
    const { cfg, files } = loadWorkspace(ws);
    const beforeMs = medianMs(() => {
      const res = compileDirectoryWithMode(cfg, files, evaluateStructureQuality, false);
      assert.equal(res.ok, true);
    });
    const afterMs = medianMs(() => {
      const res = compileDirectoryWorkspace(cfg, files);
      assert.equal(res.ok, true);
    });
    rows.push({
      workspace: ws,
      beforeMs: Number(beforeMs.toFixed(2)),
      afterMs: Number(afterMs.toFixed(2)),
      speedup: `${(beforeMs / afterMs).toFixed(2)}x`,
    });
  }
  console.log('perfcache benchmark (median ms):', JSON.stringify(rows));
  assert.ok(rows[0]!.afterMs < rows[0]!.beforeMs, 'examples/structure cached must be faster');
};

const main = async (): Promise<void> => {
  await verifyWorkspaceBitExact('examples/structure');
  await verifyWorkspaceBitExact('examples/shared-creatures');
  await verifyWorkspaceBitExact('examples/items');
  verifyEvalAndTileCacheIsolation();
  runBenchmarks();
  console.log('ashfox perfcache tests ok');
};

const pending = main().catch((err) => {
  console.error(err);
  process.exit(1);
});
const bucket = (globalThis as { __ashfoxEngineTestPromises?: Promise<unknown>[] })
  .__ashfoxEngineTestPromises;
if (Array.isArray(bucket)) bucket.push(pending);
