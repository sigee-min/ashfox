import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  compileDirectoryWorkspace,
  evaluateAssetQuality,
  type AssetQualityProfile,
  type AuditReport,
} from '../../src';

const repoRoot = path.resolve(__dirname, '../../../..');

const workspaceConfig = (): string =>
  JSON.stringify({
    format: 'ashfox-workspace',
    version: 2,
    name: 'audit-cal',
    packages: [
      {
        name: 'audit-cal',
        root: 'pkg',
        manifest: {
          format: 'ashfox-package',
          version: 1,
          dependencies: [],
          entries: [{ name: 'main', path: 'main.ashfox' }],
          modules: [],
        },
      },
    ],
    include: ['**/*.ashfox'],
    ignore: [],
    build: { directory: 'dist/build' },
    exports: [],
  });

const compileAndAudit = (
  source: string,
  options?: { readonly profile?: AssetQualityProfile; readonly threshold?: number },
): AuditReport => {
  const compiled = compileDirectoryWorkspace(workspaceConfig(), [
    { path: 'pkg/main.ashfox', source },
  ]);
  assert.equal(compiled.ok, true, compiled.ok ? '' : JSON.stringify(compiled.diagnostics));
  const product = compiled.products[0];
  assert.equal(product?.kind, 'model');
  return evaluateAssetQuality({ model: product.model, telemetry: product.telemetry }, options);
};

const lv0Source = (): string => `ashfox-model 1
asset main {
  rig contract R {
    handedness = right;
    frame { x = (1, 0, 0); y = (0, 1, 0); z = (0, 0, 1); }
    joint root { parent = none; role = root; frame { x = (1, 0, 0); y = (0, 1, 0); z = (0, 0, 1); } channels = rotation; mirror = none; }
  }
  skeleton S implements R {
    bind root { parent-origin = (0u, 0u, 0u); frame { x = (1, 0, 0); y = (0, 1, 0); z = (0, 0, 1); } }
  }
  surface contract Skin {
    chart body box { coverage = opaque; }
    material = opaque;
  }
  surface base: Skin {
    material = opaque;
    texture atlas {
      background = bg; background-alpha = 255;
      palette { bg = #101010; body = (#686868, #7f7f7f, #969696); }
      chart body box { fill = body; }
    }
  }
  component Body {
    requires rig skeleton: R;
    requires surface skin: Skin;
    bind bone root to skeleton.root;
    geometry { bone root { cube c0 { origin = (-4u, 0u, -4u); size = (8u, 8u, 8u); surface = skin.body; } } }
  }
  export asset main {
    settings { density = 16; forward = north; profile = creature; }
    skeleton = S;
    use Body as b { bind skeleton = R; bind skin = base; };
  }
}`;

const lv1Source = (): string => `ashfox-model 1
asset main {
  rig contract R {
    handedness = right;
    frame { x = (1, 0, 0); y = (0, 1, 0); z = (0, 0, 1); }
    joint root { parent = none; role = root; frame { x = (1, 0, 0); y = (0, 1, 0); z = (0, 0, 1); } channels = rotation; mirror = none; }
  }
  skeleton S implements R {
    bind root { parent-origin = (0u, 0u, 0u); frame { x = (1, 0, 0); y = (0, 1, 0); z = (0, 0, 1); } }
  }
  surface contract Skin {
    chart torso box { coverage = opaque; }
    chart head box { coverage = opaque; }
    chart ear box { coverage = opaque; }
    chart leg box { coverage = opaque; }
    material = opaque;
  }
  surface base: Skin {
    material = opaque;
    texture atlas {
      background = bg; background-alpha = 255;
      palette { bg = #101010; coat = (#502818, #8a4828, #c46d40); }
      chart torso box { fill = coat; }
      chart head box { fill = coat; }
      chart ear box { fill = coat; }
      chart leg box { fill = coat; }
      grain clustered { seed = 11; }
    }
  }
  component Body {
    requires rig skeleton: R;
    requires surface skin: Skin;
    bind bone root to skeleton.root;
    geometry {
      bone root {
        cube torso { origin = (-4u, 6u, -3u); size = (8u, 6u, 6u); surface = skin.torso; }
        cube head { origin = (-3u, 12u, -5u); size = (6u, 5u, 5u); surface = skin.head; }
        cube ear_l { origin = (-3u, 17u, -3u); size = (2u, 2u, 2u); surface = skin.ear; }
        cube ear_r { origin = (1u, 17u, -3u); size = (2u, 2u, 2u); surface = skin.ear; }
        cube leg_fl { origin = (-3u, 0u, -2.5u); size = (2u, 6u, 2u); surface = skin.leg; }
        cube leg_fr { origin = (1u, 0u, -2.5u); size = (2u, 6u, 2u); surface = skin.leg; }
        cube leg_bl { origin = (-3u, 0u, 0.5u); size = (2u, 6u, 2u); surface = skin.leg; }
        cube leg_br { origin = (1u, 0u, 0.5u); size = (2u, 6u, 2u); surface = skin.leg; }
      }
    }
  }
  export asset main {
    settings { density = 16; forward = north; profile = creature; }
    skeleton = S;
    use Body as b { bind skeleton = R; bind skin = base; };
  }
}`;

