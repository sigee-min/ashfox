import assert from 'node:assert/strict';

import { compileAssetWorkspaceEntry } from '../../src';
import { parseAssetSource } from '../../src/project/program/asset/parse';
import { parseAshfoxProgram } from '../../src/project/program/syntax/blockParser';
import { lexProgramSource } from '../../src/project/program/syntax/lex';
import type { AuthoredAssetWorkspace } from '../../src/project/workspace';
import {
  computePackageInterfaceHash,
  withWorkspaceLimits,
  type WorkspaceDiagnostic,
  type WorkspaceModuleAbi,
} from '../../src/project/workspace';
import { makeIndexes, parseWorkspaceSources } from '../../src/project/workspace/graphSource';
import { workspaceFixture } from '../project/workspace/fixtures';

// 1. Lexer: ashfox 1 header, no hyphenated header, .. / -> operators, #RRGGBBAA, all units
{
  const lexed = lexProgramSource(
    'ashfox 1\nmodel x { r = 7..18; t = 0.10s..0.34s; a = -45deg..65deg; }',
  );
  assert.equal(lexed.diagnostics.length, 0);
  assert.equal(lexed.tokens[0]?.value, 'ashfox');
  assert.equal(lexed.tokens[1]?.value, '1');
  assert.equal(lexed.tokens[2]?.value, 'model');
  const values = lexed.tokens.map((t) => `${t.kind}:${t.value}`);
  assert.ok(values.includes('number:7'));
  assert.ok(values.includes('symbol:..'));
  assert.ok(values.includes('number:18'));
  assert.ok(values.includes('number:0.10s'));
  assert.ok(values.includes('number:0.34s'));
  assert.ok(values.includes('symbol:-'));
  assert.ok(values.includes('number:45deg'));
  assert.ok(values.includes('number:65deg'));

  const colors = lexProgramSource('ashfox 1\nmodel c { a = #FF8800; b = #ff8800aa; }');
  assert.equal(colors.diagnostics.length, 0);
  assert.equal(
    colors.tokens.find((t) => t.kind === 'color' && t.value === '#ff8800')?.value,
    '#ff8800',
  );
  assert.equal(
    colors.tokens.find((t) => t.kind === 'color' && t.value === '#ff8800aa')?.value,
    '#ff8800aa',
  );

  for (const badColor of ['#12345', '#1234567', '#123456789']) {
    const res = lexProgramSource(`ashfox 1\nmodel c { a = ${badColor}; }`);
    assert.ok(
      res.diagnostics.some((d) => d.code === 'program.invalid-color'),
      badColor,
    );
  }

  const allUnits = lexProgramSource(
    'ashfox 1\nsound u { a = 1s; b = 4ms; c = 90deg; d = 2.5u; e = 16px; f = 3b; g = 680hz; h = -1.5db; i = -13lufs; j = 12st; k = -65cents; l = 45%; }',
  );
  assert.equal(allUnits.diagnostics.length, 0);

  for (const badUnit of ['0.25ratio', '16tx']) {
    const res = lexProgramSource(`ashfox 1\nmodel u { a = ${badUnit}; }`);
    assert.ok(
      res.diagnostics.some((d) => d.code === 'program.invalid-number-unit'),
      badUnit,
    );
  }
}

