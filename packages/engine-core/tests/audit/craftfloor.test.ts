import assert from 'node:assert/strict';
import {
  compileDirectoryWorkspace,
  evaluateAssetQuality,
  evaluateCraftFloor,
  type AuditReport,
} from '../../src';

const wsCfg = JSON.stringify({
  format: 'ashfox-workspace',
  version: 2,
  name: 'craft-floor-test',
  packages: [
    {
      name: 'main',
      root: 'assets/models',
      manifest: {
        format: 'ashfox-package',
        version: 1,
        dependencies: [],
        entries: [{ name: 'main', path: 'main.ashfox' }],
        modules: [],
      },
    },
  ],
  include: ['assets/**/*.ashfox'],
  ignore: [],
  build: { directory: 'dist/build' },
  exports: [],
});

const compileAndAudit = (
  source: string,
): { readonly report: AuditReport; readonly craft: ReturnType<typeof evaluateCraftFloor> } => {
  const res = compileDirectoryWorkspace(wsCfg, [{ path: 'assets/models/main.ashfox', source }]);
  assert.equal(res.ok, true, res.ok ? '' : JSON.stringify(res.diagnostics));
  const prod = res.products[0];
  assert.equal(prod?.kind, 'model');
  const report = evaluateAssetQuality({ model: prod.model, telemetry: prod.telemetry });
  const craft = evaluateCraftFloor('creature', prod.model, {
    visibleNodeIds: new Set(Object.keys(prod.model.scene.nodes)),
    obbs: [],
    enabledFaces: [],
    worldMin: [0, 0, 0],
    worldMax: [0, 0, 0],
    boneCount: 0,
    maxBoneDepth: 0,
    hasOrphanEmptyBones: false,
  });
  void craft;
  return { report, craft };
};

const failedGateIds = (report: AuditReport): readonly string[] =>
  report.hardGates.filter((g) => !g.passed).map((g) => g.id);

const failedCraftMetrics = (report: AuditReport): readonly string[] =>
  report.topDeductions.map((d) => d.metricId);

const hasCraftFailure = (report: AuditReport, checkId: string): boolean =>
  report.hardGates.some((g) => !g.passed && g.message.includes(checkId)) ||
  failedCraftMetrics(report).includes(checkId);

