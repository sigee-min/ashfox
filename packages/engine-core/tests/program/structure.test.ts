import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  StructureInputError,
  buildStructureDocument,
  compileDirectoryWorkspace,
  compileStructureUnits,
  decodeStructureNbt,
  exportStructureGltfResolved,
  parseStructureSource,
  type CompiledModel,
  type DirectoryFile,
  type StructureSourceUnit,
} from '../../src/index';

const validator = require('gltf-validator');
const REPO_ROOT = path.resolve(__dirname, '../../../..');

const relativePosix = (owner: string, spec: string): string =>
  path.posix.normalize(path.posix.join(path.posix.dirname(owner), spec));

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

const TEST_MOD = `ashfox-model 1
module deco {
  palette {
    plank = "minecraft:oak_planks";
    bed_h = "minecraft:red_bed[facing=north,part=head]";
    bed_f = "minecraft:red_bed[facing=north,part=foot]";
    chest = "minecraft:chest[facing=north]";
    unused_in_cottage = "minecraft:blue_carpet";
  }
  export prefab SleepSet {
    layer y = 0 origin = (0, 0) {
      "HF"
      "CP"
    } map {
      H = bed_h;
      F = bed_f;
      C = chest;
      P = plank;
    };
  }
  export prefab ExtraRug {
    set at = (0, 0, 0) block = unused_in_cottage;
  }
}
`;

const LOW_LEVEL_HUT = `ashfox-model 1
structure test_hut {
  import "./deco.ashfox" as deco;
  size = (9, 9, 9);
  data_version = 3955;
  palette {
    cobble = "minecraft:cobblestone";
    brick = "minecraft:stone_bricks";
    stair = "minecraft:spruce_stairs";
    ridge = "minecraft:spruce_slab[type=bottom]";
    torch = "minecraft:torch";
    door_lo = "minecraft:oak_door[facing=north,half=lower,hinge=left,open=false]";
    door_hi = "minecraft:oak_door[facing=north,half=upper,hinge=left,open=false]";
  }
  build {
    box from = (1, 0, 1) to = (7, 0, 7) block = cobble;
    hollow from = (1, 1, 1) to = (7, 5, 7) block = brick;
    carve from = (2, 1, 2) to = (6, 5, 6);
    set at = (4, 1, 7) block = door_lo;
    set at = (4, 2, 7) block = door_hi;
    set at = (3, 1, 3) block = torch;
    roof style = gable axis = z from = (1, 5, 1) to = (7, 8, 7) stair = stair ridge = ridge gable = brick;
    place deco.SleepSet at = (2, 1, 2) rotate = 90;
  }
}
`;

const testParserAndSemanticDsl = (): void => {
  const unit = parseStructureSource(LOW_LEVEL_HUT, 'hut.ashfox');
  assert.equal(unit.kind, 'structure');
  assert.equal(unit.id, 'test_hut');
  assert.deepEqual(unit.size, [9, 9, 9]);
  assert.equal(unit.density, 2);

  assert.throws(
    () => parseStructureSource('ashfox-model 1\nstructure bad { size = (1, 1); build {} }', 'bad'),
    StructureInputError,
  );

  const semanticSrc = fs.readFileSync(
    path.join(REPO_ROOT, 'examples/structure/assets/structures/medieval_cottage.ashfox'),
    'utf8',
  );
  const sem = parseStructureSource(semanticSrc, 'medieval_cottage.ashfox');
  assert.equal(sem.kind, 'structure');
  assert.equal(sem.density, 2);
  assert.equal(sem.seed, 101);
  assert.equal(sem.params.w, 15);
  assert.equal(sem.palette.cobble?.kind, 'mix');
  assert.ok(sem.ops.some((op) => op.op === 'floor'));
  assert.ok(sem.ops.some((op) => op.op === 'staircase'));
  assert.ok(sem.ops.some((op) => op.op === 'roof'));
  assert.ok(sem.ops.some((op) => op.op === 'weathering'));
  assert.ok(sem.ops.some((op) => op.op === 'socket'));
};

