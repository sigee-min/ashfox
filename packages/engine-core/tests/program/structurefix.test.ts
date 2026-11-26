import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  compileDirectoryWorkspace,
  compileStructureUnits,
  exportStructureGltfResolved,
  parseStructureSource,
  type CompiledModel,
  type DirectoryFile,
} from '../../src/index';

const REPO_ROOT = path.resolve(__dirname, '../../../..');

const relativePosix = (owner: string, spec: string): string =>
  path.posix.normalize(path.posix.join(path.posix.dirname(owner), spec));

const readPropFixture = (name: string): string =>
  fs.readFileSync(
    path.join(REPO_ROOT, 'examples/structure/assets/models/props', `${name}.ashfox`),
    'utf8',
  );

const compileSingleModel = (
  entryName: string,
  modelPath: string,
  source: string,
): CompiledModel => {
  const res = compileDirectoryWorkspace(
    JSON.stringify({
      format: 'ashfox-workspace',
      version: 2,
      name: 'standalone',
      packages: [
        {
          name: 'p',
          root: '',
          manifest: {
            format: 'ashfox-package',
            version: 1,
            entries: [{ name: entryName, path: modelPath }],
            modules: [],
            dependencies: [],
          },
        },
      ],
      include: ['**/*.ashfox'],
      ignore: [],
      build: { directory: 'build' },
      exports: [],
    }),
    [{ path: modelPath, source }],
  );
  if (!res.ok) throw new Error(res.diagnostics.map((d) => d.message).join('\n'));
  const modelProduct = res.products.find((p) => p.kind === 'model');
  if (!modelProduct || modelProduct.kind !== 'model') throw new Error('Expected model product');
  return modelProduct.model;
};

const testMixedStructureAndSharedPropWorkspace = (): void => {
  const dir = path.join(REPO_ROOT, 'examples/structure');
  const read = (rel: string) => fs.readFileSync(path.join(dir, rel), 'utf8');
  const files: DirectoryFile[] = [
    {
      path: 'assets/structures/watchtower.ashfox',
      source: read('assets/structures/watchtower.ashfox'),
    },
    { path: 'assets/module/furnishings.ashfox', source: read('assets/module/furnishings.ashfox') },
    {
      path: 'assets/models/props/rune_pillar.ashfox',
      source: read('assets/models/props/rune_pillar.ashfox'),
    },
    {
      path: 'assets/models/props/wall_lantern.ashfox',
      source: read('assets/models/props/wall_lantern.ashfox'),
    },
  ];
  const config = JSON.stringify({
    format: 'ashfox-workspace',
    version: 2,
    name: 'mixed-props',
    packages: [
      {
        name: 'structures',
        root: 'assets/structures',
        manifest: {
          format: 'ashfox-package',
          version: 1,
          entries: [{ name: 'watchtower', path: 'watchtower.ashfox' }],
          modules: [],
          dependencies: [],
        },
      },
      {
        name: 'props',
        root: 'assets/models/props',
        manifest: {
          format: 'ashfox-package',
          version: 1,
          entries: [{ name: 'wall_lantern', path: 'wall_lantern.ashfox' }],
          modules: [{ subpath: './rune_pillar', path: 'rune_pillar.ashfox' }],
          dependencies: [],
        },
      },
      {
        name: 'shared_modules',
        root: 'assets/module',
        manifest: {
          format: 'ashfox-package',
          version: 1,
          entries: [],
          modules: [{ subpath: './furnishings', path: 'furnishings.ashfox' }],
          dependencies: [],
        },
      },
    ],
    include: ['assets/**/*.ashfox'],
    ignore: [],
    build: { directory: 'build' },
    exports: [],
  });
  const compiled = compileDirectoryWorkspace(config, files);
  if (!compiled.ok) throw new Error(compiled.diagnostics.map((d) => d.message).join('\n'));
  assert.deepEqual(compiled.products.map((p) => p.kind).sort(), ['model', 'structure']);
};