const highCraftGriffinSource = (opts?: {
  readonly extraTorso?: string;
  readonly extraHead?: string;
  readonly extraWing?: string;
  readonly extraTail?: string;
  readonly extraLeg?: string;
  readonly omitHindLegs?: boolean;
  readonly flatWings?: boolean;
  readonly frontCrossEyes?: boolean;
  readonly foreheadEyes?: boolean;
  readonly darkMetal?: boolean;
  readonly clippedWhite?: boolean;
  readonly stripLayers?: boolean;
}): string => {
  const o = opts ?? {};
  const wingZ = o.flatWings ? '0deg' : '28deg';
  const wingZRight = o.flatWings ? '0deg' : '-28deg';
  const slotDecl = o.frontCrossEyes
    ? `expression_slot face {
         placement = front;
         origin = (2u, 19u, -10.05u); size = (4u, 3u); u_axis = (-1u, 0u, 0u); v_axis = (0u, 1u, 0u);
         neutral = skin.eye_n; blink = skin.eye_b;
       }`
    : o.foreheadEyes
      ? `expression_slot face {
           placement = lateral_pair;
           origin = (-4u, 21.8u, -8.5u); size = (4u, 2u);
           neutral = skin.eye_n; blink = skin.eye_b;
         }`
      : `expression_slot face {
           placement = lateral_pair;
           size = (4u, 3u);
           neutral = skin.eye_n; blink = skin.eye_b;
         }`;
  const steelColors = o.darkMetal ? '(#14181e, #242a33, #363e4a)' : '(#3b424a, #727e8a, #b0bcc7)';
  const chestColors = o.clippedWhite
    ? '(#f4f4f4, #fafafa, #ffffff)'
    : '(#78746a, #b8b09c, #e6dec8)';
  const hindRig = o.omitHindLegs
    ? ''
    : `joint hindleg_l { parent = torso; role = leg; channels = rotation; }
       joint hindleg_r { parent = torso; role = leg; channels = rotation; }`;
  const hindBinds = o.omitHindLegs
    ? ''
    : `bind hindleg_l { parent_origin = (-3u, -4u, 4u); }
       bind hindleg_r { parent_origin = (3u, -4u, 4u); }`;
  const hindPortBinds = o.omitHindLegs
    ? ''
    : `bind bone hindleg_l to skeleton.hindleg_l;
       bind bone hindleg_r to skeleton.hindleg_r;`;
  const hindGeom = o.omitHindLegs
    ? ''
    : `bone hindleg_l {
         cube thigh_l { origin = (-4u, 4u, 2u); size = (3u, 5u, 4u); surface = skin.thigh; }
         cube paw_bl { origin = (-4u, 0u, 1u); size = (3u, 4u, 3u); surface = skin.claw_b; }
       }
       bone hindleg_r {
         cube thigh_r { origin = (1u, 4u, 2u); size = (3u, 5u, 4u); surface = skin.thigh; }
         cube paw_br { origin = (1u, 0u, 1u); size = (3u, 4u, 3u); surface = skin.claw_b; }
       }`;
  const wingPlumes = o.stripLayers
    ? ''
    : `plane plume_l { origin = (-16u, 16u, 0u); size = (8u, 4u); u_axis = (1u, 0u, 0u); v_axis = (0u, 1u, 0u); surface = skin.feather_p; }`;
  const rightWingPlumes = o.stripLayers
    ? ''
    : `plane plume_r { origin = (8u, 16u, 0u); size = (8u, 4u); u_axis = (1u, 0u, 0u); v_axis = (0u, 1u, 0u); surface = skin.feather_p; }`;
  const hasExtra = Boolean(o.extraTorso || o.extraHead || o.extraWing || o.extraTail || o.extraLeg);
  const tailCharts = o.extraTail
    ? ''
    : 'chart tail_a box { coverage = opaque; } chart tail_b box { coverage = opaque; }';
  const tailAtlas = o.extraTail
    ? ''
    : 'chart tail_a box { fill = gold; roughness = 0.74; grain = soft; } chart tail_b box { fill = gold; roughness = 0.74; grain = soft; }';
  const hindCharts = o.omitHindLegs
    ? ''
    : 'chart claw_b box { coverage = opaque; } chart thigh box { coverage = opaque; }';
  const hindAtlas = o.omitHindLegs
    ? ''
    : 'chart claw_b box { fill = steel; roughness = 0.30; metallic = 0.86; grain = brushed; } chart thigh box { fill = gold; roughness = 0.74; grain = soft; }';
  const featherChart = o.stripLayers ? '' : 'chart feather_p flat { coverage = opaque; }';
  const featherAtlas = o.stripLayers
    ? ''
    : 'chart feather_p flat { fill = ivory; grain = soft; pattern border { paint = gold; width = 1px; edges = bottom; } }';
  const auxChart = hasExtra ? 'chart aux box { coverage = opaque; }' : '';
  const auxAtlas = hasExtra ? 'chart aux box { fill = gold; roughness = 0.74; grain = soft; }' : '';
  return `ashfox 1
model main {
  rig contract R {
    joint root { parent = none; role = root; channels = (rotation, scale); }
    joint torso { parent = root; role = body; channels = (position, rotation); }
    joint head { parent = torso; role = head; channels = rotation; }
    joint left_wing { parent = torso; role = wing; channels = rotation; }
    joint left_wing_tip { parent = left_wing; role = wing; channels = rotation; }
    joint right_wing { parent = torso; role = wing; channels = rotation; }
    joint right_wing_tip { parent = right_wing; role = wing; channels = rotation; }
    joint foreleg_l { parent = torso; role = leg; channels = rotation; }
    joint foreleg_r { parent = torso; role = leg; channels = rotation; }
    ${hindRig}
    joint tail { parent = torso; role = tail; channels = rotation; }
  }
  skeleton S implements R {
    bind root { parent_origin = (0u, 0u, 0u); }
    bind torso { parent_origin = (0u, 12u, 0u); }
    bind head { parent_origin = (0u, 5u, -5u); }
    bind left_wing { parent_origin = (-4u, 4u, -1u); }
    bind left_wing_tip { parent_origin = (-8u, 0u, 1u); }
    bind right_wing { parent_origin = (4u, 4u, -1u); }
    bind right_wing_tip { parent_origin = (8u, 0u, 1u); }
    bind foreleg_l { parent_origin = (-3u, -4u, -4u); }
    bind foreleg_r { parent_origin = (3u, -4u, -4u); }
    ${hindBinds}
    bind tail { parent_origin = (0u, -1u, 7u); }
  }
  surface contract Skin {
    chart coat box { coverage = opaque; }
    chart skull box { coverage = opaque; }
    chart chest box { coverage = opaque; }
    chart claw box { coverage = opaque; }
    ${hindCharts}
    chart leg box { coverage = opaque; }
    ${tailCharts}
    chart wing box { coverage = opaque; }
    chart wing_tip box { coverage = opaque; }
    ${auxChart}
    ${featherChart}
    chart eye_n flat { coverage = opaque; }
    chart eye_b flat { coverage = opaque; }
    material = cutout;
  }
  surface base: Skin {
    material = cutout;
    texture atlas {
      density = 2;
      background = void; background_alpha = 0;
      palette {
        void = #000000;
        gold = (#6d4a1b, #a87528, #e0af4c);
        ivory = ${chestColors};
        steel = ${steelColors};
        dark = (#242830, #404854, #606a78);
        eye = #228899;
      }
      stamp crest { pixels = "gg/gg"; g = gold; }
      stamp eye_s { pixels = ".ee./eeee/.ee."; e = eye; }
      chart coat box { fill = gold; roughness = 0.72; grain = soft; pattern gradient { to = dark; axis = y; space = local; soft = 0.2; } pattern ao { strength = 0.4; radius = 0.8u; } }
      chart skull box { fill = gold; roughness = 0.72; grain = soft; pattern ao { strength = 0.35; radius = 0.6u; } }
      chart chest box { fill = ivory; roughness = 0.78; metallic = 0.0; grain = soft; pattern border { paint = gold; width = 1px; edges = bottom; } pattern ao { strength = 0.35; radius = 0.7u; } face north { stamp crest { at = (2px, 2px); protect = true; } } }
      chart claw box { fill = steel; roughness = 0.30; metallic = 0.86; grain = brushed; pattern border { paint = gold; width = 1px; edges = bottom; } }
      ${hindAtlas}
      chart leg box { fill = gold; roughness = 0.74; grain = soft; }
      ${tailAtlas}
      chart wing box { fill = ivory; roughness = 0.76; grain = soft; pattern border { paint = gold; width = 1px; edges = top; } pattern ao { strength = 0.35; radius = 0.6u; } }
      chart wing_tip box { fill = ivory; roughness = 0.76; grain = soft; pattern border { paint = gold; width = 1px; edges = top; } }
      ${auxAtlas}
      ${featherAtlas}
      chart eye_n flat { fill = ivory; stamp eye_s { at = (2px, 1px); protect = true; } }
      chart eye_b flat { fill = gold; stamp crest { at = (2px, 1px); protect = true; } }
      tone painterly;
    }
  }
  component Body {
    requires rig skeleton: R;
    requires surface skin: Skin;
    bind bone root to skeleton.root;
    bind bone torso to skeleton.torso;
    bind bone head to skeleton.head;
    bind bone left_wing to skeleton.left_wing;
    bind bone left_wing_tip to skeleton.left_wing_tip;
    bind bone right_wing to skeleton.right_wing;
    bind bone right_wing_tip to skeleton.right_wing_tip;
    bind bone foreleg_l to skeleton.foreleg_l;
    bind bone foreleg_r to skeleton.foreleg_r;
    ${hindPortBinds}
    bind bone tail to skeleton.tail;
    geometry {
      bone root {
        bone torso {
          cube haunch { origin = (-4.5u, 8u, 0u); size = (9u, 7u, 8u); surface = skin.coat; }
          cube chest { origin = (-5u, 8u, -7u); size = (10u, 9u, 7u); ${o.stripLayers ? '' : 'pivot = (0u, 12u, -3u); rotation = (6deg, 0deg, 0deg);'} surface = skin.chest; }
          ${o.extraTorso ?? ''}
          bone head {
            cube skull { origin = (-4u, 16u, -10u); size = (8u, 7u, 7u); ${o.stripLayers ? '' : 'pivot = (0u, 19u, -6u); rotation = (4deg, 0deg, 0deg);'} surface = skin.skull; }
            ${slotDecl}
            ${o.extraHead ?? ''}
          }
          bone left_wing {
            cube wing_in_l { origin = (-11u, 15u, -3u); size = (7u, 3u, 5u); pivot = (-4u, 16u, -1u); rotation = (0deg, 0deg, ${wingZ}); surface = skin.wing; }
            ${o.extraWing ?? ''}
            bone left_wing_tip {
              cube wing_out_l { origin = (-19u, 16u, -2u); size = (9u, 2u, 4u); pivot = (-11u, 17u, 0u); rotation = (0deg, 0deg, ${wingZ}); surface = skin.wing_tip; }
              ${wingPlumes}
            }
          }
          bone right_wing {
            cube wing_in_r { origin = (4u, 15u, -3u); size = (7u, 3u, 5u); pivot = (4u, 16u, -1u); rotation = (0deg, 0deg, ${wingZRight}); surface = skin.wing; }
            bone right_wing_tip {
              cube wing_out_r { origin = (10u, 16u, -2u); size = (9u, 2u, 4u); pivot = (11u, 17u, 0u); rotation = (0deg, 0deg, ${wingZRight}); surface = skin.wing_tip; }
              ${rightWingPlumes}
            }
          }
          bone foreleg_l {
            ${
              o.extraLeg ??
              `cube leg_fl { origin = (-4u, 4u, -6u); size = (3u, 5u, 3u); surface = skin.leg; }
            cube paw_fl { origin = (-4u, 0u, -7u); size = (3u, 4u, 4u); surface = skin.claw; }`
            }
          }
          bone foreleg_r {
            cube leg_fr { origin = (1u, 4u, -6u); size = (3u, 5u, 3u); surface = skin.leg; }
            cube paw_fr { origin = (1u, 0u, -7u); size = (3u, 4u, 4u); surface = skin.claw; }
          }
          ${hindGeom}
          bone tail {
            ${
              o.extraTail ??
              `cube tail_a { origin = (-1.5u, 9.5u, 8u); size = (3u, 3u, 6u); ${o.stripLayers ? '' : 'pivot = (0u, 11u, 8u); rotation = (-12deg, 0deg, 0deg);'} surface = skin.tail_a; }
            taper tail_b { origin = (-1.5u, 10u, 14u); size = (3u, 3u, 4u); top_scale = (0.35, 0.35); axis = z; surface = skin.tail_b; }`
            }
          }
        }
      }
    }
  }
  motion idle for R {
    duration = 2s; fps = 24; loop = loop; rest_relative = true;
    track torso.position { key 0s = (0u, 0u, 0u) smooth; key 1s = (0u, -0.4u, 0u) ease_in_out; key 2s = (0u, 0u, 0u) ease_out; }
    track head.rotation { key 0s = (0deg, 0deg, 0deg) smooth; key 1s = (-4deg, 8deg, 0deg) ease_in_out; key 2s = (0deg, 0deg, 0deg) ease_out; }
    track left_wing.rotation { key 0s = (0deg, 0deg, 0deg) smooth; key 1s = (0deg, 0deg, -12deg) ease_in_out; key 2s = (0deg, 0deg, 0deg) ease_out; }
    track right_wing.rotation { key 0s = (0deg, 0deg, 0deg) smooth; key 1s = (0deg, 0deg, 12deg) ease_in_out; key 2s = (0deg, 0deg, 0deg) ease_out; }
    track tail.rotation { key 0s = (0deg, 0deg, 0deg) smooth; key 1s = (4deg, 10deg, 0deg) ease_in_out; key 2s = (0deg, 0deg, 0deg) ease_out; }
    expression face { at 0s = neutral; at 1.2s..1.4s = blink; }
  }
  settings { density = 16; forward = north; profile = creature; }
  skeleton = S;
  motions = [idle];
  use Body as b { skeleton = R; skin = base; }
}`;
};

