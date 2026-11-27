import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  compileDirectoryWorkspace,
  compileStructureUnits,
  parseStructureSource,
  virtualLibrarySpecifierFromPath,
  type StructureSourceUnit,
} from '../../src/index';

const REPO_ROOT = path.resolve(__dirname, '../../../..');

const loadStdLibs = (): Map<string, string> => {
  const stdDir = path.join(REPO_ROOT, 'library/std');
  const out = new Map<string, string>();
  for (const rel of fs.readdirSync(stdDir, { recursive: true }) as string[]) {
    if (!rel.endsWith('.ashfox')) continue;
    const spec = virtualLibrarySpecifierFromPath(`library/std/${rel.replaceAll(path.sep, '/')}`);
    if (spec) out.set(spec, fs.readFileSync(path.join(stdDir, rel), 'utf8'));
  }
  return out;
};

const STD_LIBS = loadStdLibs();
const relPosix = (owner: string, spec: string): string =>
  path.posix.normalize(path.posix.join(path.posix.dirname(owner), spec));

const compileInline = (source: string) => {
  const units = new Map<string, StructureSourceUnit>([
    ['w.ashfox', parseStructureSource(source, 'w.ashfox')],
  ]);
  return compileStructureUnits('w.ashfox', units, {}, relPosix);
};

const testRustStreakDeterministic = (): void => {
  const src = `ashfox 1
structure rust_facility {
  density = 2; seed = 42; size = (9b, 7b, 9b);
  palette {
    metal = "minecraft:iron_block";
    rust = "minecraft:exposed_copper";
    floor = "minecraft:black_concrete";
    door = "minecraft:iron_door[facing=north,half=lower,hinge=left,open=false]";
    lamp = "minecraft:sea_lantern";
  }
  floor f0 {
    y = 0b; height = 5b;
    room bay { from = (1b, 1b); size = (7b, 7b); kind = lab; plinth = floor; floor = floor; wall = metal; ceiling = metal; }
    facade bay.south { door { at = center; width = 1b; height = 2b; block = door; } }
  }
  furnish bay { hang { block = lamp; at = ceiling_center; drop = 1b; } }
  weathering {
    rust_streak { target = metal; into = rust; rate = 85%; length = 4b; }
  }
}`;
  const a = compileInline(src);
  const b = compileInline(src);
  assert.deepEqual(a.nbt, b.nbt, 'rust_streak must be deterministic');
  assert.ok(a.grid.states.includes('minecraft:exposed_copper'));
  assert.equal(
    a.audit.hardGates.filter((g) => !g.passed).length,
    0,
    JSON.stringify(a.audit.hardGates.filter((g) => !g.passed)),
  );
};

const testWallBreachPreservesGates = (): void => {
  const src = `ashfox 1
structure ruined_post {
  density = 2; seed = 77; size = (11b, 7b, 11b);
  palette {
    wall = "minecraft:stone_bricks";
    floor = "minecraft:cobblestone";
    rubble = "minecraft:cobblestone_slab[type=bottom]";
    door = "minecraft:oak_door[facing=north,half=lower,hinge=left,open=false]";
    torch = "minecraft:torch";
  }
  floor f0 {
    y = 0b; height = 5b;
    room hall { from = (1b, 1b); size = (9b, 9b); kind = outpost; plinth = floor; floor = floor; wall = wall; ceiling = wall; }
    facade hall.south { door { at = center; width = 1b; height = 2b; block = door; } }
  }
  furnish hall { hang { block = torch; at = ceiling_center; drop = 1b; } }
  weathering {
    wall_breach { target = wall; rubble = rubble; rate = 90%; max_width = 2b; height = 2b; }
  }
}`;
  const built = compileInline(src);
  const failed = built.audit.hardGates.filter((g) => !g.passed);
  assert.equal(failed.length, 0, `Hard gates failed after wall_breach: ${JSON.stringify(failed)}`);
  assert.ok(
    built.grid.states.some((s) => s.includes('cobblestone_slab') || s.includes('cobblestone')),
  );
  const fullWall = built.grid.voxels.filter((v) => v === 0).length;
  assert.ok(fullWall > 0);
};

