import assert from 'node:assert/strict';

import { canonicalJsonString, compileDirectoryWorkspace, evaluateAssetQuality } from '../../src';

const workspaceConfig = (): string =>
  JSON.stringify({
    format: 'ashfox-workspace',
    version: 2,
    name: 'audit-adv',
    packages: [
      {
        name: 'audit-adv',
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

const compile = (source: string) => {
  const res = compileDirectoryWorkspace(workspaceConfig(), [
    { path: 'assets/models/main.ashfox', source },
  ]);
  assert.equal(res.ok, true, res.ok ? '' : JSON.stringify(res.diagnostics));
  const product = res.products[0];
  assert.equal(product?.kind, 'model');
  return product;
};

const gateFailed = (source: string, gateId: string): boolean => {
  const product = compile(source);
  const report = evaluateAssetQuality({ model: product.model, telemetry: product.telemetry });
  assert.equal(report.passed, false);
  const gate = report.hardGates.find((g) => g.id === gateId);
  assert.ok(gate, `missing gate ${gateId}`);
  return !gate.passed;
};

const baseSkeleton = `
  rig contract R {
    handedness = right;
    frame { x = (1, 0, 0); y = (0, 1, 0); z = (0, 0, 1); }
    joint root { parent = none; role = root; frame { x = (1, 0, 0); y = (0, 1, 0); z = (0, 0, 1); } channels = rotation; mirror = none; }
  }
  skeleton S implements R {
    bind root { parent_origin = (0u, 0u, 0u); frame { x = (1, 0, 0); y = (0, 1, 0); z = (0, 0, 1); } }
  }
`;

// 1. Grain-only illusion fails pre_grain_authored_floor
const grainOnly = `ashfox 1
model main {
  ${baseSkeleton}
  surface contract Skin { chart a box { coverage = opaque; } chart b box { coverage = opaque; } chart c box { coverage = opaque; } material = opaque; }
  surface s: Skin {
    material = opaque;
    texture t {
      background = x; background_alpha = 255;
      palette { x = #202020; coat = (#503020, #885030, #c87848); trim = (#203050, #406088, #7098c8); foot = (#303030, #606060, #909090); }
      chart a box { fill = coat; }
      chart b box { fill = trim; }
      chart c box { fill = foot; }
      grain clustered { seed = 1; }
      tone painterly;
    }
  }
  component C {
    requires rig skeleton: R;
    requires surface skin: Skin;
    bind bone root to skeleton.root;
    geometry {
      bone root {
        cube p0 { origin = (-4u, 0u, -4u); size = (8u, 6u, 8u); surface = skin.a; }
        cube p1 { origin = (-2u, 6u, -2u); size = (4u, 4u, 4u); surface = skin.b; }
        cube p2 { origin = (-3u, 0u, 4u); size = (6u, 4u, 4u); surface = skin.c; }
      }
    }
  }
  settings { density = 16; forward = north; profile = prop; } skeleton = S; use C as c { skeleton = R; skin = s; }
}`;
assert.equal(gateFailed(grainOnly, 'pre_grain_authored_floor'), true);

// 2. High-frequency 1px checkerboard stamp spam fails anti_noise_coherence
const confetti = `ashfox 1
model main {
  ${baseSkeleton}
  surface contract Skin { chart body box { coverage = opaque; } material = opaque; }
  surface s: Skin {
    material = opaque;
    texture t {
      background = bg; background_alpha = 255;
      palette { bg = #101010; w = #f4f4f4; k = #121212; kramp = (#0e0e0e, #121212, #1c1c1c); }
      stamp chk {
        pixels = "wkwkwkwk/kwkwkwkw/wkwkwkwk/kwkwkwkw/wkwkwkwk/kwkwkwkw/wkwkwkwk/kwkwkwkw";
        w = w; k = k;
      }
      chart body box {
        fill = kramp;
        grain = none;
        face north { stamp chk { at = (0px, 0px); } }
        face south { stamp chk { at = (0px, 0px); } }
        face east { stamp chk { at = (0px, 0px); } }
        face west { stamp chk { at = (0px, 0px); } }
        face up { stamp chk { at = (0px, 0px); } }
        face down { stamp chk { at = (0px, 0px); } }
      }
    }
  }
  component C {
    requires rig skeleton: R;
    requires surface skin: Skin;
    bind bone root to skeleton.root;
    geometry { bone root { cube c0 { origin = (-4u, 0u, -4u); size = (8u, 8u, 8u); surface = skin.body; } } }
  }
  settings { density = 16; forward = north; profile = block; } skeleton = S; use C as c { skeleton = R; skin = s; }
}`;
assert.equal(gateFailed(confetti, 'anti_noise_coherence'), true);

// 3. Buried inner cube fails no_buried_hidden_cubes
const buried = `ashfox 1
model main {
  ${baseSkeleton}
  surface contract Skin { chart a box { coverage = opaque; } chart b box { coverage = opaque; } material = opaque; }
  surface s: Skin {
    material = opaque;
    texture t {
      background = bg; background_alpha = 255;
      palette { bg = #101010; dark = (#202020, #383838, #505050); light = (#a0a0a0, #d0d0d0, #f0f0f0); }
      chart a box { fill = dark; grain = none; pattern border { paint = light; width = 1px; edges = all; } }
      chart b box { fill = dark; grain = none; pattern border { paint = light; width = 1px; edges = all; } }
    }
  }
  component C {
    requires rig skeleton: R;
    requires surface skin: Skin;
    bind bone root to skeleton.root;
    geometry {
      bone root {
        cube outer { origin = (-5u, 0u, -5u); size = (10u, 10u, 10u); surface = skin.a; }
        cube secret { origin = (-2u, 2u, -2u); size = (4u, 4u, 4u); surface = skin.b; }
      }
    }
  }
  settings { density = 16; forward = north; profile = block; } skeleton = S; use C as c { skeleton = R; skin = s; }
}`;
assert.equal(gateFailed(buried, 'no_buried_hidden_cubes'), true);

// 4. Floating detached part fails no_disconnected_floating_parts
const floatingPart = buried.replace(
  'cube secret { origin = (-2u, 2u, -2u); size = (4u, 4u, 4u); surface = skin.b; }',
  'cube detached { origin = (-2u, 16u, -2u); size = (4u, 4u, 4u); surface = skin.b; }',
);
assert.equal(gateFailed(floatingPart, 'no_disconnected_floating_parts'), true);

// 5. Elevated model fails ground_contact
const ungrounded = buried
  .replace('origin = (-5u, 0u, -5u)', 'origin = (-5u, 6u, -5u)')
  .replace('origin = (-2u, 2u, -2u)', 'origin = (-2u, 16u, -2u)');
assert.equal(gateFailed(ungrounded, 'ground_contact'), true);

// 6. Byte-stable deterministic report
const pA = compile(buried);
const pB = compile(buried);
const rA = evaluateAssetQuality({ model: pA.model, telemetry: pA.telemetry });
const rB = evaluateAssetQuality({ model: pB.model, telemetry: pB.telemetry });
assert.equal(canonicalJsonString(rA), canonicalJsonString(rB));

console.log('adversarial audit gates and deterministic scoring passed');