// 1. High-craft winged_quadruped griffin passes all Anti-Derp checks & >= 85 score.
const hero = compileAndAudit(highCraftGriffinSource()).report;
assert.equal(
  hero.passed,
  true,
  `hero failed: ${JSON.stringify(hero.hardGates.filter((g) => !g.passed))}`,
);
assert.ok(hero.score >= 85, `expected high-craft hero >= 85, got ${hero.score}`);

// 2. Allowed wedge on weapon/pauldron/horn/fin still passes cleanly!
const heroWithArmorWedge = compileAndAudit(
  highCraftGriffinSource({
    extraWing: `wedge pauldron_l { origin = (-5u, 17u, -2u); size = (3u, 3u, 4u); slope = west; surface = skin.aux; }`,
  }),
).report;
assert.equal(heroWithArmorWedge.passed, true, JSON.stringify(failedGateIds(heroWithArmorWedge)));

// 3. Forbidden large wedge on chest/breast/muzzle/snout/boot fails craft.primitiveAppropriateness!
const wedgeChest = compileAndAudit(
  highCraftGriffinSource({
    extraTorso: `wedge breast { origin = (-4u, 9.5u, -10.5u); size = (8u, 7u, 4u); slope = north; surface = skin.aux; }`,
  }),
).report;
assert.equal(wedgeChest.passed, false);
assert.equal(hasCraftFailure(wedgeChest, 'craft.primitiveAppropriateness'), true);