const testQualifiedCustomModelAliases = (): void => {
  const pillar = compileSingleModel(
    'rune_pillar',
    'props/rune_pillar.ashfox',
    readPropFixture('rune_pillar'),
  );
  const lantern = compileSingleModel(
    'wall_lantern',
    'props/wall_lantern.ashfox',
    readPropFixture('wall_lantern'),
  );
  const m1 = `ashfox-model 1
module m1 {
  import "./props/rune_pillar.ashfox" as prop;
  palette { p = asset prop as "minecraft:chiseled_stone_bricks"; }
  export prefab A { set at = (0, 0, 0) block = p; }
}`;
  const m2 = `ashfox-model 1
module m2 {
  import "./props/wall_lantern.ashfox" as prop;
  palette { p = asset prop as "minecraft:lantern[hanging=false]"; }
  export prefab B { set at = (0, 0, 0) block = p; }
}`;
  const root = `ashfox-model 1
structure s {
  import "./m1.ashfox" as a;
  import "./m2.ashfox" as b;
  size = (5, 5, 5);
  palette { stone = "minecraft:stone_bricks"; }
  build {
    box from = (0, 0, 0) to = (4, 0, 4) block = stone;
    place a.A at = (1, 1, 1) rotate = 0;
    place b.B at = (3, 1, 1) rotate = 0;
  }
}`;
  const units = new Map([
    ['m1.ashfox', parseStructureSource(m1, 'm1.ashfox')],
    ['m2.ashfox', parseStructureSource(m2, 'm2.ashfox')],
    ['s.ashfox', parseStructureSource(root, 's.ashfox')],
  ]);
  const built = compileStructureUnits(
    's.ashfox',
    units,
    { 'm1.ashfox#prop': pillar, 'm2.ashfox#prop': lantern },
    relativePosix,
  );
  assert.deepEqual(built.grid.customPlacements.map((p) => p.assetAlias).sort(), [
    'm1.ashfox#prop',
    'm2.ashfox#prop',
  ]);
  assert.equal(
    Object.keys(built.document.textures).filter((id) => id.startsWith('c_')).length,
    Object.keys(pillar.textures).length + Object.keys(lantern.textures).length,
  );
};