const creatureSource = (level: 2 | 3 | 4): string => {
  const highCraft = level >= 3;
  const lv4 = level === 4;
  const baseChartIds = [
    'torso',
    'chest',
    'ruff',
    'head',
    'muzzle',
    'nose',
    'ear',
    'jaw',
    'u_leg_f',
    'paw_f',
  ];
  const hiChartIds = ['u_leg_b', 'paw_b', 'tail_a', 'tail_b'];
  const lv4ChartIds = ['ridge'];
  const allBoxIds = [
    ...baseChartIds,
    ...(highCraft ? hiChartIds : []),
    ...(lv4 ? lv4ChartIds : []),
  ];
  const chartContractDecls = [
    ...allBoxIds.map((id) => `chart ${id} box { coverage = opaque; }`),
    ...(lv4 ? ['chart fin flat { coverage = binary; }'] : []),
  ].join('\n    ');
  const boxChartRule = (id: string): string => {
    if (!highCraft) {
      return id === 'head'
        ? `chart ${id} box { fill = coat; face north { pattern stripe { paint = belly; axis = v; period = 4px; width = 1px; phase = 0; } } }`
        : `chart ${id} box { fill = coat; }`;
    }
    if (id === 'head') {
      return `chart head box {
        fill = coat; grain = soft;
        pattern gradient { to = belly; axis = y; space = local; soft = 0.18ratio; }
        pattern border { paint = dark; width = 1px; edges = bottom; }
        ${lv4 ? 'pattern ao { strength = 0.35ratio; radius = 0.6u; }' : ''}
        face north { stamp eye_dot { at = (2px, 4px); protect = true; } stamp eye_dot { at = (10px, 4px); protect = true; } }
      }`;
    }
    if (id === 'chest' || id === 'muzzle' || id === 'paw_f' || id === 'paw_b') {
      return `chart ${id} box {
        fill = belly; ${lv4 ? 'grain = none; pattern ao { strength = 0.35ratio; radius = 0.6u; }' : ''}
        pattern border { paint = coat; width = 1px; edges = bottom; }
      }`;
    }
    if (!lv4) {
      return `chart ${id} box {
        fill = coat; grain = soft;
        pattern gradient { to = dark; axis = y; space = model; soft = 0.2ratio; }
        ${id === 'torso' ? 'pattern ao { strength = 0.45ratio; radius = 0.8u; }' : ''}
      }`;
    }
    if (id === 'torso' || id === 'tail_a' || id === 'tail_b') {
      return `chart ${id} box {
        fill = coat; grain = clustered;
        pattern gradient { from = dark; to = coat; axis = y; space = model; soft = 0.15ratio; }
        ${id === 'torso' ? 'pattern ao { strength = 0.35ratio; radius = 0.6u; }' : ''}
      }`;
    }
    if (id === 'u_leg_f' || id === 'u_leg_b') {
      return `chart ${id} box {
        fill = coat; grain = soft;
        pattern ao { strength = 0.35ratio; radius = 0.6u; }
      }`;
    }
    return `chart ${id} box {
      fill = coat; grain = soft;
      pattern border { paint = dark; width = 1px; edges = bottom; }
    }`;
  };
  return `ashfox-model 1
asset main {
  rig contract R {
    handedness = right;
    frame { x = (1, 0, 0); y = (0, 1, 0); z = (0, 0, 1); }
    joint root { parent = none; role = root; frame { x = (1, 0, 0); y = (0, 1, 0); z = (0, 0, 1); } channels = rotation; mirror = none; }
    joint body { parent = root; role = body; frame { x = (1, 0, 0); y = (0, 1, 0); z = (0, 0, 1); } channels = rotation; mirror = none; }
    joint head { parent = body; role = head; frame { x = (1, 0, 0); y = (0, 1, 0); z = (0, 0, 1); } channels = rotation; mirror = none; }
    joint jaw { parent = head; role = head; frame { x = (1, 0, 0); y = (0, 1, 0); z = (0, 0, 1); } channels = rotation; mirror = none; }
    joint leg_fl { parent = body; role = leg; frame { x = (1, 0, 0); y = (0, 1, 0); z = (0, 0, 1); } channels = rotation; mirror = none; }
    joint leg_fr { parent = body; role = leg; frame { x = (1, 0, 0); y = (0, 1, 0); z = (0, 0, 1); } channels = rotation; mirror = none; }
    ${highCraft ? 'joint tail { parent = body; role = tail; frame { x = (1, 0, 0); y = (0, 1, 0); z = (0, 0, 1); } channels = rotation; mirror = none; }' : ''}
    ${lv4 ? 'joint leg_bl { parent = body; role = leg; frame { x = (1, 0, 0); y = (0, 1, 0); z = (0, 0, 1); } channels = rotation; mirror = none; }' : ''}
    ${lv4 ? 'joint leg_br { parent = body; role = leg; frame { x = (1, 0, 0); y = (0, 1, 0); z = (0, 0, 1); } channels = rotation; mirror = none; }' : ''}
  }
  skeleton S implements R {
    bind root { parent-origin = (0u, 0u, 0u); frame { x = (1, 0, 0); y = (0, 1, 0); z = (0, 0, 1); } }
    bind body { parent-origin = (0u, 6u, 0u); frame { x = (1, 0, 0); y = (0, 1, 0); z = (0, 0, 1); } }
    bind head { parent-origin = (0u, 5u, -5u); frame { x = (1, 0, 0); y = (0, 1, 0); z = (0, 0, 1); } }
    bind jaw { parent-origin = (0u, -1u, -2u); frame { x = (1, 0, 0); y = (0, 1, 0); z = (0, 0, 1); } }
    bind leg_fl { parent-origin = (-3u, -1u, -4u); frame { x = (1, 0, 0); y = (0, 1, 0); z = (0, 0, 1); } }
    bind leg_fr { parent-origin = (3u, -1u, -4u); frame { x = (1, 0, 0); y = (0, 1, 0); z = (0, 0, 1); } }
    ${highCraft ? 'bind tail { parent-origin = (0u, 2u, 6u); frame { x = (1, 0, 0); y = (0, 1, 0); z = (0, 0, 1); } }' : ''}
    ${lv4 ? 'bind leg_bl { parent-origin = (-3u, -1u, 4u); frame { x = (1, 0, 0); y = (0, 1, 0); z = (0, 0, 1); } }' : ''}
    ${lv4 ? 'bind leg_br { parent-origin = (3u, -1u, 4u); frame { x = (1, 0, 0); y = (0, 1, 0); z = (0, 0, 1); } }' : ''}
  }
  motion idle for R {
    duration = 2s; fps = 20; loop = loop; rest-relative = true;
    track head.rotation { key 0s = (0deg, 0deg, 0deg) linear; key 1s = (4deg, 6deg, 0deg) linear; key 2s = (0deg, 0deg, 0deg) linear; }
    ${highCraft ? 'track body.rotation { key 0s = (0deg, 0deg, 0deg) linear; key 1s = (3deg, 0deg, 0deg) linear; key 2s = (0deg, 0deg, 0deg) linear; }' : ''}
    ${lv4 ? 'track jaw.rotation { key 0s = (0deg, 0deg, 0deg) linear; key 1s = (5deg, 0deg, 0deg) linear; key 2s = (0deg, 0deg, 0deg) linear; }' : ''}
    ${lv4 ? 'track leg_fl.rotation { key 0s = (0deg, 0deg, 0deg) linear; key 1s = (-4deg, 0deg, 0deg) linear; key 2s = (0deg, 0deg, 0deg) linear; }' : ''}
    ${highCraft ? 'track tail.rotation { key 0s = (0deg, -8deg, 0deg) linear; key 1s = (4deg, 8deg, 0deg) linear; key 2s = (0deg, -8deg, 0deg) linear; }' : ''}
  }
  ${lv4 ? 'motion alert for R { duration = 1s; fps = 20; loop = loop; rest-relative = true; track head.rotation { key 0s = (0deg, 0deg, 0deg) linear; key 0.5s = (-10deg, 12deg, 0deg) linear; key 1s = (0deg, 0deg, 0deg) linear; } }' : ''}
  surface contract Skin {
    ${chartContractDecls}
    material = ${lv4 ? 'double' : 'opaque'};
  }
  surface craft: Skin {
    material = ${lv4 ? 'double' : 'opaque'};
    texture atlas {
      ${highCraft ? 'density = 2;' : ''}
      background = bg; background-alpha = 255;
      palette {
        bg = #2c2420;
        coat = (#5a2e18, #94512b, #cf7a44);
        belly = (#8b6b45, #caa676, #f5dbb2);
        dark = (#32221b, #4a3126, #694536);
        eye = #242630;
      }
      stamp eye_dot { pixels = "eee/eee/eee"; e = eye; }
      ${allBoxIds.map(boxChartRule).join('\n      ')}
      ${lv4 ? 'chart fin flat { fill = coat; coverage = 00110111111111111111111011000000; grain = soft; pattern gradient { to = belly; axis = y; space = model; soft = 0.2ratio; } }' : ''}
      grain clustered { seed = 42; }
      tone ${highCraft ? 'painterly' : 'voxel'};
    }
  }
  component Body {
    requires rig skeleton: R;
    requires surface skin: Skin;
    bind bone body to skeleton.body;
    bind bone head to skeleton.head;
    bind bone jaw to skeleton.jaw;
    bind bone leg_fl to skeleton.leg_fl;
    ${lv4 ? 'bind bone leg_fr to skeleton.leg_fr; bind bone tail to skeleton.tail; bind bone leg_bl to skeleton.leg_bl; bind bone leg_br to skeleton.leg_br;' : highCraft ? 'bind bone leg_fr to skeleton.leg_fr; bind bone tail to skeleton.tail;' : ''}
    geometry {
      bone body {
        cube torso_core { origin = (-4u, 5u, -5u); size = (8u, 7u, 11u); surface = skin.torso; }
        cube chest { origin = ${lv4 ? '(-3.5u, 4u, -8.5u); size = (7u, 6u, 4u)' : '(-3.5u, 4u, -6.5u); size = (7u, 6u, 5u)'}; ${lv4 ? 'pivot = (0u, 7u, -6.5u); rotation = (12deg, 0deg, 0deg);' : ''} surface = skin.chest; }
        cube ruff { origin = ${lv4 ? '(-4.5u, 11.5u, -5.5u)' : '(-4.5u, 9u, -5.5u)'}; size = (9u, 3u, 4u); ${lv4 ? 'pivot = (0u, 12.5u, -4u); rotation = (-10deg, 0deg, 0deg);' : ''} surface = skin.ruff; }
        ${lv4 ? 'cube ridge_l { origin = (-2u, 11.5u, -2u); size = (2u, 2u, 6u); pivot = (-1u, 11.5u, 1u); rotation = (0deg, 0deg, -18deg); mirror-x = ridge_r; surface = skin.ridge; }' : ''}
        ${lv4 ? 'plane crest_l { origin = (-4u, 11u, -2u); size = (2u, 4u); u-axis = (0u, 0u, 1u); v-axis = (0u, 1u, 0u); mirror-x = crest_r; surface = skin.fin; }' : ''}
        bone head {
          cube skull { origin = (-4u, 9u, -12u); size = (8u, 7u, 7u); ${highCraft ? 'pivot = (0u, 12u, -9u); rotation = (5deg, 0deg, 0deg);' : ''} surface = skin.head; }
          cube muzzle { origin = (-2.5u, 9.5u, -15u); size = (5u, 3u, 4u); surface = skin.muzzle; }
          cube nose { origin = (-1u, 11.5u, ${lv4 ? '-16u); size = (2u, 2u, 2u)' : '-15.5u); size = (2u, 1u, 1u)'}; surface = skin.nose; }
          cube ear_l { origin = (-4u, 15u, -10u); size = (2u, 4u, 2u); ${highCraft ? 'pivot = (-3u, 15u, -9u); rotation = (0deg, 0deg, -16deg); mirror-x = ear_r;' : ''} surface = skin.ear; }
          ${!highCraft ? 'cube ear_r { origin = (2u, 15u, -10u); size = (2u, 4u, 2u); surface = skin.ear; }' : ''}
          bone jaw {
            cube lower_jaw { origin = (-2u, 8u, -14.5u); size = (4u, 2u, 4u); ${lv4 ? 'pivot = (0u, 9.5u, -11u); rotation = (8deg, 0deg, 0deg);' : ''} surface = skin.jaw; }
          }
        }
        bone leg_fl {
          cube upper_fl { origin = ${lv4 ? '(-4u, 2.5u, -5u); size = (3u, 3u, 3u)' : '(-4u, 3u, -5u); size = (3u, 5u, 3u)'}; ${highCraft ? 'mirror-x = upper_fr;' : ''} surface = skin.u_leg_f; }
          cube paw_fl { origin = (-4u, 0u, -6u); size = (3u, 3u, 4u); surface = skin.paw_f; }
          ${!highCraft ? 'cube upper_fr { origin = (1u, 3u, -5u); size = (3u, 5u, 3u); surface = skin.u_leg_f; } cube paw_fr { origin = (1u, 0u, -6u); size = (3u, 3u, 4u); surface = skin.paw_f; }' : ''}
        }
        ${highCraft ? 'bone leg_fr { cube paw_fr { origin = (1u, 0u, -6u); size = (3u, 3u, 4u); surface = skin.paw_f; } }' : ''}
        ${lv4 ? 'bone leg_bl { cube upper_bl { origin = (-4u, 2.5u, 3u); size = (3u, 3u, 3u); mirror-x = upper_br; surface = skin.u_leg_b; } cube paw_bl { origin = (-4u, 0u, 2u); size = (3u, 3u, 4u); surface = skin.paw_b; } }' : highCraft ? 'cube upper_bl { origin = (-4u, 3u, 3u); size = (3u, 5u, 3u); mirror-x = upper_br; surface = skin.u_leg_b; } cube paw_bl { origin = (-4u, 0u, 2u); size = (3u, 3u, 4u); surface = skin.paw_b; } cube paw_br { origin = (1u, 0u, 2u); size = (3u, 3u, 4u); surface = skin.paw_b; }' : ''}
        ${lv4 ? 'bone leg_br { cube paw_br { origin = (1u, 0u, 2u); size = (3u, 3u, 4u); surface = skin.paw_b; } }' : ''}
        ${highCraft ? `bone tail { cube tail_a { origin = (-2u, 6u, 5u); size = (4u, 4u, 6u); pivot = (0u, 8u, 5u); rotation = (18deg, 0deg, 0deg); surface = skin.tail_a; } cube tail_b { origin = (-1.5u, 7u, 10u); size = (3u, 3u, 5u); ${lv4 ? 'pivot = (0u, 8.5u, 10u); rotation = (24deg, 0deg, 0deg);' : ''} surface = skin.tail_b; } }` : ''}
      }
    }
  }
  export asset main {
    settings { density = 16; forward = north; profile = creature; }
    skeleton = S;
    motion = idle;
    ${lv4 ? 'motion = alert;' : ''}
    use Body as b { bind skeleton = R; bind skin = craft; };
  }
}`;
};

