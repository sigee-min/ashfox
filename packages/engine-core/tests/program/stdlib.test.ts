import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  checkWorkspaceModularity,
  compileDirectoryWorkspace,
  describeVirtualModule,
  filterVirtualLibraries,
  isStdLibraryLogicalPath,
  isVirtualLibrarySpecifier,
  listVirtualLibraries,
  mergeVirtualLibraryFiles,
  resolveSourceImport,
  virtualLibraryLogicalPath,
  virtualLibrarySpecifierFromPath,
  type DirectoryFile,
} from '../../src';

const STD_DIR = path.join(path.resolve(__dirname, '../../../..'), 'library', 'std');

const walkStdDisk = (
  dir: string,
  rel = '',
  out = new Map<string, string>(),
): Map<string, string> => {
  for (const entry of fs
    .readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))) {
    const nextRel = rel ? `${rel}/${entry.name}` : entry.name;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkStdDisk(full, nextRel, out);
    else if (entry.isFile() && entry.name.endsWith('.ashfox')) {
      const spec = virtualLibrarySpecifierFromPath(`library/std/${nextRel}`);
      assert.ok(spec, `Non-canonical stdlib path: library/std/${nextRel}`);
      out.set(spec, fs.readFileSync(full, 'utf8'));
    }
  }
  return out;
};

const virtualLibs = walkStdDisk(STD_DIR);
assert.equal(virtualLibs.size, 97, `Expected 97 stdlib modules, got ${virtualLibs.size}`);

// 1. Validate canonical specifiers, pure ashfox 1 headers, zero version suffixes, and "std/*" internal imports.
for (const [spec, source] of virtualLibs) {
  assert.equal(isVirtualLibrarySpecifier(spec), true);
  assert.equal(isStdLibraryLogicalPath(virtualLibraryLogicalPath(spec)), true);
  assert.match(source.trimStart(), /^ashfox 1\b/);
  assert.equal(/\b(?:ashfox2|v2|audio3)\b/.test(source), false, `Version suffix in ${spec}`);
  const desc = describeVirtualModule(spec, source);
  assert.ok(desc.exports.length > 0, `Expected exports in ${spec}`);
  for (const imp of desc.imports) {
    assert.ok(isVirtualLibrarySpecifier(imp), `Internal import must use "std/...": ${spec}`);
  }
}
assert.equal(isVirtualLibrarySpecifier('std/model/rig/biped'), true);
assert.equal(isVirtualLibrarySpecifier('std/model/rig/biped.ashfox'), false);
assert.equal(isVirtualLibrarySpecifier('std/../bad'), false);
assert.equal(isVirtualLibrarySpecifier('std/Model/Rig/Biped'), false);
assert.equal(
  virtualLibraryLogicalPath('std/model/rig/biped'),
  'library/std/model/rig/biped.ashfox',
);

// 2. Catalog & resolver APIs.
assert.equal(listVirtualLibraries(virtualLibs).length, 97);
assert.equal(filterVirtualLibraries(virtualLibs, 'vfx').length, 27);
assert.equal(filterVirtualLibraries(virtualLibs, 'sound/combat').length, 3);
assert.ok(
  describeVirtualModule('std/sound/foley/footstep', virtualLibs.get('std/sound/foley/footstep')!)
    .params.length >= 2,
);
const lookup = new Set(['library/std/model/rig/biped.ashfox', 'assets/models/hero.ashfox']);
assert.equal(
  resolveSourceImport('assets/models/hero.ashfox', 'std/model/rig/biped', lookup),
  'library/std/model/rig/biped.ashfox',
);
assert.equal(resolveSourceImport('assets/models/hero.ashfox', './missing.ashfox', lookup), null);
const merged = mergeVirtualLibraryFiles(
  [
    {
      path: 'assets/models/hero.ashfox',
      source: 'ashfox 1 model h { import "std/model/motion/idle" as m; }',
    },
  ],
  virtualLibs,
  (p, s) => ({ path: p, source: s }),
);
assert.ok(merged.some((f) => f.path === 'library/std/model/motion/idle.ashfox'));
assert.ok(merged.some((f) => f.path === 'library/std/model/rig/biped.ashfox'));