const testShatteredGlassAndVineOvergrowth = (): void => {
  const src = `ashfox 1
structure overgrown_store {
  density = 2; seed = 109; size = (11b, 7b, 11b);
  palette {
    wall = "minecraft:bricks";
    floor = "minecraft:smooth_stone";
    glass = "minecraft:glass_pane";
    shard = "minecraft:light_gray_stained_glass_pane";
    vines = "minecraft:oak_leaves[persistent=true]";
    door = "minecraft:oak_door[facing=north,half=lower,hinge=left,open=false]";
    lantern = "minecraft:lantern[hanging=true]";
  }
  floor f0 {
    y = 0b; height = 5b;
    room shop { from = (1b, 1b); size = (9b, 9b); kind = shop; plinth = floor; floor = floor; wall = wall; ceiling = wall; }
    facade shop.south { door { at = center; width = 1b; height = 2b; block = door; } }
    facade side_win {
      on = [shop.east, shop.west, shop.north];
      window { at = center; width = 3b; height = 2b; y_offset = 1b; glass = glass; }
    }
  }
  furnish shop { hang { block = lantern; at = ceiling_center; drop = 1b; } }
  weathering {
    shattered_glass { target = glass; shard = shard; rate = 65%; }
    vine_overgrowth { target = wall; into = vines; rate = 80%; height = 4b; }
  }
}`;
  const built = compileInline(src);
  const failed = built.audit.hardGates.filter((g) => !g.passed);
  assert.equal(failed.length, 0, `Hard gates failed: ${JSON.stringify(failed)}`);
  assert.ok(built.grid.states.some((s) => s.includes('oak_leaves')));
  assert.ok(built.grid.states.some((s) => s.includes('light_gray_stained_glass_pane')));
};

const testDungeonAndGenreStdKitsHooks = (): void => {
  assert.ok(STD_LIBS.has('std/structure/dungeon/corridor'));
  assert.ok(STD_LIBS.has('std/structure/dungeon/chamber'));
  assert.ok(STD_LIBS.has('std/structure/dungeon/trap_gate'));
  assert.ok(STD_LIBS.has('std/structure/arch/scifi'));
  assert.ok(STD_LIBS.has('std/structure/interior/scifi'));
  assert.ok(STD_LIBS.has('std/structure/arch/postapoc'));
  assert.ok(STD_LIBS.has('std/structure/interior/postapoc'));

  const scifiSrc = `ashfox 1
structure airlock_unit {
  import "std/structure/arch/scifi" as arch;
  import "std/structure/interior/scifi" as int_kit;
  density = 2; seed = 55; size = (11b, 7b, 11b);
  palette {
    deck = "minecraft:black_concrete";
    hull = "minecraft:light_gray_concrete";
    rib = "minecraft:gray_concrete";
    door = "minecraft:iron_door[facing=north,half=lower,hinge=left,open=false]";
    lamp = "minecraft:sea_lantern";
  }
  floor f0 {
    y = 0b; height = 5b;
    room bay { from = (1b, 1b); size = (9b, 9b); kind = lab; plinth = rib; floor = deck; wall = hull; frame = rib; ceiling = rib; }
    facade bay.south { door { at = center; width = 1b; height = 2b; block = door; } }
  }
  furnish bay {
    place_anchor { prefab = int_kit.ControlConsole; on = north; offset = (0b, 0b); rotate = 0; }
    hang { block = lamp; at = ceiling_center; drop = 1b; }
  }
  place arch.RibbedBulkhead { at = (0b, 0b, 0b); rotate = 0; }
  anchor airlock_portal : arch.DoorPortal { room = bay; at = (4b, 1b, 8b); facing = south; door_mode = sliding_airlock; destination = "bridge"; }
}`;
  const res = compileDirectoryWorkspace(
    JSON.stringify({
      format: 'ashfox-workspace',
      version: 2,
      name: 'genre_kit_verify',
      packages: [
        {
          name: 'app',
          root: 'assets',
          manifest: {
            format: 'ashfox-package',
            version: 1,
            entries: [{ name: 'airlock_unit', path: 'structures/airlock.ashfox' }],
            modules: [],
            dependencies: [],
          },
        },
      ],
      include: ['assets/**/*.ashfox'],
      ignore: [],
      build: { directory: 'dist/build' },
      exports: [],
    }),
    [{ path: 'assets/structures/airlock.ashfox', source: scifiSrc }],
    STD_LIBS,
  );
  assert.equal(res.ok, true, res.ok ? '' : res.diagnostics.map((d) => d.message).join('\n'));
  const prod = res.products[0]!;
  assert.equal(prod.kind, 'structure');
  const built = prod.structure;
  assert.equal(built.audit.hardGates.filter((g) => !g.passed).length, 0);
  assert.ok(built.grid.states.includes('minecraft:cyan_concrete'));
  assert.ok(built.hooks?.anchors.some((a) => a.id === 'airlock_portal'));
};

testRustStreakDeterministic();
testWallBreachPreservesGates();
testShatteredGlassAndVineOvergrowth();
testDungeonAndGenreStdKitsHooks();
console.log('ashfox genre weathering & structure kit tests ok');