// 2. Unified LL(1) blockParser across all 6 domains, ranges, transitions + easing, unquoted enums
{
  const modelSrc = `ashfox 1
model fox {
  import "./rig.ashfox" as rig;
  import "./surface.ashfox" as surface;
  import "./body.ashfox" as body;
  settings { density = 16; forward = north; profile = creature; }
  skeleton = rig.CreatureSkeleton;
  motions = [rig.idle, rig.run, rig.pounce];
  use body.FoxBody { skeleton = rig.CreatureRig; skin = surface.red_fox; }
}`;
  const modelRes = parseAshfoxProgram(modelSrc, 'fox.ashfox');
  assert.equal(modelRes.diagnostics.length, 0, JSON.stringify(modelRes.diagnostics));
  assert.equal(modelRes.file?.top.kind, 'model');
  assert.equal(modelRes.file?.top.name, 'fox');

  const spriteSrc = `ashfox 1
sprite iron_sword {
  import "../module/shared.ashfox" as shared;
  profile = item;
  canvas = (32px, 32px);
  palette { glint = #ffffff; alpha_rim = #78eeff80; }
  polygon blade_body {
    points = [(11px, 16px), (15px, 20px), (26px, 9px)];
    material = shared.steel;
    shade { form = bevel; light = top_left; contrast = 2; }
    pattern gradient { axis = radial; to_material = shared.steel_edge; dither = false; seed = 7; }
  }
  outline edge { mode = sel_out; strength = 2; inner_rim = true; }
}`;
  const spriteRes = parseAshfoxProgram(spriteSrc, 'sword.ashfox');
  assert.equal(spriteRes.diagnostics.length, 0, JSON.stringify(spriteRes.diagnostics));
  assert.equal(spriteRes.file?.top.kind, 'sprite');

  const soundSrc = `ashfox 1
sound sword_slash {
  import "../std/audio/foley.ashfox" as foley;
  profile = impact;
  duration = 0.56s;
  seed = 5193;
  space { preset = courtyard; mix = 16%; }
  voice air_slice : aero_whoosh {
    cutoff = 1800hz -> 8800hz ease_out -> 950hz;
    q = 1.1; highpass = 85hz;
    gain { env = ad; attack = 6ms; peak = 0.96; curve = exp; }
  }
  seq slash {
    start = 10ms;
    step whoosh { voice = air_slice; at = 0ms; duration = 0.34s; vary_gain = 90%..110%; }
    step edge { voice = air_slice; at = 10ms; duration = 0.38s; vary_pitch = -65cents..65cents; }
  }
  master { target = -13lufs; peak = -1.5db; punch = 45%; air = 25%; limit = true; }
}`;
  const soundRes = parseAshfoxProgram(soundSrc, 'slash.ashfox');
  assert.equal(soundRes.diagnostics.length, 0, JSON.stringify(soundRes.diagnostics));
  assert.equal(soundRes.file?.top.kind, 'sound');
  const voiceBlock = soundRes.file!.top.block.statements.find(
    (s) => s.kind === 'named-block' && s.blockKind === 'voice',
  );
  assert.equal(voiceBlock?.kind, 'named-block');
  if (voiceBlock?.kind === 'named-block') {
    const cutoff = voiceBlock.block.statements.find(
      (s) => s.kind === 'assign' && s.path === 'cutoff',
    );
    assert.equal(cutoff?.kind, 'assign');
    if (cutoff?.kind === 'assign') {
      assert.equal(cutoff.value.kind, 'transition');
      if (cutoff.value.kind === 'transition') {
        assert.equal(cutoff.value.steps.length, 3);
        assert.equal(cutoff.value.steps[1]?.easing?.name, 'ease_out');
      }
    }
  }

  const structureSrc = `ashfox 1
structure tavern {
  import "../std/arch/medieval.ashfox" as med;
  density = 2; seed = 404; size = (19b, 22b, 17b);
  outputs = [java_structure, glb];
  palette {
    stone_brick = mix("minecraft:stone_bricks" * 75%, "minecraft:mossy_stone_bricks" * 25%);
    oak_floor = "minecraft:oak_planks";
  }
  floor ground {
    y = 0b; height = 5b;
    room taproom {
      from = (1b, 1b); size = (15b, 9b); kind = tavern;
      floor = oak_floor;
      zone hearth_lounge { from = (1b, 1b); size = (6b, 5b); floor_offset = -0.25b; }
    }
    facade taproom.south {
      door main { at = 2b; width = 2b; height = 2b; hinge = left; porch { depth = 2b; } }
    }
  }
}`;
  const structureRes = parseAshfoxProgram(structureSrc, 'tavern.ashfox');
  assert.equal(structureRes.diagnostics.length, 0, JSON.stringify(structureRes.diagnostics));
  assert.equal(structureRes.file?.top.kind, 'structure');

  const vfxSrc = `ashfox 1
vfx flame_cleave {
  import "../std/vfx/palettes.ashfox" as pal;
  duration = 0.65s; fps = 30; loop = once;
  palette = pal.EmberSolar;
  element main_slash : slash_arc {
    at = 0.10s..0.34s; blend = additive;
    radius = 7u..18u; arc = -75deg..95deg;
    rotation_y = -35deg -> 115deg snap;
    curve_test = 0u -> 6.5u cubic_bezier(0.2, 0, 0.8, 1) -> 0u;
  }
  emitter sparks : voxel_burst {
    at = 0.13s..0.62s; count = 28;
    size_over_life = 1.2u -> 0.9u -> 0u;
    color_over_life = core -> mid -> edge;
  }
}`;
  const vfxRes = parseAshfoxProgram(vfxSrc, 'cleave.ashfox');
  assert.equal(vfxRes.diagnostics.length, 0, JSON.stringify(vfxRes.diagnostics));
  assert.equal(vfxRes.file?.top.kind, 'vfx');

  const moduleSrc = `ashfox 1
module game_world {
  export schema LootSpawn : anchor {
    field tier : enum(common, rare, epic) = common;
    field respawn : second = 120s;
    mc_block = "minecraft:chest[facing=\${facing}]";
  }
}`;
  const moduleRes = parseAshfoxProgram(moduleSrc, 'game_world.ashfox');
  assert.equal(moduleRes.diagnostics.length, 0, JSON.stringify(moduleRes.diagnostics));
  assert.equal(moduleRes.file?.top.kind, 'module');
}

