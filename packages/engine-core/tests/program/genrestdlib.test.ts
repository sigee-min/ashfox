import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { compileDirectoryWorkspace, virtualLibrarySpecifierFromPath } from '../../src';

const STD_DIR = path.join(path.resolve(__dirname, '../../../..'), 'library', 'std');

const walkStdDisk = (
  dir: string,
  rel = '',
  out = new Map<string, string>(),
): Map<string, string> => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const nextRel = rel ? `${rel}/${entry.name}` : entry.name;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkStdDisk(full, nextRel, out);
    else if (entry.isFile() && entry.name.endsWith('.ashfox')) {
      const spec = virtualLibrarySpecifierFromPath(`library/std/${nextRel}`);
      if (spec) out.set(spec, fs.readFileSync(full, 'utf8'));
    }
  }
  return out;
};

const virtualLibs = walkStdDisk(STD_DIR);

const compileOne = (entryName: string, entryPath: string, source: string) =>
  compileDirectoryWorkspace(
    JSON.stringify({
      format: 'ashfox-workspace',
      version: 2,
      name: 'genre_stdlib_verify',
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
    [{ path: `assets/${entryPath}`, source }],
    virtualLibs,
  );

const assertOk = (label: string, entryName: string, entryPath: string, source: string) => {
  const res = compileOne(entryName, entryPath, source);
  assert.equal(res.ok, true, `${label}: ${JSON.stringify(res.ok ? [] : res.diagnostics)}`);
};

const spriteCases: readonly [string, string, string, string][] = [
  [
    'std/sprite/ui/panel',
    'ui_9slice',
    'slice = (4, 4, 4, 4);',
    'fill base { material = lib.scifi_slate; pattern solid {} }',
  ],
  [
    'std/sprite/ui/bar',
    'hud_bar',
    '',
    'fill base { material = lib.frame_steel; pattern solid {} }',
  ],
  [
    'std/sprite/ui/crosshair',
    'crosshair',
    '',
    'fill base { material = lib.reticle_cyan; pattern solid {} }',
  ],
  ['std/sprite/ui/marker', 'icon', '', 'fill base { material = lib.quest_gold; pattern solid {} }'],
  [
    'std/sprite/decal/impact',
    'decal',
    '',
    'fill base { material = lib.scorch_soot; pattern solid {} alpha = 0.85; }',
  ],
  [
    'std/sprite/decal/weather',
    'decal',
    '',
    'fill base { material = lib.rain_puddle; pattern solid {} alpha = 0.8; }',
  ],
];
for (const [spec, profile, extraProp, body] of spriteCases) {
  assertOk(
    spec,
    'sp',
    'sprites/sp.ashfox',
    `ashfox 1\nsprite sp {\n  import "${spec}" as lib;\n  profile = ${profile}; canvas = (16px, 16px); ${extraProp} palette {}\n  ${body}\n}`,
  );
}

const vfxRecipes: readonly [string, string, string][] = [
  ['std/vfx/melee/slash', 'SteelArc', 'MeleeSlash'],
  ['std/vfx/melee/thrust', 'PiercingLance', 'MeleeThrust'],
  ['std/vfx/impact/shockwave', 'KineticWave', 'ShockwaveRing'],
  ['std/vfx/impact/burst', 'SparkBurst', 'ImpactBurst'],
  ['std/vfx/impact/splinter', 'TimberChips', 'WoodSplinter'],
  ['std/vfx/impact/dust', 'DesertDust', 'DustBillow'],
  ['std/vfx/impact/ichor', 'ZombieIchor', 'IchorSplash'],
  ['std/vfx/element/lightning', 'StormArc', 'LightningBolt'],
  ['std/vfx/element/arcane', 'ArcaneViolet', 'ArcanePulse'],
  ['std/vfx/element/fire', 'EmberSolar', 'FlameBurst'],
  ['std/vfx/ambient/embers', 'HearthEmbers', 'HearthEmbersLoop'],
  ['std/vfx/ambient/aura', 'HealingMist', 'HealingAura'],
  ['std/vfx/weapon/muzzle_flash', 'MuzzleAmber', 'MuzzleFlash'],
  ['std/vfx/weapon/shell_eject', 'BrassCasing', 'ShellEject'],
  ['std/vfx/weapon/tracer', 'TracerGold', 'BulletTracer'],
  ['std/vfx/weapon/plasma_bolt', 'PlasmaCyan', 'PlasmaBolt'],
  ['std/vfx/shield/hex_ripple', 'AegisCyan', 'HexRipple'],
  ['std/vfx/shield/shield_break', 'ShatterCyan', 'ShieldBreak'],
  ['std/vfx/magic/heal_beam', 'VitalGreen', 'HealBeam'],
  ['std/vfx/magic/poison_cloud', 'VenomMist', 'PoisonCloud'],
  ['std/vfx/magic/summon_circle', 'EldritchViolet', 'SummonCircle'],
  ['std/vfx/magic/portal_gate', 'VoidGate', 'PortalGate'],
  ['std/vfx/magic/buff_aura', 'ValorGold', 'BuffAura'],
  ['std/vfx/weather/rain_sheet', 'StormRain', 'RainSheet'],
  ['std/vfx/weather/snow_gust', 'FrostSnow', 'SnowGust'],
  ['std/vfx/weather/fog_wisp', 'MarshFog', 'FogWisp'],
  ['std/vfx/weather/flashlight_cone', 'TacticalBeam', 'FlashlightCone'],
  ['std/vfx/rpg/skill_nova', 'MeteorCrimson', 'MeteorDrop'],
  ['std/vfx/rpg/drop_sparkle', 'RarityGold', 'LootBeam'],
  ['std/vfx/hazard/caustic_pool', 'AcidCaustic', 'CausticPuddle'],
];
const vfxTemplate = (spec: string, palName: string, seed = 42): string =>
  `ashfox 1\nvfx fx_pal {\n  import "${spec}" as pal;\n  duration = 0.65s; fps = 30; loop = once; palette = pal.${palName};\n  element arc : slash_arc { at = 0.08s..0.38s; blend = additive; radius = 7u..18u; arc = -85deg..105deg; pitch = 16deg; crossed = true; texture slash_streak { posterize = 4; bristles = 60%; seed = 11; } dissolve directional_wipe { frames = 9; edge_glow = core; } scale = 0.72 -> 1.08 ease_out -> 1.18; alpha = 0.4 -> 1.0 snap -> 0.0 ease_in; }\n  emitter sparks : voxel_burst { at = 0.1s..0.6s; seed = ${seed}; count = 28; shape = cone(55deg, 3u); particle = shard; speed = 18u..34u; life = 0.25s..0.52s; gravity = -28u; drag = 1.4; turbulence = curl(1.8, 7u); ground { y = 0u; bounce = 45%; friction = 70%; } size_over_life = 1.2u -> 0.9u -> 0u; color_over_life = core -> mid -> edge; velocity_stretch = 1.4; blend = additive; }\n}`;

for (const [spec, palName, recipeName] of vfxRecipes) {
  assertOk(`${spec}:pal`, 'fx_pal', 'vfx/fx_pal.ashfox', vfxTemplate(spec, palName));
  assertOk(
    `${spec}#${recipeName}`,
    'fx_rec',
    'vfx/fx_rec.ashfox',
    `ashfox 1\nvfx fx_rec {\n  import "${spec}" as kit;\n  use kit.${recipeName};\n}`,
  );
}

const soundCases: readonly [string, string, boolean][] = [
  ['std/sound/weapon/gunshot', 'muzzle_crack', false],
  ['std/sound/weapon/energy', 'laser_zap', false],
  ['std/sound/weapon/reload', 'bolt_rack', false],
  ['std/sound/mech/servo', 'rotor_chop', true],
  ['std/sound/creature/zombie', 'horde_ambience', true],
  ['std/sound/weather/storm', 'heavy_rain', true],
];
for (const [spec, voice, amb] of soundCases) {
  assertOk(
    spec,
    'sfx',
    'sounds/sfx.ashfox',
    `ashfox 1\nsound sfx {\n  import "${spec}" as kit;\n  profile = ${amb ? 'ambient' : 'foley'}; duration = ${amb ? '1.6s' : '0.6s'}; seed = 42;\n  seq play { start = ${amb ? '50ms' : '10ms'}; step a { voice = kit.${voice}; at = 0s; duration = ${amb ? '1.5s' : '500ms'}; } }\n  variants { main = 1; }\n  ${amb ? 'loop { at = 0.2s..1.35s; xfade = 60ms; }' : ''}\n  master { gain = 0db; peak = -1.5db; limit = true; }\n}`,
  );
}

const waveBSpriteCases: readonly [string, string, string][] = [
  ['std/sprite/decal/biohazard', 'blood_splatter', 'blood_crimson'],
  ['std/sprite/decal/signage', 'saferoom_arrow', 'saferoom_amber'],
];
for (const [spec, maskName, matName] of waveBSpriteCases) {
  assertOk(
    spec,
    'sp',
    'sprites/sp.ashfox',
    `ashfox 1\nsprite sp {\n  import "${spec}" as lib;\n  profile = decal; canvas = (16px, 16px); palette {}\n  part p { mask = lib.${maskName}; material = lib.${matName}; at = (2px, 2px); shade { form = flat; light = top_left; contrast = 1; } grain clustered { amount = 0; seed = 1; } patches = []; }\n}`,
  );
}

for (const [spec, prefab] of [
  ['std/structure/arch/storybook', 'TreehouseArch'],
  ['std/structure/platform/field', 'FloatingDeck'],
  ['std/structure/arch/urban_ruin', 'AsphaltRoadBay'],
  ['std/structure/interior/clinic', 'ClinicWardBay'],
  ['std/structure/interior/saferoom', 'SaferoomSteelDoor'],
] as const) {
  assertOk(
    spec,
    'st',
    'structures/st.ashfox',
    `ashfox 1\nstructure st {\n  import "${spec}" as kit;\n  density = 1; seed = 101; size = (10b, 10b, 10b);\n  palette { floor = "minecraft:stone"; }\n  box { from = (0b, 0b, 0b); to = (9b, 0b, 9b); block = floor; }\n  place kit.${prefab} { at = (1b, 1b, 1b); rotate = 0; }\n}`,
  );
}

assertOk(
  'std/core/hook/interaction',
  'st',
  'structures/hook.ashfox',
  `ashfox 1\nstructure st {\n  import "std/core/hook/interaction" as h;\n  density = 1; seed = 7; size = (5b, 4b, 5b);\n  palette { stone = "minecraft:stone"; }\n  box { from = (0b, 0b, 0b); to = (4b, 0b, 4b); block = stone; }\n  anchor p : h.Interactable { at = (2b, 1b, 2b); action = use; }\n}`,
);

assertOk(
  'std/core/material/crystal',
  'mat',
  'models/crystal.ashfox',
  `ashfox 1\nmodel mat {\n  import "std/core/material/crystal" as m;\n  settings { density = 16; forward = north; profile = prop; }\n  rig contract R { joint root { parent = none; role = root; channels = rotation; } }\n  skeleton S implements R { bind root { parent_origin = (0u, 0u, 0u); } }\n  skeleton = S;\n  component C { requires rig s: R; requires surface u: m.CrystalSurface; bind bone root to s.root; geometry { bone root { cube a { origin = (-2u, 0u, -2u); size = (4u, 4u, 4u); surface = u.facet; } cube b { origin = (-1u, 4u, -1u); size = (2u, 1u, 2u); surface = u.core; } } } }\n  use C as main { s = R; u = m.gem_crystal; }\n}`,
);

const tendrilBones =
  'root pelvis torso belly head tendril_base tendril_tip left_arm right_arm left_leg right_leg'.split(
    ' ',
  );
assertOk(
  'std/model/rig/tendril',
  'tendril_m',
  'models/tendril.ashfox',
  `ashfox 1\nmodel tendril_m {\n  import "std/model/rig/tendril" as r;\n  settings { density = 16; forward = north; profile = prop; }\n  skeleton = r.TendrilSkeleton;\n  surface contract Skin { ${tendrilBones.map((b) => `chart b_${b} box { coverage = opaque; }`).join(' ')} material = opaque; }\n  surface skin: Skin { material = opaque; texture atlas { density = 2; background = void; background_alpha = 255; palette { void = #282c34; tone = (#3c4252, #6f7991, #abb6cf); } ${tendrilBones.map((b) => `chart b_${b} box { fill = tone; }`).join(' ')} } }\n  component Body { requires rig skeleton: r.TendrilRig; requires surface skin: Skin; ${tendrilBones.map((b) => `bind bone ${b} to skeleton.${b};`).join(' ')} geometry { bone root { cube c_root { origin = (-2u, 0u, -2u); size = (4u, 4u, 4u); surface = skin.b_root; } ${tendrilBones
    .slice(1)
    .map(
      (b) =>
        `bone ${b} { cube c_${b} { origin = (-1u, 0u, -1u); size = (2u, 2u, 2u); surface = skin.b_${b}; } }`,
    )
    .join(' ')} } } }\n  use Body as main { skeleton = r.TendrilRig; skin = skin; }\n}`,
);

for (const [spec, rig, skel, surf, comp, charts] of [
  [
    'std/model/prop/town_rpg',
    'TownPropRig',
    'TownPropSkeleton',
    'SignpostSurface',
    'Signpost',
    'plinth post arm board cap',
  ],
  [
    'std/model/prop/medical',
    'MedicalRig',
    'MedicalSkeleton',
    'FirstAidKitSurface',
    'FirstAidKit',
    'case_body lid handle clasp emblem',
  ],
  [
    'std/model/prop/urban_hazard',
    'HazardPropRig',
    'HazardPropSkeleton',
    'GasCanSurface',
    'GasCan',
    'canister handle spout cap stripe',
  ],
] as const) {
  const fills = charts
    .split(' ')
    .map((c) => `chart ${c} box { fill = tone; }`)
    .join(' ');
  assertOk(
    spec,
    'prop_m',
    'models/prop_m.ashfox',
    `ashfox 1\nmodel prop_m {\n  import "${spec}" as prop;\n  settings { density = 16; forward = north; profile = prop; }\n  skeleton = prop.${skel};\n  surface skin: prop.${surf} { material = double; texture atlas { density = 2; background = void; background_alpha = 255; palette { void = #282c34; tone = (#3c4252, #6f7991, #abb6cf); } ${fills} } }\n  use prop.${comp} as main { skeleton = prop.${rig}; skin = skin; }\n}`,
  );
}

for (const [
  spec,
  rigMod,
  skelName,
  rigName,
  sockContract,
  surf,
  comp,
  sockParam,
  boxCharts,
  flatCharts,
] of [
  [
    'std/model/cosmetic/cape',
    'biped',
    'BipedSkeleton',
    'BipedRig',
    'CapeMount',
    'CapeSurface',
    'ClothCape',
    'mount',
    'collar clasp mantle drape hem',
    '',
  ],
  [
    'std/model/cosmetic/hair',
    'chibi',
    'ChibiSkeleton',
    'ChibiRig',
    'HairSocket',
    'HairSurface',
    'BangsHair',
    'mount',
    'crown back bangs side_bang side_lock band',
    'strand',
  ],
  [
    'std/model/weapon/bow',
    'biped',
    'BipedSkeleton',
    'BipedRig',
    'HandGrip',
    'ShortBowSurface',
    'ShortBow',
    'grip',
    'grip riser limb tip string',
    '',
  ],
  [
    'std/model/weapon/staff',
    'biped',
    'BipedSkeleton',
    'BipedRig',
    'HandGrip',
    'MageStaffSurface',
    'MageStaff',
    'grip',
    'shaft wrap ferrule cradle orb ring',
    '',
  ],
] as const) {
  const flats = flatCharts.split(' ').filter(Boolean);
  const fills = [
    ...boxCharts
      .split(' ')
      .filter(Boolean)
      .map((c) => `chart ${c} box { fill = tone; }`),
    ...flats.map((c) => `chart ${c} flat { fill = tone; coverage = ${'1'.repeat(6 * 6)}; }`),
  ].join(' ');
  assertOk(
    spec,
    'sock_m',
    'models/sock_m.ashfox',
    `ashfox 1\nmodel sock_m {\n  import "std/model/rig/${rigMod}" as r;\n  import "${spec}" as gear;\n  settings { density = 16; forward = north; profile = prop; }\n  skeleton = r.${skelName};\n  surface contract BodySurf { chart body box { coverage = opaque; } material = double; }\n  surface body_s: BodySurf { material = double; texture atlas { density = 2; atlas = (128px, 128px); background = void; background_alpha = 255; palette { void = #282c34; tone = (#3c4252, #6f7991, #abb6cf); } chart body box { fill = tone; } } }\n  surface gear_s: gear.${surf} { material = double; texture atlas { density = 2; atlas = (128px, 128px); background = void; background_alpha = ${flats.length ? 0 : 255}; palette { void = #282c34; tone = (#3c4252, #6f7991, #abb6cf); } ${fills} } }\n  component Body { requires rig s: r.${rigName}; requires surface u: BodySurf; provides socket m: r.${sockContract} capacity = one; bind bone root to s.root; bind bone head to s.head; bind bone torso to s.torso; bind socket m to bone torso { frame { origin = (0u, 0u, 0u); x = (1, 0, 0); y = (0, 1, 0); z = (0, 0, 1); } } geometry { bone root { cube c_r { origin = (-1u, 0u, -1u); size = (2u, 2u, 2u); surface = u.body; } bone torso { cube c_t { origin = (-1u, 13u, -1u); size = (2u, 2u, 2u); surface = u.body; } bone head { cube c_h { origin = (-1u, 21u, -1u); size = (2u, 2u, 2u); surface = u.body; } } } } } }\n  use Body as body { s = r.${rigName}; u = body_s; };\n  use gear.${comp} as part { skin = gear_s; };\n  connect body.m -> part.${sockParam};\n}`,
  );
}
console.log('genre stdlib UI/decal/VFX/audio compilation ok');
