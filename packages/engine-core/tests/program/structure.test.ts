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

const REPO_ROOT = path.resolve(__dirname, '../../../..');

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

const TEST_COTTAGE = `ashfox-model 1
structure test_hut {
  import "./deco.ashfox" as deco;
  size = (9, 9, 9);
  data_version = 3955;
  palette {
    cobble = "minecraft:cobblestone";
    plank = "minecraft:oak_planks";
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
    walls from = (1, 1, 1) to = (7, 5, 7) block = brick;
    frame from = (1, 1, 1) to = (7, 4, 7) block = plank;
    set at = (4, 1, 7) block = door_lo;
    set at = (4, 2, 7) block = door_hi;
    mirror axis = x center = 4 {
      set at = (2, 2, 6) block = torch;
    }
    repeat axis = z count = 2 step = 2 {
      set at = (6, 2, 2) block = torch facing = east;
    }
    roof style = gable axis = z from = (0, 5, 0) to = (8, 8, 8) stair = stair ridge = ridge gable = plank;
    place deco.SleepSet at = (2, 1, 2) rotate = 90;
  }
}
`;

const relativePosix = (owner: string, spec: string): string =>
  path.posix.normalize(path.posix.join(path.posix.dirname(owner), spec));

const testParserAndOps = (): void => {
  const unit = parseStructureSource(TEST_COTTAGE, 'hut.ashfox');
  assert.equal(unit.kind, 'structure');
  assert.equal(unit.id, 'test_hut');
  assert.deepEqual(unit.size, [9, 9, 9]);
  assert.equal(unit.dataVersion, 3955);
  assert.equal(unit.imports.length, 1);

  assert.throws(
    () => parseStructureSource('ashfox-model 1\nstructure bad { size = (1, 1); build {} }', 'bad'),
    StructureInputError,
  );
};

const testRoofsAndTransforms = (): void => {
  const units = new Map<string, StructureSourceUnit>([
    ['hut.ashfox', parseStructureSource(TEST_COTTAGE, 'hut.ashfox')],
    ['deco.ashfox', parseStructureSource(TEST_MOD, 'deco.ashfox')],
  ]);
  const product = compileStructureUnits('hut.ashfox', units, {}, relativePosix);
  assert.equal(product.audit.passed, true);
  assert.ok(product.grid.states.includes('minecraft:air'));
  assert.ok(product.grid.states.includes('minecraft:chest[facing=east]'));
  assert.ok(product.grid.states.includes('minecraft:red_bed[facing=east,part=head]'));

  const decoded = decodeStructureNbt(product.nbt);
  assert.equal(decoded.dataVersion, 3955);
  assert.deepEqual(decoded.size, [9, 9, 9]);
  const center = decoded.blocks.find((b) => b.pos[0] === 4 && b.pos[1] === 2 && b.pos[2] === 4);
  assert.ok(center);
  assert.equal(decoded.palette[center.state]?.Name, 'minecraft:air');

  for (const style of ['hip', 'pyramid'] as const) {
    const roofSrc = `ashfox-model 1
structure s {
  size = (7, 8, 7);
  palette { s = "minecraft:cobblestone"; st = "minecraft:oak_stairs"; r = "minecraft:oak_slab[type=bottom]"; t = "minecraft:torch"; d0 = "minecraft:oak_door[facing=north,half=lower,hinge=left,open=false]"; d1 = "minecraft:oak_door[facing=north,half=upper,hinge=left,open=false]"; }
  build {
    box from = (1, 0, 1) to = (5, 0, 5) block = s;
    walls from = (1, 1, 1) to = (5, 3, 5) block = s;
    carve from = (2, 1, 2) to = (4, 3, 4);
    set at = (3, 1, 5) block = d0;
    set at = (3, 2, 5) block = d1;
    set at = (3, 1, 3) block = t;
    roof style = ${style} axis = x from = (0, 4, 0) to = (6, 7, 6) stair = st ridge = r;
  }
}`;
    const compiled = compileStructureUnits(
      'roof.ashfox',
      new Map([['roof.ashfox', parseStructureSource(roofSrc, 'roof.ashfox')]]),
      {},
      relativePosix,
    );
    assert.ok(compiled.nbt.byteLength > 20);
  }
};