// 3. Strict rejection of legacy headers, kebab-case, camelCase, and double-wrapped asset
{
  const badHeaders = [
    'ashfox-' + 'model 1\nmodel x {}',
    'ashfox-' + 'vfx 1\nvfx x {}',
    'ashfox ' + '2\nmodel x {}',
    'ashfox 1\nasset x {}',
  ];
  for (const bad of badHeaders) {
    assert.ok(parseAshfoxProgram(bad).diagnostics.length > 0, bad);
    assert.ok(parseAssetSource(bad).diagnostics.length > 0, bad);
  }

  const badKeys = [
    'ashfox 1\nmodel x { ' + 'parent-' + 'origin = (0u, 0u, 0u); }',
    'ashfox 1\nmodel x { ' + 'background-' + 'alpha = 255; }',
    'ashfox 1\nmodel x { ' + 'to' + 'Material = shared.steel; }',
    'ashfox 1\nsound x { ' + 'sample' + 'Rate = 48000hz; }',
    'ashfox 1\nsprite x { ' + 'inner' + 'Rim = true; }',
  ];
  for (const bad of badKeys) {
    const res = parseAshfoxProgram(bad);
    assert.ok(res.diagnostics.length > 0, bad);
  }

  const doubleAsset = 'ashfox 1\nmodel x { export asset x {} }';
  assert.ok(parseAssetSource(doubleAsset).diagnostics.length > 0);
}