const testPreservedCustomBoneRotationAndMirror = async (): Promise<void> => {
  const rotatedSource = readPropFixture('rune_pillar').replace(
    /export skeleton PillarSkeleton implements PillarRig \{\s*bind root \{\s*parent-origin = \(0u, 0u, 0u\);\s*frame \{ x = \(1, 0, 0\); y = \(0, 1, 0\); z = \(0, 0, 1\); \}/u,
    'export skeleton PillarSkeleton implements PillarRig {\n    bind root {\n      parent-origin = (0u, 0u, 0u);\n      frame { x = (1, 0, 0); y = (0, 0, 1); z = (0, -1, 0); }',
  );
  const rotatedModel = compileSingleModel(
    'rune_pillar',
    'props/rotated_pillar.ashfox',
    rotatedSource,
  );
  const rotatedBone = Object.values(rotatedModel.scene.nodes).find((n) => n.kind === 'bone')!;
  assert.equal(rotatedBone.kind, 'bone');
  assert.notEqual(rotatedBone.transform.rotation[0], 0);

  const mirrorMod = `ashfox-model 1
module mod_m {
  palette { stair = "minecraft:oak_stairs[facing=east,half=bottom,shape=straight]"; }
  export prefab wing {
    mirror axis = x center = 1 {
      set at = (0, 0, 0) block = stair;
    }
  }
}`;
  const root = `ashfox-model 1
structure mirror_test {
  import "./mod_m.ashfox" as m;
  import "./rotated_pillar.ashfox" as rp;
  size = (10, 4, 10);
  palette { rp_block = asset rp as "minecraft:chiseled_stone_bricks"; }
  build {
    set at = (1, 1, 1) block = rp_block;
    place m.wing at = (5, 0, 5) rotate = 90;
  }
}`;
  const units = new Map([
    ['mod_m.ashfox', parseStructureSource(mirrorMod, 'mod_m.ashfox')],
    ['root.ashfox', parseStructureSource(root, 'root.ashfox')],
  ]);
  const built = compileStructureUnits(
    'root.ashfox',
    units,
    { 'root.ashfox#rp': rotatedModel },
    relativePosix,
  );
  const idx = (x: number, y: number, z: number) => (y * 10 + z) * 10 + x;
  assert.equal(
    built.grid.states[built.grid.voxels[idx(5, 0, 5)]!],
    'minecraft:oak_stairs[facing=south,half=bottom,shape=straight]',
  );
  assert.equal(
    built.grid.states[built.grid.voxels[idx(5, 0, 7)]!],
    'minecraft:oak_stairs[facing=north,half=bottom,shape=straight]',
  );
  assert.equal(built.bakedMesh.instances.length, 1);
  assert.equal(built.bakedMesh.instances[0]?.assetKey, 'root.ashfox#rp');
  const glb = await exportStructureGltfResolved(built, 'mirror_test', 'fix-key');
  assert.ok(glb.files.some((f) => f.path.endsWith('.glb')));
  assert.ok(glb.files.some((f) => f.path.endsWith('.structure.json')));
};

const testEastWestWindowMullions = (): void => {
  const src = `ashfox-model 1
structure ew_window {
  size = (9, 7, 9);
  palette {
    stone = "minecraft:stone_bricks";
    glass = "minecraft:glass";
    door = "minecraft:oak_door[facing=north,half=lower,hinge=left,open=false]";
  }
  build {
    floor f0 y = 0 height = 5 {
      room hall from = (1, 1) size = (7, 7) kind = living plinth = stone floor = stone wall = stone ceiling = stone;
      facade on hall.south { door at = center width = 1 height = 2 block = door; }
      facade on hall.east { window at = center width = 1 height = 2 y_offset = 1 glass = glass; }
    }
  }
}`;
  const built = compileStructureUnits(
    'ew.ashfox',
    new Map([['ew.ashfox', parseStructureSource(src, 'ew.ashfox')]]),
    {},
    relativePosix,
  );
  const trimBatch = built.bakedMesh.batches.find((b) => b.textureId === 'struct_atlas_opaque');
  assert.ok(trimBatch, 'expected struct_atlas_opaque batch for non-pane east window mullions');
  const [w, _h, d] = built.grid.size;
  const win = built.grid.openings.find((o) => o.kind === 'window' && o.wall === 'east')!;
  const wx = win.from[0] - w / 2;
  const wz0 = win.from[2] - d / 2;
  let foundHorizontalTransom = false;
  for (let i = 0; i < trimBatch.positions.length; i += 3) {
    const px = trimBatch.positions[i]!;
    const py = trimBatch.positions[i + 1]!;
    const pz = trimBatch.positions[i + 2]!;
    if (py > win.from[1] + 0.4 && py < win.from[1] + 0.6 && pz >= wz0 && pz <= wz0 + 1.01) {
      assert.ok(px >= wx + 0.4 && px <= wx + 0.6, `transom leaked outside wall X: ${px}`);
      foundHorizontalTransom = true;
    }
  }
  assert.ok(foundHorizontalTransom);
};

const testSteepGableRoofsAndGables = (): void => {
  for (const axis of ['x', 'z'] as const) {
    const src = `ashfox-model 1
structure steep_${axis} {
  size = (11, 14, 11);
  palette {
    stone = "minecraft:stone_bricks";
    stair = "minecraft:oak_stairs";
    ridge = "minecraft:oak_slab[type=bottom]";
  }
  build {
    box from = (1, 0, 1) to = (9, 0, 9) block = stone;
    roof style = gable axis = ${axis} from = (1, 1, 1) to = (9, 10, 9) pitch = steep stair = stair ridge = ridge gable = stone;
  }
}`;
    const built = compileStructureUnits(
      `steep_${axis}.ashfox`,
      new Map([[`steep_${axis}.ashfox`, parseStructureSource(src, `steep_${axis}.ashfox`)]]),
      {},
      relativePosix,
    );
    const [w, _h, d] = built.grid.size;
    for (let level = 0; level < 4; level += 1) {
      for (const y of [1 + level * 2, 2 + level * 2]) {
        const x = axis === 'z' ? 1 + level : 1;
        const z = axis === 'z' ? 1 : 1 + level;
        assert.ok(built.grid.voxels[(y * d + z) * w + x]! > 0, `missing ${axis} roof slope y=${y}`);
        const endGableX = axis === 'z' ? 5 : 1;
        const endGableZ = axis === 'z' ? 1 : 5;
        assert.ok(
          built.grid.voxels[(y * d + endGableZ) * w + endGableX]! > 0,
          `missing ${axis} gable end y=${y}`,
        );
      }
    }
  }
};

const testBayWindowMinWidth = (): void => {
  assert.throws(
    () =>
      parseStructureSource(
        `ashfox-model 1
structure narrow_bay {
  size = (9, 7, 9);
  palette { s = "minecraft:stone_bricks"; g = "minecraft:glass"; }
  build {
    floor f0 y = 0 height = 5 {
      room hall from = (1, 1) size = (7, 7) kind = living plinth = s floor = s wall = s ceiling = s;
      facade on hall.south { bay_window at = center width = 2 height = 2 y_offset = 1 glass = g; }
    }
  }
}`,
        'narrow_bay.ashfox',
      ),
    /valid opening width\/height/,
  );
};

const main = async (): Promise<void> => {
  testMixedStructureAndSharedPropWorkspace();
  testQualifiedCustomModelAliases();
  await testPreservedCustomBoneRotationAndMirror();
  testEastWestWindowMullions();
  testSteepGableRoofsAndGables();
  testBayWindowMinWidth();
  console.log('ashfox structure review regression tests ok');
};

const pending = main().catch((err) => {
  console.error(err);
  process.exit(1);
});
const bucket = (globalThis as { __ashfoxEngineTestPromises?: Promise<unknown>[] })
  .__ashfoxEngineTestPromises;
if (Array.isArray(bucket)) bucket.push(pending);
