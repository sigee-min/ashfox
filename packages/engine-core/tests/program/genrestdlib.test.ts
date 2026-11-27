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
console.log('genre stdlib UI/decal/VFX/audio compilation ok');