const compileOne = (
  entryName: string,
  entryPath: string,
  source: string,
  extraFiles: readonly DirectoryFile[] = [],
) =>
  compileDirectoryWorkspace(
    JSON.stringify({
      format: 'ashfox-workspace',
      version: 2,
      name: 'stdlib_verify',
      packages: [
        {
          name: 'app',
          root: 'assets',
          manifest: {
            format: 'ashfox-package',
            version: 1,
            entries: [{ name: entryName, path: entryPath }],
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
    [{ path: `assets/${entryPath}`, source }, ...extraFiles],
    virtualLibs,
  );

const assertOk = (spec: string, entryName: string, entryPath: string, source: string) => {
  const res = compileOne(entryName, entryPath, source);
  assert.equal(res.ok, true, `Failed ${spec}: ${JSON.stringify(res.ok ? [] : res.diagnostics)}`);
};

// 3. Compile ALL 57 stdlib modules across all 6 domains.
const corePaletteCases: readonly [string, string, string, string, string][] = [
  [
    'std/core/palette/medieval',
    'CastleStone',
    'limestone_shadow',
    'limestone_base',
    'limestone_light',
  ],
  ['std/core/palette/element', 'FlamePalette', 'flame_edge', 'flame_mid', 'ember_core'],
  ['std/core/palette/nature', 'WoodlandFoliage', 'canopy_shadow', 'canopy_base', 'canopy_light'],
  [
    'std/core/palette/modern',
    'UrbanConcrete',
    'concrete_shadow',
    'concrete_base',
    'concrete_light',
  ],
];
for (const [spec, designName, cShadow, cBase, cLight] of corePaletteCases) {
  assertOk(
    spec,
    'p',
    'models/p.ashfox',
    `ashfox 1\nmodel p {\n  import "${spec}" as pal;\n  settings { density = 16; forward = north; profile = prop; }\n  rig contract R { joint root { parent = none; role = root; channels = rotation; } }\n  skeleton S implements R { bind root { parent_origin = (0u, 0u, 0u); } }\n  skeleton = S;\n  surface contract SC { chart box_part box { coverage = opaque; } material = opaque; }\n  surface surf: SC { material = opaque; texture atlas { density = 2; background = void; background_alpha = 255; palette { void = #282828; tint = (pal.${designName}.${cShadow}, pal.${designName}.${cBase}, pal.${designName}.${cLight}); } chart box_part box { fill = tint; } } }\n  component C { requires rig s: R; requires surface u: SC; bind bone root to s.root; geometry { bone root { cube b { origin = (-2u, 0u, -2u); size = (4u, 4u, 4u); surface = u.box_part; } } } }\n  use C as main { s = R; u = surf; }\n}`,
  );
}

const coreMaterialCases: readonly [string, string, string, string, string][] = [
  ['std/core/material/metal', 'MetalSurface', 'forged_iron', 'plate', 'rivet'],
  ['std/core/material/wood', 'WoodSurface', 'oak_timber', 'plank', 'bark'],
  ['std/core/material/stone', 'StoneSurface', 'dressed_stone', 'block', 'trim'],
  ['std/core/material/fabric', 'FabricSurface', 'woven_cloth', 'cloth', 'hem'],
];
for (const [spec, surfContract, surfName, c1, c2] of coreMaterialCases) {
  assertOk(
    spec,
    'mat_test',
    'models/mat_test.ashfox',
    `ashfox 1\nmodel mat_test {\n  import "${spec}" as mat;\n  settings { density = 16; forward = north; profile = prop; }\n  rig contract R { joint root { parent = none; role = root; channels = rotation; } }\n  skeleton S implements R { bind root { parent_origin = (0u, 0u, 0u); } }\n  skeleton = S;\n  component C { requires rig s: R; requires surface u: mat.${surfContract}; bind bone root to s.root; geometry { bone root { cube a { origin = (-2u, 0u, -2u); size = (4u, 4u, 4u); surface = u.${c1}; } cube b { origin = (-1u, 4u, -1u); size = (2u, 1u, 2u); surface = u.${c2}; } } } }\n  use C as main { s = R; u = mat.${surfName}; }\n}`,
  );
}

const hookCases: readonly [string, string][] = [
  ['std/core/hook/world', 'anchor p : h.SpawnPoint { at = (2b, 1b, 2b); kind = npc; }'],
  [
    'std/core/hook/combat',
    'anchor p : h.ProjectileMuzzle { at = (2b, 1b, 2b); projectile_id = "arrow"; }',
  ],
  ['std/core/hook/loot', 'anchor p : h.LootChest { at = (2b, 1b, 2b); table = "dungeon/basic"; }'],
];
for (const [spec, hookLine] of hookCases) {
  assertOk(
    spec,
    's',
    'structures/s.ashfox',
    `ashfox 1\nstructure s {\n  import "${spec}" as h;\n  density = 1; seed = 7; size = (5b, 4b, 5b);\n  palette { stone = "minecraft:stone"; }\n  box { from = (0b, 0b, 0b); to = (4b, 0b, 4b); block = stone; }\n  ${hookLine}\n}`,
  );
}

const rigCases: readonly [string, string, string, readonly string[]][] = [
  [
    'std/model/rig/biped',
    'BipedRig',
    'BipedSkeleton',
    ['root', 'pelvis', 'torso', 'head', 'left_arm', 'right_arm', 'weapon', 'left_leg', 'right_leg'],
  ],
  [
    'std/model/rig/quadruped',
    'QuadrupedRig',
    'QuadrupedSkeleton',
    [
      'root',
      'body',
      'neck',
      'head',
      'tail',
      'front_left_leg',
      'front_right_leg',
      'back_left_leg',
      'back_right_leg',
    ],
  ],
  [
    'std/model/rig/winged',
    'WingedRig',
    'WingedSkeleton',
    [
      'root',
      'torso',
      'head',
      'left_wing',
      'left_wing_tip',
      'right_wing',
      'right_wing_tip',
      'tail',
      'left_leg',
      'right_leg',
    ],
  ],
  ['std/model/rig/slime', 'SlimeRig', 'SlimeSkeleton', ['root', 'body', 'core', 'crest']],
  [
    'std/model/rig/winged_quadruped',
    'WingedQuadrupedRig',
    'WingedQuadrupedSkeleton',
    [
      'root',
      'torso',
      'neck',
      'head',
      'wing_l',
      'wing_tip_l',
      'wing_r',
      'wing_tip_r',
      'foreleg_l',
      'foreleg_r',
      'hindleg_l',
      'hindleg_r',
      'tail',
      'tail_tip',
    ],
  ],
];
for (const [spec, rigName, skelName, bones] of rigCases) {
  const bindLines = bones.map((b) => `bind bone ${b} to skeleton.${b};`).join(' ');
  const boneTrees = bones
    .slice(1)
    .map(
      (b) =>
        `bone ${b} { cube c_${b} { origin = (-1u, 0u, -1u); size = (2u, 2u, 2u); surface = skin.b_${b}; } }`,
    )
    .join(' ');
  const chartDecls = bones.map((b) => `chart b_${b} box { coverage = opaque; }`).join(' ');
  const chartFills = bones.map((b) => `chart b_${b} box { fill = tone; }`).join(' ');
  assertOk(
    spec,
    'm',
    'models/m.ashfox',
    `ashfox 1\nmodel m {\n  import "${spec}" as r;\n  settings { density = 16; forward = north; profile = prop; }\n  skeleton = r.${skelName};\n  surface contract Skin { ${chartDecls} material = opaque; }\n  surface skin: Skin { material = opaque; texture atlas { density = 2; background = void; background_alpha = 255; palette { void = #282c34; tone = (#3c4252, #6f7991, #abb6cf); } ${chartFills} } }\n  component Body { requires rig skeleton: r.${rigName}; requires surface skin: Skin; ${bindLines} geometry { bone ${bones[0]} { cube c_${bones[0]} { origin = (-2u, 0u, -2u); size = (4u, 4u, 4u); surface = skin.b_${bones[0]}; } ${boneTrees} } } }\n  use Body as main { skeleton = r.${rigName}; skin = skin; }\n}`,
  );
}

const motionCases: readonly [string, readonly string[]][] = [
  ['std/model/motion/idle', ['biped_idle']],
  ['std/model/motion/locomotion', ['biped_walk', 'biped_run']],
  ['std/model/motion/combat', ['slash', 'thrust', 'guard']],
];
for (const [spec, clips] of motionCases) {
  assertOk(
    spec,
    'mot',
    'models/mot.ashfox',
    `ashfox 1\nmodel mot {\n  import "std/model/rig/biped" as rig;\n  import "${spec}" as anim;\n  settings { density = 16; forward = north; profile = creature; }\n  skeleton = rig.BipedSkeleton;\n  motions = [${clips.map((c) => `anim.${c}`).join(', ')}];\n  surface contract Skin { chart body box { coverage = opaque; } material = opaque; }\n  surface skin: Skin { material = opaque; texture atlas { density = 2; background = void; background_alpha = 255; palette { void = #282c34; tone = (#3c4252, #6f7991, #abb6cf); } chart body box { fill = tone; } } }\n  component Body {\n    requires rig s: rig.BipedRig; requires surface u: Skin;\n    bind bone root to s.root; bind bone pelvis to s.pelvis; bind bone torso to s.torso; bind bone head to s.head; bind bone left_arm to s.left_arm; bind bone right_arm to s.right_arm; bind bone weapon to s.weapon; bind bone left_leg to s.left_leg; bind bone right_leg to s.right_leg;\n    geometry { bone root { cube r { origin = (-1u, 0u, -1u); size = (2u, 2u, 2u); surface = u.body; } bone pelvis { cube p { origin = (-1u, 10u, -1u); size = (2u, 2u, 2u); surface = u.body; } bone torso { cube t { origin = (-1u, 13u, -1u); size = (2u, 2u, 2u); surface = u.body; } bone head { cube h { origin = (-1u, 21u, -1u); size = (2u, 2u, 2u); surface = u.body; } } bone left_arm { cube la { origin = (-5u, 14u, -1u); size = (2u, 2u, 2u); surface = u.body; } } bone right_arm { cube ra { origin = (4u, 14u, -1u); size = (2u, 2u, 2u); surface = u.body; } bone weapon { cube w { origin = (4u, 13u, -4u); size = (2u, 2u, 2u); surface = u.body; } } } } bone left_leg { cube ll { origin = (-2u, 0u, -1u); size = (2u, 2u, 2u); surface = u.body; } } bone right_leg { cube rl { origin = (1u, 0u, -1u); size = (2u, 2u, 2u); surface = u.body; } } } } }\n  }\n  use Body as main { s = rig.BipedRig; u = skin; }\n}`,
  );
}

const propCases: readonly [string, string, string, string, string, string, readonly string[]][] = [
  [
    'std/model/prop/weapon',
    'WeaponRig',
    'WeaponSkeleton',
    'WeaponSurface',
    'Broadsword',
    'double',
    ['pommel', 'grip', 'guard', 'blade', 'point'],
  ],
  [
    'std/model/prop/lighting',
    'LanternRig',
    'LanternSkeleton',
    'LanternSurface',
    'IronLantern',
    'double',
    ['frame', 'glass', 'finial'],
  ],
  [
    'std/model/prop/container',
    'ChestRig',
    'ChestSkeleton',
    'ChestSurface',
    'StorageChest',
    'opaque',
    ['base', 'wall', 'lid', 'band', 'latch'],
  ],
];
for (const [spec, rig, skel, surf, comp, mat, charts] of propCases) {
  const chartBlocks = charts.map((c) => `chart ${c} box { fill = tone; }`).join(' ');
  assertOk(
    spec,
    'p',
    'models/p.ashfox',
    `ashfox 1\nmodel p {\n  import "${spec}" as prop;\n  settings { density = 16; forward = north; profile = prop; }\n  skeleton = prop.${skel};\n  surface skin: prop.${surf} { material = ${mat}; texture atlas { density = 2; background = void; background_alpha = 255; palette { void = #282c34; tone = (#3c4252, #6f7991, #abb6cf); } ${chartBlocks} } }\n  use prop.${comp} as main { skeleton = prop.${rig}; skin = skin; }\n}`,
  );
}

const spriteCases: readonly [string, string][] = [
  [
    'std/sprite/item/weapon',
    'part p { mask = lib.blade_core; material = lib.steel; at = (4px, 4px); shade { form = bevel; light = top_left; contrast = 2; axis = [(0px, 7px), (7px, 0px)]; } grain clustered { amount = 0; seed = 1; } patches = []; }',
  ],
  [
    'std/sprite/item/potion',
    'part p { mask = lib.flask_round; material = lib.health_ruby; at = (4px, 4px); shade { form = round; light = top_left; contrast = 2; } grain clustered { amount = 0; seed = 1; } patches = []; }',
  ],
  [
    'std/sprite/item/resource',
    'part p { mask = lib.ingot_bar; material = lib.amethyst_gem; at = (2px, 4px); shade { form = bevel; light = top_left; contrast = 2; axis = [(0px, 2px), (9px, 2px)]; } grain clustered { amount = 0; seed = 1; } patches = []; }',
  ],
  [
    'std/sprite/tile/stone',
    'fill base { material = lib.cobblestone; pattern voronoi { cells = 6; jitter = 0.5; edge_width = 1px; seed = 7; edge_material = lib.mortar_dark; } }',
  ],
  [
    'std/sprite/tile/wood',
    'fill base { material = lib.oak_timber; pattern plank { height = 4px; joint = 1px; seed = 7; mortar_material = lib.oak_joint; } }',
  ],
  [
    'std/sprite/tile/foliage',
    'fill base { material = lib.canopy_green; pattern blotch { scale = 4px; density = 0.25; seed = 7; to_material = lib.deep_fern; } grain soft { amount = 1; seed = 7; } }',
  ],
];
for (const [spec, body] of spriteCases) {
  assertOk(
    spec,
    'sp',
    'sprites/sp.ashfox',
    `ashfox 1\nsprite sp {\n  import "${spec}" as lib;\n  profile = tile; canvas = (16px, 16px); palette {}\n  ${body}\n}`,
  );
}

const vfxTemplate = (spec: string, palName: string, seed = 42): string =>
  `ashfox 1\nvfx fx {\n  import "${spec}" as pal;\n  duration = 0.65s; fps = 30; loop = once; palette = pal.${palName};\n  element arc : slash_arc { at = 0.08s..0.38s; blend = additive; radius = 7u..18u; arc = -85deg..105deg; pitch = 16deg; crossed = true; texture slash_streak { posterize = 4; bristles = 60%; seed = 11; } dissolve directional_wipe { frames = 9; edge_glow = core; } scale = 0.72 -> 1.08 ease_out -> 1.18; alpha = 0.4 -> 1.0 snap -> 0.0 ease_in; }\n  emitter sparks : voxel_burst { at = 0.1s..0.6s; seed = ${seed}; count = 28; shape = cone(55deg, 3u); particle = shard; speed = 18u..34u; life = 0.25s..0.52s; gravity = -28u; drag = 1.4; turbulence = curl(1.8, 7u); ground { y = 0u; bounce = 45%; friction = 70%; } size_over_life = 1.2u -> 0.9u -> 0u; color_over_life = core -> mid -> edge; velocity_stretch = 1.4; blend = additive; }\n}`;

const vfxCases: readonly [string, string][] = [
  ['std/vfx/melee/slash', 'SteelArc'],
  ['std/vfx/melee/thrust', 'PiercingLance'],
  ['std/vfx/impact/shockwave', 'KineticWave'],
  ['std/vfx/impact/burst', 'SparkBurst'],
  ['std/vfx/element/lightning', 'StormArc'],
  ['std/vfx/element/arcane', 'ArcaneViolet'],
  ['std/vfx/element/fire', 'EmberSolar'],
  ['std/vfx/ambient/embers', 'HearthEmbers'],
  ['std/vfx/ambient/aura', 'HealingMist'],
];
for (const [spec, palName] of vfxCases) {
  assertOk(spec, 'fx', 'vfx/fx.ashfox', vfxTemplate(spec, palName));
}

const soundCases: readonly [string, string, boolean][] = [
  ['std/sound/foley/footstep', 'stone_tap', false],
  ['std/sound/foley/cloth', 'fabric_rustle', false],
  ['std/sound/foley/door', 'timber_knock', false],
  ['std/sound/combat/blade', 'air_slice', false],
  ['std/sound/combat/blunt', 'oak_crush', false],
  ['std/sound/combat/hit', 'flesh_impact', false],
  ['std/sound/ambient/fire', 'hearth_roar', true],
  ['std/sound/ambient/wind', 'deep_gust', true],
  ['std/sound/ambient/room', 'room_bed', true],
  ['std/sound/ui/click', 'crisp_tick', false],
  ['std/sound/ui/chime', 'bell_chime', false],
];
for (const [spec, voice, amb] of soundCases) {
  assertOk(
    spec,
    'sfx',
    'sounds/sfx.ashfox',
    `ashfox 1\nsound sfx {\n  import "${spec}" as kit;\n  profile = ${amb ? 'ambient' : 'foley'}; duration = ${amb ? '1.6s' : '0.6s'}; seed = 42;\n  seq play { start = ${amb ? '50ms' : '10ms'}; step a { voice = kit.${voice}; at = 0s; duration = ${amb ? '1.5s' : '500ms'}; } }\n  variants { main = 1; }\n  ${amb ? 'loop { at = 0.2s..1.35s; xfade = 60ms; }' : ''}\n  master { gain = 0db; peak = -1.5db; limit = true; }\n}`,
  );
}

const structureCases: readonly [string, string][] = [
  ['std/structure/arch/medieval', 'StoneArchway'],
  ['std/structure/arch/modern', 'ConcretePillar'],
  ['std/structure/interior/tavern', 'TavernBar'],
  ['std/structure/interior/workshop', 'SmithyBay'],
  ['std/structure/interior/gallery', 'ExhibitionWing'],
  ['std/structure/interior/bedroom', 'GuestBedroom'],
  ['std/structure/furnish/seating', 'FeastTable'],
  ['std/structure/furnish/storage', 'BarrelStack'],
  ['std/structure/furnish/lighting', 'LanternPost'],
  ['std/structure/furnish/display', 'RelicPlinth'],
];
for (const [spec, prefab] of structureCases) {
  assertOk(
    spec,
    'st',
    'structures/st.ashfox',
    `ashfox 1\nstructure st {\n  import "${spec}" as kit;\n  density = 1; seed = 101; size = (8b, 6b, 8b);\n  palette { floor = "minecraft:stone"; }\n  box { from = (0b, 0b, 0b); to = (7b, 0b, 7b); block = floor; }\n  place kit.${prefab} { at = (1b, 1b, 1b); rotate = 0; }\n}`,
  );
}

// 4. Local override precedence + byte-identical determinism.
const localOverride: DirectoryFile = {
  path: 'library/std/vfx/melee/slash.ashfox',
  source:
    'ashfox 1\nmodule slash { export palette OverrideArc { core = #ffffff; mid = #ff4444; edge = #881111; smoke = #221111; } }',
};
const overrideEntry = vfxTemplate('std/vfx/melee/slash', 'OverrideArc', 7);
const ovA = compileOne('fx', 'vfx/fx.ashfox', overrideEntry, [localOverride]);
const ovB = compileOne('fx', 'vfx/fx.ashfox', overrideEntry, [localOverride]);
assert.equal(ovA.ok && ovB.ok, true);
assert.equal(JSON.stringify(ovA), JSON.stringify(ovB));

// 5. modularityGuard: unused exports inside library/std/** permitted, unused import in consumer rejected, duplicate hint present.
const guardOk = checkWorkspaceModularity(
  [
    { path: 'library/std/core/hook/world.ashfox', source: virtualLibs.get('std/core/hook/world')! },
    {
      path: 'assets/structures/a.ashfox',
      source:
        'ashfox 1\nstructure a {\n  import "std/core/hook/world" as w;\n  density = 1; seed = 1; size = (4b, 3b, 4b);\n  palette { st = "minecraft:stone"; }\n  box { from = (0b, 0b, 0b); to = (3b, 0b, 3b); block = st; }\n  anchor sp : w.SpawnPoint { at = (1b, 1b, 1b); kind = npc; }\n}',
    },
  ],
  { unusedSeverity: 'error' },
);
assert.equal(guardOk.ok, true);
assert.equal(guardOk.diagnostics.length, 0);

const unusedImport = checkWorkspaceModularity(
  [
    { path: 'library/std/core/hook/world.ashfox', source: virtualLibs.get('std/core/hook/world')! },
    {
      path: 'assets/structures/a.ashfox',
      source:
        'ashfox 1\nstructure a {\n  import "std/core/hook/world" as w;\n  density = 1; seed = 1; size = (4b, 3b, 4b);\n  palette { st = "minecraft:stone"; }\n  box { from = (0b, 0b, 0b); to = (3b, 0b, 3b); block = st; }\n}',
    },
  ],
  { unusedSeverity: 'error' },
);
assert.equal(unusedImport.ok, false);
assert.ok(unusedImport.diagnostics.some((d) => d.code === 'modular.unused-import'));

const dupLines = Array.from(
  { length: 12 },
  (_, i) => `  set { at = (${i % 3}b, 1b, ${Math.floor(i / 3)}b); block = st; }`,
).join('\n');
const dupWarn = checkWorkspaceModularity([
  {
    path: 'assets/structures/a.ashfox',
    source: `ashfox 1\nstructure a {\n  density = 1; seed = 1; size = (5b, 4b, 5b); palette { st = "minecraft:stone"; }\n  export prefab P {\n${dupLines}\n  }\n}`,
  },
  {
    path: 'assets/structures/b.ashfox',
    source: `ashfox 1\nstructure b {\n  density = 1; seed = 2; size = (5b, 4b, 5b); palette { st = "minecraft:stone"; }\n  export prefab Q {\n${dupLines}\n  }\n}`,
  },
]);
const dupDiag = dupWarn.diagnostics.find((d) => d.code === 'modular.duplicate-boilerplate');
assert.ok(dupDiag, 'Expected duplicate-boilerplate diagnostic');
assert.match(dupDiag.hint ?? dupDiag.message, /ashfox library std list/);