const testLowLevelGridAndHonestBareAudit = (): void => {
  const units = new Map<string, StructureSourceUnit>([
    ['hut.ashfox', parseStructureSource(LOW_LEVEL_HUT, 'hut.ashfox')],
    ['deco.ashfox', parseStructureSource(TEST_MOD, 'deco.ashfox')],
  ]);
  const product = compileStructureUnits('hut.ashfox', units, {}, relativePosix);
  assert.equal(product.audit.passed, false);
  assert.ok(product.audit.score < 70);
  assert.ok(product.grid.states.includes('minecraft:chest[facing=east]'));
  assert.ok(product.grid.states.includes('minecraft:red_bed[facing=east,part=head]'));

  const decoded = decodeStructureNbt(product.nbt);
  assert.equal(decoded.dataVersion, 3955);
  assert.deepEqual(decoded.size, [9, 9, 9]);
  const center = decoded.blocks.find((b) => b.pos[0] === 4 && b.pos[1] === 2 && b.pos[2] === 4);
  assert.ok(center);
  assert.equal(decoded.palette[center.state]?.Name, 'minecraft:air');
};

const compileRunePillarFixture = (): CompiledModel => {
  const fixturePath = path.join(
    REPO_ROOT,
    'examples/structure/assets/models/props/rune_pillar.ashfox',
  );
  const fixtureSrc = fs.readFileSync(fixturePath, 'utf8');
  const modelRes = compileDirectoryWorkspace(
    JSON.stringify({
      format: 'ashfox-workspace',
      version: 2,
      name: 'p',
      packages: [
        {
          name: 'p',
          root: 'assets/models',
          manifest: {
            format: 'ashfox-package',
            version: 1,
            entries: [{ name: 'rune_pillar', path: 'rune_pillar.ashfox' }],
            modules: [],
            dependencies: [],
          },
        },
      ],
      include: ['assets/**/*.ashfox'],
      ignore: [],
      build: { directory: 'build' },
      exports: [],
    }),
    [{ path: 'assets/models/rune_pillar.ashfox', source: fixtureSrc }],
  );
  assert.equal(modelRes.ok, true);
  return (modelRes.products[0] as Extract<(typeof modelRes.products)[number], { kind: 'model' }>)
    .model;
};

const validateGltfBinary = async (
  bytes: Uint8Array,
  requireExt: readonly string[],
): Promise<Record<string, unknown>> => {
  const magic = Buffer.from(bytes).subarray(0, 4).toString('utf8');
  assert.equal(magic, 'glTF');
  const jsonLen = Buffer.from(bytes).readUInt32LE(12);
  const gltf = JSON.parse(Buffer.from(bytes.subarray(20, 20 + jsonLen)).toString('utf8')) as {
    extensionsRequired?: string[];
  };
  assert.deepEqual(gltf.extensionsRequired ?? [], requireExt);
  const report = await validator.validateBytes(bytes, {
    externalResourceFunction: async () => {
      throw new Error('GLB must be self-contained');
    },
  });
  assert.equal(report.issues.numErrors, 0, JSON.stringify(report.issues));
  return gltf;
};