const testHygieneAndCustomModels = async (): Promise<void> => {
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

  const unusedPrefab = `ashfox-model 1
structure s {
  size = (3, 3, 3);
  palette { a = "minecraft:stone"; }
  prefab Dead { set at = (0, 0, 0) block = a; }
  build { set at = (0, 0, 0) block = a; }
}`;
  assert.throws(
    () =>
      compileStructureUnits(
        'p.ashfox',
        new Map([['p.ashfox', parseStructureSource(unusedPrefab, 'p.ashfox')]]),
        {},
        relativePosix,
      ),
    (err: unknown) =>
      err instanceof StructureInputError && err.detail.code === 'structure.unused-prefab',
  );

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
  const compiledPillar: CompiledModel = (
    modelRes.products[0] as Extract<(typeof modelRes.products)[number], { kind: 'model' }>
  ).model;

  const customSrc = `ashfox-model 1
structure s {
  import "./rune_pillar.ashfox" as rp;
  size = (5, 5, 5);
  palette {
    stone = "minecraft:stone_bricks";
    pillar = asset rp as "minecraft:chiseled_stone_bricks";
    door0 = "minecraft:oak_door[facing=north,half=lower,hinge=left,open=false]";
    door1 = "minecraft:oak_door[facing=north,half=upper,hinge=left,open=false]";
    torch = "minecraft:torch";
    bed = "minecraft:red_bed[facing=north,part=head]";
  }
  build {
    box from = (0, 0, 0) to = (4, 0, 4) block = stone;
    walls from = (0, 1, 0) to = (4, 3, 4) block = stone;
    set at = (2, 1, 4) block = door0;
    set at = (2, 2, 4) block = door1;
    set at = (1, 1, 1) block = bed;
    set at = (3, 1, 1) block = torch;
    set at = (0, 1, 4) block = pillar facing = south;
    set at = (4, 1, 4) block = pillar facing = west;
  }
}`;
  const customUnits = new Map([['s.ashfox', parseStructureSource(customSrc, 's.ashfox')]]);
  const built = compileStructureUnits(
    's.ashfox',
    customUnits,
    { 's.ashfox#rp': compiledPillar },
    relativePosix,
  );
  const textureIds = Object.keys(built.document.textures).filter((id) => id.startsWith('c_'));
  assert.equal(textureIds.length, 1);

  const glbBundle = await exportStructureGltfResolved(built.document, 's', 'test-key');
  const glbFile = glbBundle.files.find((f) => f.path.endsWith('.glb'));
  assert.ok(glbFile && glbFile.kind === 'binary');
  const magic = Buffer.from(glbFile.data).subarray(0, 4).toString('utf8');
  assert.equal(magic, 'glTF');

  const cutDoc = buildStructureDocument(
    built.grid,
    { 's.ashfox#rp': compiledPillar },
    { cutawayY: 2 },
  );
  assert.ok(
    Object.keys(cutDoc.scene.nodes).length < Object.keys(built.document.scene.nodes).length,
  );
};

const testShowcases = (): void => {
  const dir = path.join(REPO_ROOT, 'examples/structure');
  const filePaths = [
    'assets/structures/medieval_cottage.ashfox',
    'assets/structures/watchtower.ashfox',
    'assets/structures/blacksmith.ashfox',
    'assets/structures/tavern.ashfox',
    'assets/module/furnishings.ashfox',
    'assets/models/props/rune_pillar.ashfox',
    'assets/models/props/wall_lantern.ashfox',
    'assets/models/props/hanging_sign.ashfox',
  ];
  const files: DirectoryFile[] = filePaths.map((rel) => ({
    path: rel,
    source: fs.readFileSync(path.join(dir, rel), 'utf8'),
  }));
  const config = fs.readFileSync(path.join(dir, '.ashfoxworkspace'), 'utf8');

  const compiled = compileDirectoryWorkspace(config, files);
  if (!compiled.ok) throw new Error(compiled.diagnostics.map((d) => d.message).join('\n'));
  assert.equal(compiled.products.length, 4);
  for (const product of compiled.products) {
    assert.equal(product.kind, 'structure');
    if (product.kind !== 'structure') continue;
    assert.equal(product.structure.audit.passed, true);
    assert.ok(product.structure.audit.score >= 85);
    assert.equal(product.structure.audit.grade, 'excellent');
  }
};

const main = async (): Promise<void> => {
  testParserAndOps();
  testRoofsAndTransforms();
  await testHygieneAndCustomModels();
  testShowcases();
  console.log('ashfox structure compiler tests ok');
};

const pending = main().catch((err) => {
  console.error(err);
  process.exit(1);
});
const bucket = (globalThis as { __ashfoxEngineTestPromises?: Promise<unknown>[] })
  .__ashfoxEngineTestPromises;
if (Array.isArray(bucket)) bucket.push(pending);