const wedgeSnout = compileAndAudit(
  highCraftGriffinSource({
    extraHead: `wedge muzzle { origin = (-2u, 16.5u, -14u); size = (4u, 3u, 4u); slope = north; surface = skin.aux; }`,
  }),
).report;
assert.equal(wedgeSnout.passed, false);
assert.equal(hasCraftFailure(wedgeSnout, 'craft.primitiveAppropriateness'), true);

// 4. Bare single cylinder on furry/feathered tail fails craft.primitiveAppropriateness!
const cylTail = compileAndAudit(
  highCraftGriffinSource({
    extraTail: `cylinder tail_stick { origin = (0u, 10u, 8u); radius = 2u; radius_top = 2u; height = 7u; sides = 8; axis = z; surface = skin.aux; }`,
  }),
).report;
assert.equal(cylTail.passed, false);
assert.equal(hasCraftFailure(cylTail, 'craft.primitiveAppropriateness'), true);

// 5. Forehead googly eyes (> 68% skull height) & winged front cross-eyes fail craft.eyePlacement!
const foreheadEyes = compileAndAudit(highCraftGriffinSource({ foreheadEyes: true })).report;
assert.equal(foreheadEyes.passed, false);
assert.equal(hasCraftFailure(foreheadEyes, 'craft.eyePlacement'), true);