const testBakedGreedyInstancingAndHygiene = async (): Promise<void> => {
  const unusedPalette = `ashfox-model 1
structure s {
  size = (3, 3, 3);
  palette { a = "minecraft:stone"; b = "minecraft:cobblestone"; }
  build { box from = (0, 0, 0) to = (2, 0, 2) block = a; }
}`;
  assert.throws(
    () =>
      compileStructureUnits(
        'u.ashfox',
        new Map([['u.ashfox', parseStructureSource(unusedPalette, 'u.ashfox')]]),
        {},
        relativePosix,
      ),
    (err: unknown) =>
      err instanceof StructureInputError && err.detail.code === 'structure.unused-palette',
  );

  const pillarModel = compileRunePillarFixture();
  const customSrc = `ashfox-model 1
structure s {
  import "./rune_pillar.ashfox" as rp;
  size = (7, 7, 7);
  seed = 12;
  density = 2;
  palette {
    stone = "minecraft:stone_bricks";
    stair = "minecraft:oak_stairs";
    fence = "minecraft:oak_fence";
    pillar = asset rp as "minecraft:chiseled_stone_bricks";
  }
  build {
    box from = (0, 0, 0) to = (6, 0, 6) block = stone;
    walls from = (0, 1, 0) to = (6, 4, 6) block = stone;
    set at = (1, 1, 1) block = pillar facing = north;
    set at = (5, 1, 1) block = pillar facing = east;
    set at = (1, 1, 5) block = pillar facing = south;
    set at = (1, 1, 3) block = fence;
    set at = (2, 1, 3) block = fence;
    set at = (2, 2, 2) block = stair facing = east;
    set at = (2, 2, 3) block = stair facing = south;
    socket gate kind = road at = (3, 0, 6) normal = south pool = "v:road" target = "join";
  }
}`;
  const built = compileStructureUnits(
    's.ashfox',
    new Map([['s.ashfox', parseStructureSource(customSrc, 's.ashfox')]]),
    { 's.ashfox#rp': pillarModel },
    relativePosix,
  );
  assert.ok(built.bakedMesh.rawFaceCount > built.bakedMesh.mergedQuadCount);
  assert.equal(built.bakedMesh.instances.length, 3);
  assert.ok(
    built.grid.states.some((s) => s.includes('minecraft:oak_fence') && s.includes('east=true')),
  );
  assert.ok(
    built.grid.states.some((s) => s.includes('shape=outer_') || s.includes('shape=inner_')),
  );

  const nbt = decodeStructureNbt(built.nbt);
  assert.ok(nbt.palette.some((e) => e.Name === 'minecraft:jigsaw'));
  assert.ok(nbt.blocks.some((b) => nbt.palette[b.state]?.Name === 'minecraft:jigsaw'));

  const fullDoc = buildStructureDocument(built.grid, { 's.ashfox#rp': pillarModel });
  const cutDoc = buildStructureDocument(
    built.grid,
    { 's.ashfox#rp': pillarModel },
    { cutawayY: 2 },
  );
  assert.ok(Object.keys(cutDoc.scene.nodes).length < Object.keys(fullDoc.scene.nodes).length);
  const stubNodes = Object.values(built.document.scene.nodes);
  assert.ok(stubNodes.length <= 8);
  assert.ok(stubNodes.every((n) => n.kind === 'bone'));
  for (const tex of Object.values(built.bakedMesh.textures)) {
    assert.ok(
      tex.raster && Object.isFrozen(tex.raster) && Object.isFrozen(tex.raster.canvasDetails),
    );
  }

  for (const [enc, req] of [
    ['portable', []],
    ['optimized', ['KHR_mesh_quantization', 'EXT_meshopt_compression']],
  ] as const) {
    const bundle = await exportStructureGltfResolved(built, 's', 'test-key', { encoding: enc });
    const glbFile = bundle.files.find((f) => f.path === 's.glb');
    const metaFile = bundle.files.find((f) => f.path === 's.structure.json');
    assert.ok(glbFile?.kind === 'binary' && metaFile?.kind === 'json');
    const gltf = (await validateGltfBinary(glbFile.data, req)) as {
      meshes: unknown[];
      nodes: { mesh?: number }[];
    };
    const propMeshCounts = new Map<number, number>();
    for (const node of gltf.nodes) {
      if (node.mesh !== undefined)
        propMeshCounts.set(node.mesh, (propMeshCounts.get(node.mesh) ?? 0) + 1);
    }
    assert.ok([...propMeshCounts.values()].some((count) => count >= 3));
  }
};