const propSource = (profileLine = 'profile = prop;'): string => `ashfox-model 1
asset main {
  rig contract R {
    handedness = right;
    frame { x = (1, 0, 0); y = (0, 1, 0); z = (0, 0, 1); }
    joint root { parent = none; role = root; frame { x = (1, 0, 0); y = (0, 1, 0); z = (0, 0, 1); } channels = rotation; mirror = none; }
  }
  skeleton S implements R {
    bind root { parent-origin = (0u, 0u, 0u); frame { x = (1, 0, 0); y = (0, 1, 0); z = (0, 0, 1); } }
  }
  surface contract Skin {
    chart base box { coverage = opaque; }
    chart metal box { coverage = opaque; }
    chart cap box { coverage = opaque; }
    material = opaque;
  }
  surface lantern: Skin {
    material = opaque;
    texture atlas {
      density = 2;
      background = bg; background-alpha = 255;
      palette { bg = #2c2e36; iron = (#323745, #525b70, #7e8aa6); glow = (#a85410, #e69222, #ffdf70); }
      chart base box { fill = iron; grain = clustered; pattern ao { strength = 0.4ratio; radius = 0.7u; } pattern border { paint = glow; width = 1px; edges = top; } }
      chart metal box { fill = glow; grain = soft; pattern gradient { from = glow; to = iron; axis = y; space = model; soft = 0.15ratio; } }
      chart cap box { fill = iron; grain = none; pattern ao { strength = 0.4ratio; radius = 0.7u; } pattern border { paint = glow; width = 1px; edges = bottom; } }
      tone painterly;
    }
  }
  component Lantern {
    requires rig skeleton: R;
    requires surface skin: Skin;
    bind bone root to skeleton.root;
    geometry {
      bone root {
        cube foot { origin = (-3u, 0u, -3u); size = (6u, 2u, 6u); surface = skin.base; }
        cube core { origin = (-2u, 2u, -2u); size = (4u, 6u, 4u); surface = skin.metal; }
        cube cap { origin = (-3.5u, 8u, -3.5u); size = (7u, 2u, 7u); pivot = (0u, 8u, 0u); rotation = (0deg, 22.5deg, 0deg); surface = skin.cap; }
      }
    }
  }
  export asset main {
    settings { density = 16; forward = north; ${profileLine} }
    skeleton = S;
    use Lantern as l { bind skeleton = R; bind skin = lantern; };
  }
}`;