const crossEyes = compileAndAudit(highCraftGriffinSource({ frontCrossEyes: true })).report;
assert.equal(crossEyes.passed, false);
assert.equal(hasCraftFailure(crossEyes, 'craft.eyePlacement'), true);

// 6. Flat horizontal T-pose stub wings fail craft.wingedProportions!
const flatWings = compileAndAudit(
  highCraftGriffinSource({ flatWings: true, stripLayers: true }),
).report;
assert.equal(flatWings.passed, false);
assert.equal(hasCraftFailure(flatWings, 'craft.wingedProportions'), true);

// 7. Amputated hind legs on winged quadruped fail craft.limbCoherence!
const twoLegGriffin = compileAndAudit(highCraftGriffinSource({ omitHindLegs: true })).report;
assert.equal(twoLegGriffin.passed, false);
assert.equal(hasCraftFailure(twoLegGriffin, 'craft.limbCoherence'), true);

// 8. 1-segment stick leg fails craft.limbCoherence!
const stickLeg = compileAndAudit(
  highCraftGriffinSource({
    extraLeg: `cube leg_fl_only { origin = (-4u, 0u, -6u); size = (3u, 9u, 3u); surface = skin.aux; }`,
  }),
).report;
assert.equal(stickLeg.passed, false);
assert.equal(hasCraftFailure(stickLeg, 'craft.limbCoherence'), true);

// 9. Metallic charcoal crush (L < 0.42) & large matte white clip (L > 0.94) fail craft.pbrHeadroom!
const darkMetal = compileAndAudit(highCraftGriffinSource({ darkMetal: true })).report;
assert.equal(darkMetal.passed, false);
assert.equal(hasCraftFailure(darkMetal, 'craft.pbrHeadroom'), true);

const whiteClip = compileAndAudit(highCraftGriffinSource({ clippedWhite: true })).report;
assert.equal(whiteClip.passed, false);
assert.equal(hasCraftFailure(whiteClip, 'craft.pbrHeadroom'), true);

console.log(`craftFloor tests ok (hero=${hero.score})`);
