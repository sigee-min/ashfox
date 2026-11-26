import assert from 'node:assert/strict';
import * as EngineCore from '../../src/index';
import {
  compileDirectoryWorkspace,
  decodeStructureNbt,
  exportStructureGltfResolved,
  openAssetProject,
  parseStructureSource,
  type DirectoryFile,
} from '../../src/index';
import { adaptProjectForExport } from '../../src/export/adapter';
import { validateExportTarget } from '../../src/export/pipeline/validate';
import { buildGltf } from '../../src/export/targets/gltf/exporter';
import { appendHooksToGltfDocument } from '../../src/export/targets/gltf/hooksEmit';
import { workspaceFixture } from '../project/workspace/fixtures';

const validator = require('gltf-validator') as {
  validateBytes: (
    bytes: Uint8Array,
    opts?: { externalResourceFunction?: (uri: string) => Promise<Uint8Array> },
  ) => Promise<{ issues: { numErrors: number; numWarnings: number; messages?: unknown[] } }>;
};

const BR_RULES = `ashfox 1
module br_rules {
  export schema LootSpawn : anchor {
    field tier : enum(common, rare, epic) = common;
    field chance : float(0..1) = 0.65;
    field table : string;
    mc_block = "minecraft:chest[facing=\${facing}]";
  }
  export schema StormShelter : volume {
    field shield_ratio : float(0..1) = 1.0;
  }
  export schema MeleeHitbox : cue {
    field arc_deg : deg(10..360) = 110deg;
    field damage : number = 20;
  }
  export schema AiHearing : meta {
    field radius : float(0..120);
  }
}
`;

const CHEST_MODEL = `ashfox 1
model sword_actor {
  import "shared_modules/br_rules" as br;
  rig contract ActorRig {
    joint root { parent = none; role = root; channels = rotation; }
    joint hand_r { parent = root; role = limb; channels = rotation; }
  }
  skeleton ActorSkeleton implements ActorRig {
    bind root { parent_origin = (0u, 0u, 0u); }
    bind hand_r { parent_origin = (4u, 8u, 0u); }
  }
  surface contract ActorSurface {
    chart base box { coverage = opaque; }
    chart blade box { coverage = opaque; }
    material = opaque;
  }
  surface bronze_blade: ActorSurface {
    material = opaque;
    texture atlas {
      density = 2;
      background = shade;
      background_alpha = 255;
      palette {
        shade = #2b303a;
        dark = (#1e222b, #2b303a, #3e4554);
        wood = (#5e3e22, #8b5a2b, #b87e47);
        steel = (#5c6678, #8d9bb0, #c8d4e6);
      }
      chart base box {
        fill = wood;
        grain = clustered;
        pattern border { paint = dark; width = 1px; edges = all; }
      }
      chart blade box {
        fill = steel;
        grain = soft;
        pattern border { paint = wood; width = 1px; edges = bottom; }
      }
      grain clustered { seed = 404; }
      tone painterly;
    }
  }
  component SwordBody {
    requires rig skeleton: ActorRig;
    requires surface skin: ActorSurface;
    bind bone root to skeleton.root;
    bind bone hand_r to skeleton.hand_r;
    geometry {
      bone root {
        cube plinth { origin = (-2u, 0u, -2u); size = (4u, 2u, 4u); surface = skin.base; }
      }
      bone hand_r {
        cube blade { origin = (-1u, -2u, -1u); size = (2u, 8u, 2u); surface = skin.blade; }
      }
    }
  }
  anchor muzzle_loot : br.LootSpawn { bone = hand_r; at = (0u, 6u, 0u); facing = north; tier = rare; table = "br:weapon_drop"; }
  cue swing : br.MeleeHitbox { clip = slash; at = 0.1s..0.35s; arc_deg = 120deg; damage = 32; }
  settings { density = 16; forward = north; profile = prop; }
  skeleton = ActorSkeleton;
  use SwordBody as model { skeleton = ActorRig; skin = bronze_blade; }
}
`;

const OUTPOST_STRUCT = `ashfox 1
structure outpost {
  import "../module/br_rules.ashfox" as br;
  density = 2; seed = 77; size = (11b, 8b, 11b);
  palette {
    stone = "minecraft:stone_bricks";
    plank = "minecraft:oak_planks";
    timber = "minecraft:spruce_log[axis=y]";
    door = "minecraft:oak_door[facing=south,half=lower,hinge=left,open=false]";
  }
  floor ground {
    y = 0b; height = 5b;
    room br_bunker {
      from = (1b, 1b); size = (8b, 7b); kind = br_bunker;
      floor = plank; wall = stone; frame = timber; ceiling = plank;
      anchor vault_chest : br.LootSpawn { at = (3b, 1b, 3b); facing = south; tier = epic; table = "br:vault"; }
      volume shelter_zone : br.StormShelter { from = (0b, 0b, 0b); size = (8b, 4b, 7b); enclosure = enclosed; shield_ratio = 0.9; }
    }
    facade br_bunker.south { door { at = center; width = 1b; height = 2b; block = door; } }
    anchor entry_door : std.entry { at = (5b, 1b, 7b); facing = south; width = 1; room = br_bunker; }
  }
  zone courtyard_zone : std.courtyard { from = (1b, 0b, 8b); to = (9b, 4b, 10b); enclosure = semi_open; shape = rect; pool = "yard"; }
  mc_block vault_chest = "minecraft:trapped_chest[facing=south]";
}
`;

