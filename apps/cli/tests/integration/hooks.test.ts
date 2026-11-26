import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { decodeStructureNbt } from '@ashfox/engine-core';

const validator = require('gltf-validator') as {
  validateBytes: (
    bytes: Uint8Array,
    opts?: { externalResourceFunction?: () => Promise<never> },
  ) => Promise<{ issues: { numErrors: number; numWarnings: number } }>;
};

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const CLI = path.join(REPO_ROOT, 'apps/cli/dist/ashfox.cjs');

const runCli = (...args: string[]) =>
  spawnSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8',
    timeout: 120000,
    maxBuffer: 32 * 1024 * 1024,
  });

const writeFiles = (rootDir: string, files: Record<string, string>): void => {
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(rootDir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
};

const parseGlbJson = (bytes: Uint8Array) => {
  assert.equal(Buffer.from(bytes).subarray(0, 4).toString('utf8'), 'glTF');
  const len = Buffer.from(bytes).readUInt32LE(12);
  return JSON.parse(Buffer.from(bytes.subarray(20, 20 + len)).toString('utf8')) as {
    nodes: { name?: string; children?: number[]; mesh?: number }[];
    extras?: { ashfox?: { hooks?: { anchors: unknown[]; cues: unknown[] } } };
  };
};

const actorModelSource = (): string => {
  const pillar = fs.readFileSync(
    path.join(REPO_ROOT, 'examples/structure/assets/models/props/rune_pillar.ashfox'),
    'utf8',
  );
  return pillar
    .replace(
      'model rune_pillar {',
      'model sword_actor {\n  import "shared_modules/br_rules" as br;',
    )
    .replace(
      '\n}',
      `\n  anchor hilt_loot : br.LootSpawn { bone = root; at = (0u, 16u, 0u); tier = epic; table = "br:boss"; }\n  cue cleave : br.MeleeHitbox { clip = attack; at = 0.05s..0.25s; damage = 40; }\n}`,
    );
};

const medkitSpriteSource = (): string => {
  const apple = fs.readFileSync(
    path.join(REPO_ROOT, 'examples/items/assets/sprites/apple.ashfox'),
    'utf8',
  );
  return apple
    .replace('sprite apple {', 'sprite medkit {\n  import "../module/br_rules.ashfox" as br;')
    .replace(
      '\n}',
      '\n  anchor icon_loot : br.LootSpawn { at = (16px, 16px); tier = common; table = "br:meds"; }\n}',
    );
};

const sharedSpriteModuleSource = (): string =>
  fs.readFileSync(path.join(REPO_ROOT, 'examples/items/assets/module/shared.ashfox'), 'utf8');

const outpostStructSource = (): string => `ashfox 1
structure outpost {
  import "../module/br_rules.ashfox" as br;
  density = 2;
  seed = 77;
  size = (9b, 13b, 9b);
  data_version = 3955;
  palette {
    cobble = mix("minecraft:cobblestone" * 70%, "minecraft:mossy_cobblestone" * 30%);
    moss_cobble = "minecraft:mossy_cobblestone";
    plaster = mix("minecraft:white_terracotta" * 85%, "minecraft:calcite" * 15%);
    stone_brick = "minecraft:stone_bricks";
    chimney_brick = "minecraft:bricks";
    plank = "minecraft:oak_planks";
    spruce = "minecraft:spruce_planks";
    timber = "minecraft:spruce_log[axis=y]";
    beam = "minecraft:spruce_log[axis=x]";
    stair = "minecraft:spruce_stairs";
    trim_stair = "minecraft:dark_oak_stairs";
    ridge = "minecraft:spruce_slab[type=bottom]";
    porch_stair = "minecraft:cobblestone_stairs[facing=north,half=bottom]";
    door = "minecraft:oak_door[facing=north,half=lower,hinge=left,open=false]";
    glass = "minecraft:glass_pane";
    sill = "minecraft:spruce_slab[type=top]";
    shutter = "minecraft:oak_trapdoor[facing=south,half=bottom,open=true]";
    lantern = "minecraft:lantern[hanging=true]";
    porch_lamp = "minecraft:lantern[hanging=false]";
    bed_h = "minecraft:red_bed[facing=north,part=head]";
    bed_f = "minecraft:red_bed[facing=north,part=foot]";
    chest = "minecraft:chest[facing=north]";
    bookshelf = "minecraft:bookshelf";
    table = "minecraft:crafting_table";
  }
  prefab BedNook {
    layer { y = 0b; origin = (0b, 0b); rows = ["hc", "f."]; map { h = bed_h; f = bed_f; c = chest; } }
  }
  prefab StudyNook {
    layer { y = 0b; origin = (0b, 0b); rows = ["bt"]; map { b = bookshelf; t = table; } }
  }
  floor ground {
    y = 0b;
    height = 4b;
    room bunker { from = (1b, 1b); size = (7b, 6b); kind = bunker; plinth = cobble; floor = plank; wall = plaster; frame = timber; ceiling = spruce; }
    facade bunker.south {
      door {
        at = center; width = 1b; height = 2b; block = door; hinge = left; frame = timber; lintel = beam;
        porch { depth = 1; floor = stone_brick; pillars = timber; lamps = porch_lamp; steps = porch_stair; }
      }
    }
    facade windows {
      on = [bunker.east, bunker.west, bunker.north];
      window { at = center; width = 1b; height = 2b; y_offset = 1b; glass = glass; sill = sill; shutter = shutter; lintel = beam; }
    }
  }
  roof {
    on = bunker; style = gable; axis = z; overhang = 1b; pitch = standard;
    stair = stair; trim = trim_stair; ridge = ridge; gable = plaster; under_eave = true;
    chimney { room = bunker; corner = nw; offset = (0b, 0b); width = 1b; rise = 2b; block = chimney_brick; cap = true; }
  }
  furnish bunker {
    place_anchor { prefab = BedNook; on = nw; offset = (0b, 0b); rotate = 0; }
    place_anchor { prefab = StudyNook; on = se; offset = (0b, 0b); rotate = 0; }
    hang { block = lantern; at = ceiling_center; drop = 1b; }
  }
  weathering {
    ground_moss { height = 2b; target = cobble; into = moss_cobble; rate = 30%; }
    corner_quoin { target = plaster; corners = stone_brick; }
  }
  anchor entry_door : std.entry { room = bunker; wall = south; normal = south; pool = "village:streets"; target = "road_join"; }
  anchor drop : br.LootSpawn { room = bunker; at = (2b, 1b, 2b); facing = south; tier = rare; table = "br:drop"; }
  mc_block drop = "minecraft:trapped_chest[facing=south]";
}
`;

const main = async (): Promise<void> => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ashfox-hooks-cli-'));
  try {
    const wsDir = path.join(temp, 'br_ws');
    writeFiles(wsDir, {
      '.ashfoxworkspace': JSON.stringify({
        format: 'ashfox-workspace',
        version: 2,
        name: 'br_ws',
        packages: [
          {
            name: 'shared_modules',
            root: 'assets/module',
            manifest: {
              format: 'ashfox-package',
              version: 1,
              entries: [],
              modules: [
                { subpath: './br_rules', path: 'br_rules.ashfox' },
                { subpath: './shared', path: 'shared.ashfox' },
              ],
              dependencies: [],
            },
          },
          {
            name: 'models',
            root: 'assets/models',
            manifest: {
              format: 'ashfox-package',
              version: 1,
              entries: [{ name: 'sword_actor', path: 'sword_actor.ashfox' }],
              modules: [],
              dependencies: [{ name: 'shared_modules' }],
            },
          },
          {
            name: 'structures',
            root: 'assets/structures',
            manifest: {
              format: 'ashfox-package',
              version: 1,
              entries: [{ name: 'outpost', path: 'outpost.ashfox' }],
              modules: [],
              dependencies: [],
            },
          },
          {
            name: 'sprites',
            root: 'assets/sprites',
            manifest: {
              format: 'ashfox-package',
              version: 1,
              entries: [{ name: 'medkit', path: 'medkit.ashfox' }],
              modules: [],
              dependencies: [],
            },
          },
          {
            name: 'sounds',
            root: 'assets/sounds',
            manifest: {
              format: 'ashfox-package',
              version: 1,
              entries: [{ name: 'slash_sfx', path: 'slash_sfx.ashfox' }],
              modules: [],
              dependencies: [],
            },
          },
        ],
        include: ['assets/**/*.ashfox'],
        ignore: [],
        build: { directory: 'dist/build' },
        exports: [
          {
            name: 'sword_glb',
            entry: { packageName: 'models', entryName: 'sword_actor' },
            format: 'glb',
            directory: 'dist/models',
          },
          {
            name: 'outpost_glb',
            entry: { packageName: 'structures', entryName: 'outpost' },
            format: 'glb',
            directory: 'dist/structures',
          },
          {
            name: 'outpost_nbt',
            entry: { packageName: 'structures', entryName: 'outpost' },
            format: 'java_structure',
            directory: 'dist/structures_nbt',
          },
          {
            name: 'medkit_png',
            entry: { packageName: 'sprites', entryName: 'medkit' },
            format: 'png',
            directory: 'dist/sprites',
          },
          {
            name: 'slash_wav',
            entry: { packageName: 'sounds', entryName: 'slash_sfx' },
            format: 'wav',
            directory: 'dist/sounds',
          },
        ],
      }),
      'assets/module/shared.ashfox': sharedSpriteModuleSource(),
      'assets/module/br_rules.ashfox': `ashfox 1
module br_rules {
  export schema LootSpawn : anchor {
    field tier : enum(common, rare, epic) = common;
    field table : string;
    mc_block = "minecraft:chest[facing=\${facing}]";
  }
  export schema MeleeHitbox : cue {
    field damage : number = 25;
  }
  export schema AiHearing : meta {
    field radius : float(0..120);
  }
}
`,
      'assets/models/sword_actor.ashfox': actorModelSource(),
      'assets/structures/outpost.ashfox': outpostStructSource(),
      'assets/sprites/medkit.ashfox': medkitSpriteSource(),
      'assets/sounds/slash_sfx.ashfox': `ashfox 1
sound slash_sfx {
  import "../module/br_rules.ashfox" as br;
  profile = impact;
  duration = 0.25s;
  seed = 42;
  space { preset = dry_close; mix = 15%; }
  voice hit : aero_whoosh {
    velocity = lin(0: 0.4 -> 0.25: 2.0 -> 1: 0.25);
    thickness = 0.03;
    doppler = 0.5;
    sweep_pan = -0.4 -> 0.4;
    noise_tone = 0.7;
    filter : bandpass { cutoff = log(0: 8000hz -> 1: 600hz); q = 1.2; }
    gain { env = ad; attack = 4ms; peak = 0.9; curve = exp; }
  }
  seq main {
    start = 10ms;
    step swing { voice = hit; at = 0s; duration = 180ms; }
  }
  variants { base = 42; alternate = 43; }
  master { gain = 3db; target = -12lufs; peak = -1.5db; limit = true; }
  meta radius_meta : br.AiHearing { target = slash_sfx; radius = 32; }
}
`,
    });

    const wsPath = path.join(wsDir, '.ashfoxworkspace');
    const buildRes = runCli('build', wsPath, '--bindings', 'ts,cs,gd', '--json');
    assert.equal(buildRes.status, 0, buildRes.stdout + buildRes.stderr);
    const built = JSON.parse(buildRes.stdout).result;

    // 1. Verify bindings directory artifacts for TS, C#, and GDScript.
    const bindingsDir = path.join(wsDir, 'dist/build/bindings');
    const bindingFiles = fs.readdirSync(bindingsDir).sort();
    assert.equal(bindingFiles.length, 3, JSON.stringify(bindingFiles));
    const tsFile = bindingFiles.find((f) => f.endsWith('.d.ts'))!;
    const csFile = bindingFiles.find((f) => f.endsWith('.cs'))!;
    const gdFile = bindingFiles.find((f) => f.endsWith('.gd'))!;
    assert.match(fs.readFileSync(path.join(bindingsDir, tsFile), 'utf8'), /BrRulesLootSpawn/);
    assert.match(
      fs.readFileSync(path.join(bindingsDir, csFile), 'utf8'),
      /namespace Ashfox\.Hooks/,
    );
    assert.match(fs.readFileSync(path.join(bindingsDir, gdFile), 'utf8'), /class_name AshfoxHooks/);

    const exportDir = (expId: string): string => {
      const match = (built.exports as { id: string; directory: string }[]).find(
        (e) => e.id === expId,
      );
      assert.ok(match, `Missing export ${expId}`);
      return match.directory;
    };

    // 2. Verify <target>.hooks.json across model, structure, sprite, sound exports.
    for (const expId of [
      'sword_glb',
      'outpost_glb',
      'outpost_nbt',
      'medkit_png',
      'slash_wav',
    ] as const) {
      const hooksPath = path.join(exportDir(expId), `${expId}.hooks.json`);
      assert.ok(fs.existsSync(hooksPath), `Missing ${hooksPath}`);
      const hooksJson = JSON.parse(fs.readFileSync(hooksPath, 'utf8'));
      assert.equal(hooksJson.schemaVersion, 1);
    }

    // 3. Verify glTF extras.ashfox.hooks, bone-parented Empty Node, and gltf-validator.
    const swordGlb = fs.readFileSync(path.join(exportDir('sword_glb'), 'sword_glb.glb'));
    const swordGltf = parseGlbJson(swordGlb);
    assert.equal(swordGltf.extras?.ashfox?.hooks?.anchors.length, 1);
    const anchorIdx = swordGltf.nodes.findIndex((n) => n.name === 'anchor_hilt_loot');
    assert.ok(anchorIdx >= 0);
    assert.equal(swordGltf.nodes[anchorIdx]?.mesh, undefined);
    const rootBoneNode = swordGltf.nodes.find((n) => n.name === 'root');
    assert.ok(rootBoneNode?.children?.includes(anchorIdx));

    const glbReport = await validator.validateBytes(swordGlb, {
      externalResourceFunction: async () => {
        throw new Error('GLB must be self-contained');
      },
    });
    assert.equal(glbReport.issues.numErrors, 0);

    // 4. Verify NBT mc_block override and bundle verification with .hooks.json present.
    const nbt = decodeStructureNbt(
      fs.readFileSync(path.join(exportDir('outpost_nbt'), 'outpost_nbt.nbt')),
    );
    assert.ok(nbt.palette.some((e) => e.Name === 'minecraft:trapped_chest'));
    assert.ok(built.exports.length >= 5);

    const checkBundle = runCli('check', path.join(wsDir, 'dist/build'));
    assert.equal(checkBundle.status, 0, checkBundle.stdout + checkBundle.stderr);

    // 5. Verify CLI rejects inline schema in ashfox 1 entry file.
    const badDir = path.join(temp, 'bad_inline');
    fs.cpSync(wsDir, badDir, { recursive: true });
    const badSprite = path.join(badDir, 'assets/sprites/medkit.ashfox');
    fs.writeFileSync(
      badSprite,
      fs
        .readFileSync(badSprite, 'utf8')
        .replace(
          'anchor icon_loot',
          'schema InlineTag : anchor { field tag : string; }\n  anchor icon_loot',
        ),
    );
    const badCheck = runCli('check', '--no-cache', path.join(badDir, '.ashfoxworkspace'), '--json');
    assert.notEqual(badCheck.status, 0);
    assert.match(badCheck.stdout + badCheck.stderr, /hooks\.inline-schema-forbidden/);

    console.log('ashfox hooks CLI integration tests ok');
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