// 4. End-to-end model compilation using sensible defaults & snake_case keys
{
  const rigSrc = `ashfox 1
module rig {
  export rig contract CreatureRig {
    joint root { role = root; channels = (rotation, scale); }
    joint head { parent = root; role = head; channels = rotation; }
  }
  export skeleton WolfSkeleton implements CreatureRig {
    bind root { parent_origin = (0u, 0u, 0u); }
    bind head { parent_origin = (0u, 6u, -2u); }
  }
  export motion idle for CreatureRig {
    duration = 1000ms; fps = 20; loop = loop;
    track head.rotation {
      key 0s = (0deg, 0deg, 0deg) linear;
      key 1s = (5deg, 0deg, 0deg) linear;
    }
  }
}`;
  const surfaceSrc = `ashfox 1
module surface {
  export surface contract Fur {
    atlas { width = 32px; height = 32px; }
    chart head box { width = 16px; height = 8px; }
    chart ear flat { width = 4px; height = 4px; }
    material = double;
  }
  export surface coat: Fur {
    material = double;
    texture atlas {
      density = 1;
      background = bg;
      background_alpha = 255;
      render_mode = default;
      palette {
        bg = #3a231c;
        coat = (#5c3324, #8c4f37, #bf7252);
      }
      chart head box { origin = (0px, 0px); fill = coat; }
      chart ear flat { origin = (0px, 16px); fill = coat; }
    }
  }
}`;
  const bodySrc = `ashfox 1
module body {
  import "./rig.ashfox" as rig;
  import "./surface.ashfox" as surface;
  export component WolfBody {
    requires rig skeleton: rig.CreatureRig;
    requires surface skin: surface.Fur;
    bind bone root to skeleton.root;
    bind bone head to skeleton.head;
    geometry {
      bone root {
        bone head {
          cube skull { origin = (-2u, 0u, -2u); size = (4u, 4u, 4u); surface = skin.head; }
          plane ear_l {
            origin = (-2.1u, 3u, 0u); size = (4u, 4u);
            u_axis = (0u, 0u, 1u); v_axis = (0u, 1u, 0u);
            mirror_x = ear_r;
            surface = skin.ear;
          }
        }
      }
    }
  }
}`;
  const mainSrc = `ashfox 1
model wolf {
  import "./rig.ashfox" as rig;
  import "./surface.ashfox" as surface;
  import "./body.ashfox" as body;
  settings { density = 16; forward = north; profile = creature; }
  skeleton = rig.WolfSkeleton;
  motions = [rig.idle];
  use body.WolfBody { skeleton = rig.CreatureRig; skin = surface.coat; }
}`;

  const base = workspaceFixture(
    [
      { path: 'wolf/main.ashfox', source: mainSrc },
      { path: 'wolf/rig.ashfox', source: rigSrc },
      { path: 'wolf/surface.ashfox', source: surfaceSrc },
      { path: 'wolf/body.ashfox', source: bodySrc },
    ],
    {
      root: 'wolf',
      packageName: 'wolf',
      entries: [{ name: 'wolf', path: 'main.ashfox' }],
      modules: [
        { subpath: './rig', path: 'rig.ashfox' },
        { subpath: './surface', path: 'surface.ashfox' },
        { subpath: './body', path: 'body.ashfox' },
      ],
    },
  );
  const indexes = makeIndexes(base);
  const diagnostics: WorkspaceDiagnostic[] = [];
  const states = parseWorkspaceSources(indexes, diagnostics, withWorkspaceLimits(undefined));
  assert.equal(diagnostics.length, 0, JSON.stringify(diagnostics));
  const abis: WorkspaceModuleAbi[] = [];
  for (const [key, state] of states ?? []) {
    if (!state.abi) continue;
    const path = key.slice(key.indexOf('\u0000') + 1);
    const subpath = indexes.get('wolf')?.modulesByPath.get(path)?.subpath;
    if (subpath) abis.push({ ...state.abi, subpath });
  }
  const sealed: AuthoredAssetWorkspace = {
    ...base,
    lock: {
      ...base.lock,
      packages: [
        {
          ...base.lock.packages[0]!,
          interfaceHash: computePackageInterfaceHash(base.manifest.packages[0]!, abis),
        },
      ],
    },
  };
  const compiled = compileAssetWorkspaceEntry(sealed, { packageName: 'wolf', entryName: 'wolf' });
  assert.equal(compiled.ok, true, compiled.ok ? '' : JSON.stringify(compiled.diagnostics));
  if (compiled.ok) {
    assert.ok(Object.values(compiled.model.scene.nodes).some((n) => n.id.includes('ear_r')));
    assert.ok(Object.values(compiled.model.animations).some((a) => a.name === 'idle'));
  }
  const mainWithSemicolon = mainSrc.replace(
    'use body.WolfBody { skeleton = rig.CreatureRig; skin = surface.coat; }',
    'use body.WolfBody { skeleton = rig.CreatureRig; skin = surface.coat; };',
  );
  const semiRes = parseAssetSource(mainWithSemicolon);
  assert.equal(semiRes.diagnostics.length, 0, JSON.stringify(semiRes.diagnostics));
}

console.log('ashfox 1 unified grammar tests pass');