const lv0 = compileAndAudit(lv0Source());
const lv1 = compileAndAudit(lv1Source());
const lv2 = compileAndAudit(creatureSource(2));
const lv3 = compileAndAudit(creatureSource(3));
const lv4 = compileAndAudit(creatureSource(4));

assert.equal(lv0.passed, false);
assert.ok(lv0.score < 25, `expected Lv0 < 25, got ${lv0.score}`);
assert.equal(lv1.passed, false);
assert.ok(
  lv1.score > lv0.score && lv1.score < 45,
  `expected Lv0(${lv0.score}) < Lv1(${lv1.score}) < 45`,
);
assert.equal(lv2.passed, false);
assert.ok(
  lv2.score > lv1.score && lv2.score < 68,
  `expected Lv1(${lv1.score}) < Lv2(${lv2.score}) < 68`,
);
assert.equal(lv3.passed, true, JSON.stringify(lv3.hardGates.filter((g) => !g.passed)));
assert.equal(lv3.grade, 'pass', `expected Lv3 grade 'pass' (75..84), got ${lv3.score}`);
assert.ok(
  lv3.score >= 75 && lv3.score <= 84 && lv3.score > lv2.score,
  `expected Lv3(${lv3.score}) in 75..84 & > Lv2(${lv2.score})`,
);
assert.equal(lv4.passed, true, JSON.stringify(lv4.hardGates.filter((g) => !g.passed)));
assert.equal(lv4.grade, 'excellent');
assert.ok(
  lv4.score >= 85 && lv4.score >= lv3.score + 5,
  `expected Lv4(${lv4.score}) >= 85 & >= Lv3(${lv3.score})+5`,
);