const testCanonicalWorkspaceShowcases = (): void => {
  const dir = path.join(REPO_ROOT, 'examples/structure');
  const cfg = fs.readFileSync(path.join(dir, '.ashfoxworkspace'), 'utf8');
  const compiled = compileDirectoryWorkspace(cfg, walkWorkspaceFiles(dir));
  if (!compiled.ok) throw new Error(compiled.diagnostics.map((d) => d.message).join('\n'));
  assert.equal(compiled.products.length, 5);
  for (const product of compiled.products) {
    assert.equal(product.kind, 'structure');
    if (product.kind !== 'structure') continue;
    assert.equal(product.structure.audit.passed, true, product.entry.entryName);
    assert.ok(product.structure.audit.score >= 85, product.entry.entryName);
    assert.equal(product.structure.audit.grade, 'excellent');
    assert.ok(product.structure.bakedMesh.batches.length > 0);
    assert.ok(product.structure.playableMeta.colliders.length > 0);
    assert.ok(product.structure.playableMeta.zones.length > 0);
  }
  const byName = new Map(compiled.products.map((p) => [p.entry.entryName, p] as const));
  const cottage = byName.get('medieval_cottage')!;
  const tavern = byName.get('tavern')!;
  const smith = byName.get('blacksmith')!;
  const tower = byName.get('watchtower')!;
  if (cottage.kind === 'structure') {
    assert.deepEqual(cottage.structure.grid.size, [15, 20, 15]);
    assert.ok(cottage.structure.grid.openings.some((o) => o.kind === 'bay_window'));
  }
  if (tavern.kind === 'structure') {
    assert.ok(
      tavern.structure.grid.floors.some((f) => f.jetty?.south === 1 && f.jetty?.east === 1),
    );
    assert.ok(tavern.structure.grid.openings.some((o) => o.kind === 'bay_window'));
  }
  if (smith.kind === 'structure') {
    assert.ok(smith.structure.grid.openings.some((o) => o.kind === 'arcade'));
  }
  if (tower.kind === 'structure') {
    assert.deepEqual(tower.structure.grid.size, [13, 27, 13]);
    assert.ok(tower.structure.grid.rooms.every((r) => r.shape === 'octagon'));
    assert.ok(tower.structure.grid.floors.some((f) => f.jetty?.north === 1));
  }
};

const testLightingRingAndMultiLightReRelaxation = (): void => {
  const src = `ashfox-model 1
structure lit_canopy {
  size = (7, 6, 7);
  palette {
    stone = "minecraft:stone_bricks";
    leaves = "minecraft:oak_leaves";
    torch = "minecraft:torch";
    soul = "minecraft:soul_lantern[hanging=false]";
  }
  build {
    box from = (0, 0, 0) to = (6, 0, 6) block = stone;
    box from = (1, 4, 1) to = (5, 4, 5) block = leaves;
    set at = (1, 1, 1) block = torch;
    set at = (5, 1, 5) block = soul;
    set at = (3, 1, 3) block = torch;
  }
}`;
  const built = compileStructureUnits(
    'lit.ashfox',
    new Map([['lit.ashfox', parseStructureSource(src, 'lit.ashfox')]]),
    {},
    relativePosix,
  );
  const idx = (3 * 7 + 2) * 7 + 3;
  assert.ok(built.lighting.sky[idx]! >= 200);
  assert.ok(built.lighting.blockR[idx]! > 100 && built.lighting.blockB[idx]! > 80);
};

const testPlacedSemanticRooms = (): void => {
  const src = `ashfox-model 1
structure placed_rooms {
  size = (24, 10, 24);
  palette {
    stone = "minecraft:stone_bricks";
    plank = "minecraft:oak_planks";
    door = "minecraft:oak_door[facing=north,half=lower,hinge=left,open=false]";
  }
  prefab HutA {
    floor f0 y = 0 height = 4 {
      room main_a from = (1, 1) size = (5, 5) kind = living plinth = stone floor = plank wall = stone ceiling = plank;
      facade on main_a.south {
        door at = center width = 1 height = 2 block = door;
      }
    }
  }
  prefab HutB {
    floor f1 y = 0 height = 4 {
      room main_b from = (0, 0) size = (4, 6) kind = living plinth = stone floor = plank wall = stone ceiling = plank;
      facade on main_b.south {
        door at = center width = 1 height = 2 block = door;
      }
    }
  }
  build {
    place HutA at = (10, 0, 10) rotate = 0;
    place HutB at = (8, 1, 2) rotate = 90;
  }
}`;
  const built = compileStructureUnits(
    'placed.ashfox',
    new Map([['placed.ashfox', parseStructureSource(src, 'placed.ashfox')]]),
    {},
    relativePosix,
  );
  const roomA = built.grid.rooms.find((r) => r.name === 'main_a')!;
  assert.deepEqual(roomA.from, [11, 0, 11]);
  assert.deepEqual(roomA.to, [15, 4, 15]);
  const [w, _h, d] = built.grid.size;
  const doorIdx = (1 * d + 15) * w + 13;
  assert.ok(built.grid.states[built.grid.voxels[doorIdx]!]?.startsWith('minecraft:oak_door'));

  const roomB = built.grid.rooms.find((r) => r.name === 'main_b')!;
  assert.deepEqual(roomB.from, [3, 1, 2]);
  assert.deepEqual(roomB.to, [8, 5, 5]);
  assert.equal(built.grid.openings.find((o) => o.room === 'main_b')?.wall, 'west');
};

