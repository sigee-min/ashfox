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
  for (const entry of fs
    .readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))) {
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

const assertOk = (spec: string, entryName: string, entryPath: string, source: string) => {
  const res = compileDirectoryWorkspace(
    JSON.stringify({
      format: 'ashfox-workspace',
      version: 2,
      name: 'stdlib_craft_verify',
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
  assert.equal(res.ok, true, `Failed ${spec}: ${JSON.stringify(res.ok ? [] : res.diagnostics)}`);
};

const faceCases: readonly [string, string, string][] = [
  ['std/model/face/eagle', 'EagleFaceSurface', 'eagle_fierce'],
  ['std/model/face/fox', 'FoxFaceSurface', 'fox_clever'],
  ['std/model/face/goblin', 'GoblinFaceSurface', 'goblin_fierce'],
  ['std/model/face/knight', 'KnightFaceSurface', 'knight_visor'],
  ['std/model/face/slime', 'SlimeFaceSurface', 'slime_cute'],
];
for (const [spec, surfContract, surfName] of faceCases) {
  assertOk(
    spec,
    'f',
    'models/f.ashfox',
    `ashfox 1\nmodel f {\n  import "std/model/rig/slime" as r;\n  import "${spec}" as fc;\n  settings { density = 16; forward = north; profile = prop; }\n  skeleton = r.SlimeSkeleton;\n  surface contract BS { chart b box { coverage = opaque; } material = cutout; }\n  surface bs: BS { material = cutout; texture atlas { density = 2; atlas = (128px, 128px); background = void; background_alpha = 0; palette { void = #000000; tone = (#3c4252, #6f7991, #abb6cf); } chart b box { fill = tone; } } }\n  component C {\n    requires rig s: r.SlimeRig; requires surface u: BS; requires surface fs: fc.${surfContract};\n    bind bone root to s.root; bind bone body to s.body;\n    geometry { bone root { bone body { cube b { origin = (-4u, 0u, -4u); size = (8u, 8u, 8u); surface = u.b; } expression_slot face { origin = (3.5u, 2u, -4.08u); size = (7u, 4u); u_axis = (-1u, 0u, 0u); v_axis = (0u, 1u, 0u); neutral = fs.neutral; blink = fs.blink; fierce = fs.fierce; hurt = fs.hurt; } } } }\n  }\n  use C as c { s = r.SlimeRig; u = bs; fs = fc.${surfName}; };\n}`,
  );
}

const anatomyCases: readonly [
  string,
  string,
  string,
  string,
  readonly string[],
  readonly string[],
][] = [
  [
    'std/model/anatomy/wing',
    'WingSocket',
    'WingSurface',
    'FeatheredWingLeft',
    ['shoulder', 'wing_arm', 'feather_a', 'feather_b', 'feather_c', 'tip'],
    ['plume'],
  ],
  [
    'std/model/anatomy/limb',
    'LimbSocket',
    'BeastHindlegSurface',
    'DigitigradeHindleg',
    ['thigh', 'shin', 'hock', 'paw'],
    [],
  ],
  [
    'std/model/anatomy/tail',
    'TailSocket',
    'LionTailSurface',
    'LionTuftTail',
    ['base', 'rise', 'tuft'],
    [],
  ],
  [
    'std/model/anatomy/head',
    'HeadSocket',
    'GoblinHeadSurface',
    'GoblinHead',
    ['skull', 'jaw', 'tusk', 'ear', 'ear_tip', 'mohawk'],
    [],
  ],
];
for (const [spec, sock, surf, comp, boxes, flats] of anatomyCases) {
  const chartBlocks = [
    ...boxes.map((c) => `chart ${c} box { fill = tone; }`),
    ...flats.map((c) => `chart ${c} flat { fill = tone; coverage = ${'1'.repeat(8 * 20)}; }`),
  ].join(' ');
  assertOk(
    spec,
    'a',
    'models/a.ashfox',
    `ashfox 1\nmodel a {\n  import "std/model/rig/slime" as r;\n  import "${spec}" as an;\n  settings { density = 16; forward = north; profile = prop; }\n  skeleton = r.SlimeSkeleton;\n  surface contract BS { chart b box { coverage = opaque; } material = double; }\n  surface bs: BS { material = double; texture atlas { density = 2; atlas = (128px, 128px); background = void; background_alpha = 255; palette { void = #282c34; tone = (#3c4252, #6f7991, #abb6cf); } chart b box { fill = tone; } } }\n  surface ws: an.${surf} { material = double; texture atlas { density = 2; atlas = (128px, 128px); background = void; background_alpha = ${flats.length ? 0 : 255}; palette { void = #282c34; tone = (#3c4252, #6f7991, #abb6cf); } ${chartBlocks} } }\n  component C {\n    requires rig s: r.SlimeRig; requires surface u: BS; provides socket m: an.${sock} capacity = one;\n    bind bone root to s.root; bind bone body to s.body;\n    bind socket m to bone body { frame { origin = (0u, 0u, 0u); x = (1, 0, 0); y = (0, 1, 0); z = (0, 0, 1); } }\n    geometry { bone root { bone body { cube b { origin = (-2u, 0u, -2u); size = (4u, 4u, 4u); surface = u.b; } } } }\n  }\n  use C as c { s = r.SlimeRig; u = bs; };\n  use an.${comp} as part { skin = ws; };\n  connect c.m -> part.mount;\n}`,
  );
}