const authoredProp = compileAndAudit(propSource('profile = prop;'));
assert.equal(authoredProp.profile, 'prop');
assert.equal(authoredProp.profileSource, 'authored');
assert.equal(
  authoredProp.passed,
  true,
  `expected prop pass, got ${authoredProp.score} gates=${JSON.stringify(authoredProp.hardGates.filter((g) => !g.passed))}`,
);

const inferredProp = compileAndAudit(propSource(''));
assert.equal(inferredProp.profile, 'prop');
assert.equal(inferredProp.profileSource, 'inferred');

const overriddenBlock = compileAndAudit(propSource(''), { profile: 'block' });
assert.equal(overriddenBlock.profile, 'block');
assert.equal(overriddenBlock.profileSource, 'override');

const badProfile = compileDirectoryWorkspace(workspaceConfig(), [
  { path: 'pkg/main.ashfox', source: propSource('profile = weapon;') },
]);
assert.equal(badProfile.ok, false);
assert.ok(
  badProfile.diagnostics.some(
    (d) =>
      d.code === 'asset.invalid-profile' ||
      d.code === 'workspace.source.invalid-profile' ||
      d.message.includes('invalid-profile'),
  ),
  JSON.stringify(badProfile.diagnostics),
);

const compileFile = (rel: string) => {
  const dir = path.dirname(path.join(repoRoot, rel));
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.ashfox'))
    .map((f) => ({ path: `pkg/${f}`, source: fs.readFileSync(path.join(dir, f), 'utf8') }));
  const entry = path.basename(rel);
  const entrySource = files.find((f) => f.path === `pkg/${entry}`)!.source;
  const entryName = entrySource.match(/\basset\s+(\w+)/)?.[1] ?? 'main';
  const cfg = JSON.stringify({
    format: 'ashfox-workspace',
    version: 2,
    name: 'ex',
    packages: [
      {
        name: 'ex',
        root: 'pkg',
        manifest: {
          format: 'ashfox-package',
          version: 1,
          dependencies: [],
          entries: [{ name: entryName, path: entry }],
          modules: files
            .filter((f) => f.path !== `pkg/${entry}`)
            .map((f) => ({ subpath: `./${f.path.slice(4)}`, path: f.path.slice(4) })),
        },
      },
    ],
    include: ['**/*.ashfox'],
    ignore: [],
    build: { directory: 'dist/build' },
    exports: [],
  });
  const res = compileDirectoryWorkspace(cfg, files);
  assert.equal(res.ok, true, res.ok ? '' : JSON.stringify(res.diagnostics));
  const prod = res.products[0]!;
  assert.equal(prod.kind, 'model');
  return evaluateAssetQuality({ model: prod.model, telemetry: prod.telemetry });
};

