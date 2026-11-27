import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  compileDirectoryWorkspace,
  virtualLibrarySpecifierFromPath,
  type DirectoryFile,
} from '../../src';

const STD_DIR = path.join(path.resolve(__dirname, '../../../..'), 'library', 'std');

const loadStd = (dir: string, rel = '', out = new Map<string, string>()): Map<string, string> => {
  for (const entry of fs
    .readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))) {
    const nextRel = rel ? `${rel}/${entry.name}` : entry.name;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) loadStd(full, nextRel, out);
    else if (entry.isFile() && entry.name.endsWith('.ashfox')) {
      const spec = virtualLibrarySpecifierFromPath(`library/std/${nextRel}`);
      if (spec) out.set(spec, fs.readFileSync(full, 'utf8'));
    }
  }
  return out;
};

const virtualLibs = loadStd(STD_DIR);

const assertOk = (spec: string, entryName: string, entryPath: string, source: string) => {
  const files: DirectoryFile[] = [{ path: `assets/${entryPath}`, source }];
  const res = compileDirectoryWorkspace(
    JSON.stringify({
      format: 'ashfox-workspace',
      version: 2,
      name: 'stdgenre_verify',
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
    files,
    virtualLibs,
  );
  assert.equal(res.ok, true, `Failed ${spec}: ${JSON.stringify(res.ok ? [] : res.diagnostics)}`);
};

const rigCases: readonly [string, string, string, readonly string[]][] = [
  [
    'std/model/rig/vehicle',
    'VehicleRig',
    'VehicleSkeleton',
    ['root', 'chassis', 'wheel_fl', 'wheel_fr', 'wheel_rl', 'wheel_rr', 'door_l', 'door_r'],
  ],
  [
    'std/model/rig/mech',
    'MechRig',
    'MechSkeleton',
    [
      'root',
      'pelvis',
      'torso',
      'turret_yaw',
      'arm_l',
      'arm_r',
      'barrel_l',
      'barrel_r',
      'leg_l',
      'leg_r',
    ],
  ],
  ['std/model/rig/turret', 'TurretRig', 'TurretSkeleton', ['base', 'yaw_head', 'pitch_barrel']],
  [
    'std/model/rig/drone',
    'DroneRig',
    'DroneSkeleton',
    ['body', 'rotor_1', 'rotor_2', 'rotor_3', 'rotor_4', 'gimbal_cam'],
  ],
  [
    'std/model/rig/fps_arms',
    'FpsArmsRig',
    'FpsArmsSkeleton',
    ['camera_root', 'arm_l', 'arm_r', 'hand_l', 'hand_r', 'weapon_mount', 'mag', 'bolt'],
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

assertOk(
  'std/model/motion/zombie',
  'zom',
  'models/zom.ashfox',
  `ashfox 1\nmodel zom {\n  import "std/model/rig/biped" as rig;\n  import "std/model/motion/zombie" as anim;\n  settings { density = 16; forward = north; profile = creature; }\n  skeleton = rig.BipedSkeleton;\n  motions = [anim.shamble, anim.crawl, anim.bite_lunge, anim.stagger, anim.collapse];\n  surface contract Skin { chart body box { coverage = opaque; } material = opaque; }\n  surface skin: Skin { material = opaque; texture atlas { density = 2; background = void; background_alpha = 255; palette { void = #282c34; tone = (#3c4252, #6f7991, #abb6cf); } chart body box { fill = tone; } } }\n  component Body {\n    requires rig s: rig.BipedRig; requires surface u: Skin;\n    bind bone root to s.root; bind bone pelvis to s.pelvis; bind bone torso to s.torso; bind bone head to s.head; bind bone left_arm to s.left_arm; bind bone right_arm to s.right_arm; bind bone weapon to s.weapon; bind bone left_leg to s.left_leg; bind bone right_leg to s.right_leg;\n    geometry { bone root { cube r { origin = (-1u, 0u, -1u); size = (2u, 2u, 2u); surface = u.body; } bone pelvis { cube p { origin = (-1u, 10u, -1u); size = (2u, 2u, 2u); surface = u.body; } bone torso { cube t { origin = (-1u, 13u, -1u); size = (2u, 2u, 2u); surface = u.body; } bone head { cube h { origin = (-1u, 21u, -1u); size = (2u, 2u, 2u); surface = u.body; } } bone left_arm { cube la { origin = (-5u, 14u, -1u); size = (2u, 2u, 2u); surface = u.body; } } bone right_arm { cube ra { origin = (4u, 14u, -1u); size = (2u, 2u, 2u); surface = u.body; } bone weapon { cube w { origin = (4u, 13u, -4u); size = (2u, 2u, 2u); surface = u.body; } } } } bone left_leg { cube ll { origin = (-2u, 0u, -1u); size = (2u, 2u, 2u); surface = u.body; } } bone right_leg { cube rl { origin = (1u, 0u, -1u); size = (2u, 2u, 2u); surface = u.body; } } } } }\n  }\n  use Body as main { s = rig.BipedRig; u = skin; }\n}`,
);

const boxKitCases: readonly [string, string, string, string, string, string, readonly string[]][] =
  [
    [
      'std/model/armor/helm',
      'HelmRig',
      'HelmSkeleton',
      'HelmSurface',
      'PlateHelm',
      'double',
      ['dome', 'rim', 'crest', 'cheek', 'neck', 'visor'],
    ],
    [
      'std/model/armor/cuirass',
      'CuirassRig',
      'CuirassSkeleton',
      'CuirassSurface',
      'PlateCuirass',
      'double',
      ['breastplate', 'trim', 'strap', 'pauldron', 'rim'],
    ],
    [
      'std/model/armor/shield',
      'ShieldRig',
      'ShieldSkeleton',
      'ShieldSurface',
      'KiteShield',
      'double',
      ['face', 'tip', 'rim', 'boss', 'grip'],
    ],
    [
      'std/model/nature/rock',
      'RockRig',
      'RockSkeleton',
      'RockSurface',
      'Boulder',
      'opaque',
      ['base', 'facet', 'cap'],
    ],
    [
      'std/model/nature/rock',
      'RockRig',
      'RockSkeleton',
      'RockSurface',
      'CliffSlab',
      'opaque',
      ['base', 'facet', 'cap'],
    ],
    [
      'std/model/nature/rock',
      'RockRig',
      'RockSkeleton',
      'OreSurface',
      'OreVein',
      'opaque',
      ['base', 'ore', 'seam'],
    ],
    [
      'std/model/nature/survival',
      'PropRig',
      'PropSkeleton',
      'CampfireSurface',
      'Campfire',
      'double',
      ['ash', 'stone', 'log', 'ember'],
    ],
    [
      'std/model/nature/survival',
      'PropRig',
      'PropSkeleton',
      'GeneratorSurface',
      'Generator',
      'double',
      ['skid', 'engine', 'tank', 'panel', 'exhaust'],
    ],
    [
      'std/model/nature/survival',
      'PropRig',
      'PropSkeleton',
      'BarricadeSurface',
      'Barricade',
      'double',
      ['post', 'plank', 'brace'],
    ],
    [
      'std/model/nature/survival',
      'PropRig',
      'PropSkeleton',
      'CrateSurface',
      'SupplyCrate',
      'double',
      ['body', 'lid', 'strap', 'latch'],
    ],
  ];
for (const [spec, rig, skel, surf, comp, mat, charts] of boxKitCases) {
  const chartBlocks = charts.map((c) => `chart ${c} box { fill = tone; }`).join(' ');
  assertOk(
    `${spec}#${comp}`,
    'p',
    'models/p.ashfox',
    `ashfox 1\nmodel p {\n  import "${spec}" as prop;\n  settings { density = 16; forward = north; profile = prop; }\n  skeleton = prop.${skel};\n  surface skin: prop.${surf} { material = ${mat}; texture atlas { density = 2; background = void; background_alpha = 255; palette { void = #282c34; tone = (#3c4252, #6f7991, #abb6cf); } ${chartBlocks} } }\n  use prop.${comp} as main { skeleton = prop.${rig}; skin = skin; }\n}`,
  );
}

assertOk(
  'std/model/motion/vehicle',
  'veh',
  'models/veh.ashfox',
  `ashfox 1\nmodel veh {\n  import "std/model/rig/vehicle" as vr;\n  import "std/model/motion/vehicle" as vm;\n  import "std/model/nature/survival" as surv;\n  settings { density = 16; forward = north; profile = prop; }\n  skeleton = vr.VehicleSkeleton;\n  motions = [vm.drive_spin, vm.suspension_bump, vm.door_open];\n  surface skin: surv.TruckSurface { material = double; texture atlas { density = 2; background = void; background_alpha = 255; palette { void = #282c34; tone = (#3c4252, #6f7991, #abb6cf); } chart underbody box { fill = tone; } chart hood box { fill = tone; } chart cab box { fill = tone; } chart windshield box { fill = tone; } chart bed_floor box { fill = tone; } chart bed_wall box { fill = tone; } chart tailgate box { fill = tone; } chart tire box { fill = tone; } chart door box { fill = tone; } } }\n  use surv.PickupTruck as main { skeleton = vr.VehicleRig; skin = skin; }\n}`,
);
assertOk(
  'std/model/motion/firearm',
  'fps',
  'models/fps.ashfox',
  `ashfox 1\nmodel fps {\n  import "std/model/rig/fps_arms" as fr;\n  import "std/model/motion/firearm" as fm;\n  import "std/model/nature/survival" as surv;\n  settings { density = 16; forward = north; profile = prop; }\n  skeleton = fr.FpsArmsSkeleton;\n  motions = [fm.ads_aim, fm.fire_recoil, fm.reload_mag, fm.melee_bash];\n  surface skin: surv.RifleSurface { material = double; texture atlas { density = 2; background = void; background_alpha = 255; palette { void = #282c34; tone = (#3c4252, #6f7991, #abb6cf); } chart receiver box { fill = tone; } chart handguard box { fill = tone; } chart barrel box { fill = tone; } chart buttstock box { fill = tone; } chart grip box { fill = tone; } chart optic_rail box { fill = tone; } chart mag box { fill = tone; } chart bolt box { fill = tone; } } }\n  use surv.AssaultRifle as main { skeleton = fr.FpsArmsRig; skin = skin; }\n}`,
);
assertOk(
  'std/model/motion/mech',
  'mech_mot',
  'models/mech_mot.ashfox',
  `ashfox 1\nmodel mech_mot {\n  import "std/model/rig/mech" as mr;\n  import "std/model/motion/mech" as mm;\n  settings { density = 16; forward = north; profile = prop; }\n  skeleton = mr.MechSkeleton;\n  motions = [mm.mech_stomp];\n  surface contract S { chart b box { coverage = opaque; } material = opaque; }\n  surface skin: S { material = opaque; texture atlas { density = 2; background = void; background_alpha = 255; palette { void = #282c34; tone = (#3c4252, #6f7991, #abb6cf); } chart b box { fill = tone; } } }\n  component C { requires rig s: mr.MechRig; requires surface u: S; bind bone root to s.root; geometry { bone root { cube c { origin = (-2u, 0u, -2u); size = (4u, 4u, 4u); surface = u.b; } } } }\n  use C as main { s = mr.MechRig; u = skin; }\n}`,
);
for (const [comp, surf, charts] of [
  ['OakTree', 'TreeSurface', ['bark', 'root', 'canopy_low', 'canopy_mid', 'canopy_top', 'bough']],
  ['PineTree', 'TreeSurface', ['bark', 'root', 'canopy_low', 'canopy_mid', 'canopy_top', 'bough']],
  ['DeadTree', 'DeadTreeSurface', ['bark', 'root', 'bough']],
] as const) {
  const fills = charts.map((c) => `chart ${c} box { fill = tone; }`).join(' ');
  assertOk(
    `std/model/nature/tree#${comp}`,
    'tree_test',
    'models/tree_test.ashfox',
    `ashfox 1\nmodel tree_test {\n  import "std/model/motion/nature" as nat;\n  import "std/model/nature/tree" as tree;\n  settings { density = 16; forward = north; profile = prop; }\n  skeleton = nat.FoliageSkeleton;\n  motions = [nat.wind_sway];\n  surface skin: tree.${surf} { material = double; texture atlas { density = 2; background = void; background_alpha = 255; palette { void = #282c34; tone = (#3c4252, #6f7991, #abb6cf); } ${fills} } }\n  use tree.${comp} as main { skeleton = nat.FoliageRig; skin = skin; }\n}`,
  );
}
assertOk(
  'std/model/nature/foliage#GrassTuft',
  'fol_test',
  'models/fol_test.ashfox',
  `ashfox 1\nmodel fol_test {\n  import "std/model/motion/nature" as nat;\n  import "std/model/nature/foliage" as fol;\n  settings { density = 16; forward = north; profile = prop; }\n  skeleton = nat.FoliageSkeleton;\n  motions = [nat.wind_sway];\n  surface skin: fol.GrassSurface { material = cutout; texture atlas { density = 2; background = void; background_alpha = 255; palette { void = #282c34; tone = (#3c4252, #6f7991, #abb6cf); } chart blade flat { fill = tone; } } }\n  use fol.GrassTuft as main { skeleton = nat.FoliageRig; skin = skin; }\n}`,
);
assertOk(
  'std/model/nature/foliage#FernCluster',
  'fern_test',
  'models/fern_test.ashfox',
  `ashfox 1\nmodel fern_test {\n  import "std/model/motion/nature" as nat;\n  import "std/model/nature/foliage" as fol;\n  settings { density = 16; forward = north; profile = prop; }\n  skeleton = nat.FoliageSkeleton;\n  motions = [nat.wind_sway];\n  surface skin: fol.FernSurface { material = cutout; texture atlas { density = 2; background = void; background_alpha = 255; palette { void = #282c34; tone = (#3c4252, #6f7991, #abb6cf); } chart frond flat { fill = tone; } } }\n  use fol.FernCluster as main { skeleton = nat.FoliageRig; skin = skin; }\n}`,
);
assertOk(
  'std/model/nature/foliage#BerryBush',
  'bush_test',
  'models/bush_test.ashfox',
  `ashfox 1\nmodel bush_test {\n  import "std/model/motion/nature" as nat;\n  import "std/model/nature/foliage" as fol;\n  settings { density = 16; forward = north; profile = prop; }\n  skeleton = nat.FoliageSkeleton;\n  motions = [nat.wind_sway];\n  surface skin: fol.BushSurface { material = cutout; texture atlas { density = 2; background = void; background_alpha = 255; palette { void = #282c34; tone = (#3c4252, #6f7991, #abb6cf); } chart shrub_base box { fill = tone; } chart shrub_top box { fill = tone; } chart berry box { fill = tone; } } }\n  use fol.BerryBush as main { skeleton = nat.FoliageRig; skin = skin; }\n}`,
);