const MEDKIT_SPRITE = `ashfox 1
sprite medkit {
  import "../module/br_rules.ashfox" as br;
  profile = item;
  canvas = (16px, 16px);
  palette { red = #cc2222; white = #f0f0f0; }
  paint cross {
    at = (5px, 5px);
    rows = ["wwrw", "rrrr", "wwrw"];
    colors { r = red; w = white; }
  }
  anchor pickup : br.LootSpawn {
    at = (8px, 8px);
    tier = rare;
    table = "br:meds";
  }
  outputs { png; }
}
`;

const SLASH_SOUND = `ashfox 1
sound slash_sfx {
  import "../module/br_rules.ashfox" as br;
  profile = impact;
  duration = 0.25s;
  seed = 42;
  space { preset = dry_close; mix = 15%; }
  voice whoosh : aero_whoosh {
    velocity = lin(0: 0.4 -> 0.25: 2.0 -> 1: 0.25);
    thickness = 0.03;
    doppler = 0.5;
    sweep_pan = -0.4 -> 0.4;
    noise_tone = 0.7;
    filter : bandpass { cutoff = log(0: 8000hz -> 1: 600hz); q = 1.2; }
    gain { env = ad; attack = 5ms; peak = 0.9; curve = exp; }
  }
  seq main {
    start = 10ms;
    step hit { voice = whoosh; at = 0s; duration = 200ms; }
  }
  variants { base = 42; alternate = 43; }
  master { gain = 3db; target = -12lufs; peak = -1.5db; limit = true; }
  meta hearing : br.AiHearing {
    target = slash_sfx;
    radius = 28.0;
  }
  outputs { wav; }
}
`;