const foxReport = compileFile('examples/fox/creatures/fox.ashfox');
const goblinReport = compileFile('examples/goblin/creatures/goblin.ashfox');
const griffinReport = compileFile('examples/griffin/workbench/main.ashfox');
const markerReport = compileFile('examples/minecraft/marker.ashfox');
const lanternReport = compileFile('examples/prop/lantern.ashfox');

for (const [name, report] of [
  ['fox', foxReport],
  ['goblin', goblinReport],
  ['griffin', griffinReport],
  ['marker', markerReport],
  ['lantern', lanternReport],
] as const) {
  assert.equal(
    report.passed,
    true,
    `${name} should pass audit: ${JSON.stringify(report.hardGates.filter((g) => !g.passed))}`,
  );
  assert.ok(report.score >= 85, `${name} expected >= 85, got ${report.score}`);
  assert.equal(report.grade, 'excellent', `${name} expected excellent, got ${report.grade}`);
}

console.log(
  `calibration ok: Lv0=${lv0.score} Lv1=${lv1.score} Lv2=${lv2.score} Lv3=${lv3.score} Lv4=${lv4.score} fox=${foxReport.score} goblin=${goblinReport.score} griffin=${griffinReport.score} marker=${markerReport.score} lantern=${lanternReport.score}`,
);