const testMassingOctagonSpireAndValleys = (): void => {
  const src = `ashfox-model 1
structure massing_test {
  size = (15, 22, 15);
  palette {
    stone = "minecraft:stone_bricks";
    plank = "minecraft:oak_planks";
    timber = "minecraft:spruce_log[axis=y]";
    stair = "minecraft:deepslate_brick_stairs";
    ridge = "minecraft:deepslate_brick_slab[type=bottom]";
    glass = "minecraft:glass_pane";
    sill = "minecraft:spruce_slab[type=top]";
    door = "minecraft:oak_door[facing=north,half=lower,hinge=left,open=false]";
  }
  build {
    floor f0 y = 0 height = 4 {
      room base from = (2, 2) size = (9, 9) kind = tower shape = octagon plinth = stone floor = plank wall = stone frame = timber ceiling = plank;
      facade on base.south {
        door at = center width = 1 height = 2 block = door;
        arcade at = 0 width = 2 height = 3 frame = timber lintel = sill;
      }
      facade on base.east {
        bay_window at = center width = 3 height = 2 y_offset = 1 glass = glass frame = timber sill = sill lintel = sill;
      }
    }
    floor f1 y = 4 height = 4 jetty = 1 {
      room top from = (2, 2) size = (9, 9) kind = tower shape = octagon floor = plank wall = stone frame = timber ceiling = stone;
    }
    roof on = top style = spire axis = x overhang = 0 pitch = steep stair = stair ridge = ridge gable = stone battlement = true;
    roof from = (3, 12, 3) to = (9, 18, 9) style = gable axis = z stair = stair ridge = ridge gable = stone;
  }
}`;
  const built = compileStructureUnits(
    'm.ashfox',
    new Map([['m.ashfox', parseStructureSource(src, 'm.ashfox')]]),
    {},
    relativePosix,
  );
  assert.equal(built.grid.rooms[0]?.shape, 'octagon');
  assert.equal(built.grid.floors[1]?.jetty?.south, 1);
  assert.deepEqual(built.grid.rooms[1]?.from, [1, 4, 1]);
  assert.deepEqual(built.grid.rooms[1]?.to, [11, 8, 11]);
  assert.ok(built.grid.openings.some((o) => o.kind === 'bay_window'));
  assert.ok(built.grid.openings.some((o) => o.kind === 'arcade'));
  assert.ok(built.grid.states.some((s) => s.includes('minecraft:lantern')));
  const [w, _h, d] = built.grid.size;
  assert.equal(built.grid.voxels[(0 * d + 2) * w + 2], -1);
};

const main = async (): Promise<void> => {
  testParserAndSemanticDsl();
  testLowLevelGridAndHonestBareAudit();
  await testBakedGreedyInstancingAndHygiene();
  testLightingRingAndMultiLightReRelaxation();
  testPlacedSemanticRooms();
  testMassingOctagonSpireAndValleys();
  testCanonicalWorkspaceShowcases();
  console.log('ashfox structure compiler v2 tests ok');
};

const pending = main().catch((err) => {
  console.error(err);
  process.exit(1);
});
const bucket = (globalThis as { __ashfoxEngineTestPromises?: Promise<unknown>[] })
  .__ashfoxEngineTestPromises;
if (Array.isArray(bucket)) bucket.push(pending);