const makeBrWorkspace = (): string =>
  JSON.stringify({
    format: 'ashfox-workspace',
    version: 2,
    name: 'br-cross-domain',
    packages: [
      {
        name: 'shared_modules',
        root: 'assets/module',
        manifest: {
          format: 'ashfox-package',
          version: 1,
          entries: [],
          modules: [{ subpath: './br_rules', path: 'br_rules.ashfox' }],
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
    exports: [],
  });

const toGlbBytes = (doc: unknown, bin: Uint8Array): Uint8Array => {
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

const parseGlbJson = (bytes: Uint8Array) => {
  const magic = Buffer.from(bytes).subarray(0, 4).toString('utf8');
  assert.equal(magic, 'glTF');
  const jsonLen = Buffer.from(bytes).readUInt32LE(12);
  return JSON.parse(Buffer.from(bytes.subarray(20, 20 + jsonLen)).toString('utf8')) as {
    nodes: { name?: string; mesh?: number; children?: number[]; translation?: number[] }[];
    meshes?: { primitives: unknown[] }[];
    extras?: { ashfox?: { hooks?: { anchors: unknown[]; cues: unknown[] } } };
  };
};

const countMeshDraws = (gltf: ReturnType<typeof parseGlbJson>): number =>
  (gltf.meshes ?? []).reduce((sum, m) => sum + m.primitives.length, 0);

const main = async (): Promise<void> => {
  // 1. Cross-genre BR workspace compilation resolves hooks on model, structure, sprite, sound.
  const files: DirectoryFile[] = [
    { path: 'assets/module/br_rules.ashfox', source: BR_RULES },
    { path: 'assets/models/sword_actor.ashfox', source: CHEST_MODEL },
    { path: 'assets/structures/outpost.ashfox', source: OUTPOST_STRUCT },
    { path: 'assets/sprites/medkit.ashfox', source: MEDKIT_SPRITE },
    { path: 'assets/sounds/slash_sfx.ashfox', source: SLASH_SOUND },
  ];
  const ws = compileDirectoryWorkspace(makeBrWorkspace(), files);
  if (!ws.ok) assert.fail(JSON.stringify(ws.diagnostics));
  assert.equal(ws.products.length, 4);

  const modelProd = ws.products.find((p) => p.kind === 'model');
  const structProd = ws.products.find((p) => p.kind === 'structure');
  const spriteProd = ws.products.find((p) => p.kind === 'sprite');
  const soundProd = ws.products.find((p) => p.kind === 'sound');
  assert.ok(modelProd && structProd && spriteProd && soundProd);

  assert.equal(modelProd.hooks?.anchors[0]?.id, 'muzzle_loot');
  assert.deepEqual(modelProd.hooks?.anchors[0]?.position, [4, 14, 0]);
  assert.equal(modelProd.hooks?.cues[0]?.id, 'swing');
  assert.equal(spriteProd.hooks?.anchors[0]?.space, '2d');
  assert.equal(soundProd.hooks?.meta[0]?.props.radius, 28);

  // 2. Structure NBT reflects mc_block override & std.entry jigsaw; free-form room kind allowed.
  assert.equal(structProd.structure.grid.rooms[0]?.kind, 'br_bunker');
  assert.equal(structProd.structure.grid.sockets[0]?.schema, 'std.entry');
  assert.equal(structProd.structure.hooks?.anchors.length, 2);
  assert.equal(structProd.structure.hooks?.volumes[0]?.id, 'shelter_zone');
  assert.equal(structProd.structure.hooks?.zones[0]?.id, 'courtyard_zone');

  const decodedNbt = decodeStructureNbt(structProd.structure.nbt);
  assert.ok(decodedNbt.palette.some((e) => e.Name === 'minecraft:trapped_chest'));
  assert.ok(decodedNbt.palette.some((e) => e.Name === 'minecraft:jigsaw'));

  // 3. glTF Empty Nodes + extras.ashfox.hooks add zero draw calls & pass gltf-validator cleanly.
  const modelOnlySrc = CHEST_MODEL.replace('  import "shared_modules/br_rules" as br;\n', '');
  const modelFiles: DirectoryFile[] = [
    { path: 'assets/models/sword_actor.ashfox', source: modelOnlySrc },
  ];
  const opened = openAssetProject({
    workspace: workspaceFixture(modelFiles, {
      root: 'assets/models',
      packageName: 'models',
      entries: [{ name: 'sword_actor', path: 'sword_actor.ashfox' }],
      modules: [],
    }),
    entry: { packageName: 'models', entryName: 'sword_actor' },
    identity: { id: 'sword_actor', revision: 'r1', createdAt: '2026-01-01T00:00:00.000Z' },
  });
  assert.equal(opened.ok, true);
  if (!opened.ok) return;
  const adapted = adaptProjectForExport(opened.project.document, {
    target: 'glb',
    modelPath: 'sword_actor',
  });
  const validated = validateExportTarget(adapted, { profileId: 'gltf.2', errorMessage: 'bad' });
  const compiledGltf = buildGltf(validated.document);
  const hookedDoc = appendHooksToGltfDocument(compiledGltf.document, modelProd.hooks!, {
    unitScale: 1 / 16,
  });
  const plainJson = compiledGltf.document as unknown as ReturnType<typeof parseGlbJson>;
  const hookedJson = hookedDoc as unknown as ReturnType<typeof parseGlbJson>;
  assert.equal(countMeshDraws(hookedJson), countMeshDraws(plainJson));
  assert.equal(hookedJson.extras?.ashfox?.hooks?.anchors.length, 1);
  assert.equal(hookedJson.extras?.ashfox?.hooks?.cues.length, 1);

  const anchorNodeIdx = hookedJson.nodes.findIndex((n) => n.name === 'anchor_muzzle_loot');
  assert.ok(anchorNodeIdx >= 0);
  const anchorNode = hookedJson.nodes[anchorNodeIdx]!;
  assert.equal(anchorNode.mesh, undefined);
  assert.deepEqual(anchorNode.translation, [0, 6 / 16, 0]);
  const handNode = hookedJson.nodes.find((n) => n.name === 'hand_r');
  assert.ok(handNode?.children?.includes(anchorNodeIdx));

  const texByName = new Map<string, Uint8Array>();
  for (const tf of compiledGltf.textureFiles) {
    if (tf.kind === 'binary') texByName.set(tf.path.split('/').pop()!, tf.data);
  }
  const modelReport = await validator.validateBytes(toGlbBytes(hookedDoc, compiledGltf.binary), {
    externalResourceFunction: async (uri) =>
      texByName.get(uri.split('/').pop()!) ?? new Uint8Array(),
  });
  assert.equal(modelReport.issues.numErrors, 0, JSON.stringify(modelReport.issues));
  assert.equal(modelReport.issues.numWarnings, 0, JSON.stringify(modelReport.issues));

  const structBundle = await exportStructureGltfResolved(
    structProd.structure,
    'outpost',
    'test-key',
    { encoding: 'portable' },
  );
  const structGlbFile = structBundle.files.find((f) => f.path === 'outpost.glb');
  assert.ok(structGlbFile?.kind === 'binary');
  const structGltf = parseGlbJson(structGlbFile.data);
  assert.ok(structGltf.nodes.some((n) => n.name === 'anchor_vault_chest'));
  assert.equal(structGltf.extras?.ashfox?.hooks?.anchors.length, 2);
  const structReport = await validator.validateBytes(structGlbFile.data, {
    externalResourceFunction: async () => {
      throw new Error('GLB must be self-contained');
    },
  });
  assert.equal(structReport.issues.numErrors, 0, JSON.stringify(structReport.issues));

  // 4. Directory modularity guard rejects inline schema and cross-file duplicate palette.
  const inlineBad = compileDirectoryWorkspace(
    makeBrWorkspace(),
    files.map((f) =>
      f.path === 'assets/sprites/medkit.ashfox'
        ? {
            path: f.path,
            source: f.source.replace(
              'anchor pickup',
              'schema LocalOnly : anchor { field tag : string; }\n  anchor pickup',
            ),
          }
        : f,
    ),
  );
  assert.equal(inlineBad.ok, false);
  assert.ok(
    inlineBad.diagnostics.some(
      (d) =>
        d.code === 'hooks.inline-schema-forbidden' ||
        d.message.includes('hooks.inline-schema-forbidden'),
    ),
    JSON.stringify(inlineBad.diagnostics),
  );

  const dupPkg = {
    name: 'dup',
    root: 'assets',
    manifest: {
      format: 'ashfox-package',
      version: 1,
      entries: [
        { name: 'a', path: 'structures/a.ashfox' },
        { name: 'b', path: 'structures/b.ashfox' },
      ],
      modules: [],
      dependencies: [],
    },
  };
  const dupWs = JSON.stringify({
    format: 'ashfox-workspace',
    version: 2,
    name: 'dup-check',
    packages: [dupPkg],
    include: ['assets/**/*.ashfox'],
    ignore: [],
    build: { directory: 'dist/build' },
    exports: [],
  });
  const srcA =
    'ashfox 1\nstructure a {\n  size = (5b, 4b, 5b);\n  palette { cobble = "minecraft:cobblestone"; stone = "minecraft:stone_bricks"; plank = "minecraft:oak_planks"; }\n  box { from = (0b, 0b, 0b); to = (4b, 0b, 4b); block = cobble; }\n  set { at = (1b, 1b, 1b); block = stone; }\n  set { at = (2b, 1b, 1b); block = plank; }\n}';
  const srcB =
    'ashfox 1\nstructure b {\n  size = (5b, 4b, 5b);\n  palette { plank = "minecraft:oak_planks"; cobble = "minecraft:cobblestone"; stone = "minecraft:stone_bricks"; }\n  box { from = (0b, 0b, 0b); to = (4b, 0b, 4b); block = cobble; }\n  set { at = (1b, 1b, 1b); block = stone; }\n  set { at = (2b, 1b, 1b); block = plank; }\n}';
  const dupRes = compileDirectoryWorkspace(dupWs, [
    { path: 'assets/structures/a.ashfox', source: srcA },
    { path: 'assets/structures/b.ashfox', source: srcB },
  ]);
  assert.equal(dupRes.ok, false);
  assert.ok(
    dupRes.diagnostics.some((d) => d.code === 'modular.duplicate-boilerplate'),
    JSON.stringify(dupRes.diagnostics),
  );

  // 5. Legacy SocketKind / RoomKind / socket op + invalid imported schema default rejection.
  assert.equal('SocketKind' in EngineCore, false);
  assert.equal('RoomKind' in EngineCore, false);
  const badDefRes = compileDirectoryWorkspace(
    makeBrWorkspace(),
    files.map((f) =>
      f.path === 'assets/module/br_rules.ashfox'
        ? {
            ...f,
            source: f.source.replace(
              'chance : float(0..1) = 0.65;',
              'chance : float(0..1) = "bad";',
            ),
          }
        : f,
    ),
  );
  assert.equal(badDefRes.ok, false);
  assert.ok(
    badDefRes.diagnostics.some((d) => d.code.startsWith('hooks.')),
    JSON.stringify(badDefRes.diagnostics),
  );
  assert.throws(
    () =>
      parseStructureSource(
        'ashfox 1\nstructure legacy { size = (5b, 5b, 5b); socket s { kind = entry; at = (0b, 0b, 0b); } }',
        'legacy.ashfox',
      ),
    /got socket/i,
  );

  console.log('ashfox Phase 2 cross-domain hooks & modularity tests ok');
};

const pending = main().catch((err) => {
  console.error(err);
  process.exit(1);
});
const bucket = (globalThis as { __ashfoxEngineTestPromises?: Promise<unknown>[] })
  .__ashfoxEngineTestPromises;
if (Array.isArray(bucket)) bucket.push(pending);
