import assert from 'node:assert/strict';
import {
  compileDirectoryWorkspace,
  encodeCanonicalPng,
  exportProductionProjectResolved,
  expressionSlotPlacement,
  openAssetProject,
  rasterizeTexture,
  type PlaneNode,
} from '../../src';

const validator = require('gltf-validator') as {
  validateBytes: (bytes: Uint8Array) => Promise<{
    issues: { numErrors: number; messages: unknown[] };
  }>;
};

const wsCfg = JSON.stringify({
  format: 'ashfox-workspace',
  version: 2,
  name: 'expr-place-test',
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

const compileOne = (source: string) =>
  compileDirectoryWorkspace(wsCfg, [{ path: 'assets/models/main.ashfox', source }]);

const makeModelSource = (slotBlock: string, forward = 'north'): string => `ashfox 1
model main {
  rig contract R {
    handedness = right;
    frame { x = (1, 0, 0); y = (0, 1, 0); z = (0, 0, 1); }
    joint root { parent = none; role = root; frame { x = (1, 0, 0); y = (0, 1, 0); z = (0, 0, 1); } channels = rotation; mirror = none; }
    joint head { parent = root; role = head; frame { x = (1, 0, 0); y = (0, 1, 0); z = (0, 0, 1); } channels = rotation; mirror = none; }
  }
  skeleton S implements R {
    bind root { parent_origin = (0u, 0u, 0u); frame { x = (1, 0, 0); y = (0, 1, 0); z = (0, 0, 1); } }
    bind head { parent_origin = (0u, 10u, 0u); frame { x = (1, 0, 0); y = (0, 1, 0); z = (0, 0, 1); } }
  }
  surface contract Skin {
    chart skull box { coverage = opaque; }
    chart eye_n flat { coverage = opaque; }
    chart eye_b flat { coverage = opaque; }
    chart eye_s flat { coverage = opaque; }
    material = cutout;
  }
  surface coat: Skin {
    material = cutout;
    texture tex {
      background = bg; background_alpha = 0;
      palette { bg = #000000; ivory = (#9b9789, #d9d4c2, #f8f2e2); iris = (#1d6c78, #30a0b0, #6bd2e0); shut = (#3a3128, #55483a, #7d6d5c); fierce = (#aa2a10, #ff5522, #ff9966); }
      chart skull box { fill = ivory; }
      chart eye_n flat { fill = iris; }
      chart eye_b flat { fill = shut; }
      chart eye_s flat { fill = fierce; }
    }
  }
  component Body {
    requires rig skeleton: R;
    requires surface skin: Skin;
    bind bone root to skeleton.root;
    bind bone head to skeleton.head;
    geometry {
      bone root {
        bone head {
          cube skull { origin = (-4u, 10u, -3.5u); size = (8u, 7u, 7u); surface = skin.skull; }
          ${slotBlock}
        }
      }
    }
  }
  motion idle for R {
    duration = 2.0s; fps = 24; loop = loop; rest_relative = true;
    track head.rotation { key 0s = (0deg, 0deg, 0deg) linear; key 1s = (0deg, 8deg, 0deg) linear; key 2s = (0deg, 0deg, 0deg) linear; }
    expression face { at 0s = neutral; at 1.0s..1.2s = blink; at 1.4s..1.8s = screech; }
  }
  settings { density = 16; forward = ${forward}; profile = creature; }
  skeleton = S;
  motions = [idle];
  use Body as b { skeleton = R; skin = coat; }
}`;

async function main() {
  // 1. Default / explicit front placement keeps exact single-plane behavior.
  const frontRes = compileOne(
    makeModelSource(`expression_slot face {
      placement = front;
      origin = (3u, 12u, -3.5u); size = (6u, 3u); u_axis = (-1u, 0u, 0u); v_axis = (0u, 1u, 0u);
      neutral = skin.eye_n; blink = skin.eye_b; screech = skin.eye_s;
    }`),
  );
  assert.equal(frontRes.ok, true, frontRes.ok ? '' : JSON.stringify(frontRes.diagnostics));
  if (!frontRes.ok) return;
  const frontProd = frontRes.products[0]!;
  assert.equal(frontProd.kind, 'model');
  const frontNeutral = frontProd.model.scene.nodes['b/root/head/face/neutral'] as PlaneNode;
  assert.equal(frontNeutral.kind, 'plane');
  assert.equal(expressionSlotPlacement(frontNeutral), 'front');
  assert.deepEqual(frontNeutral.basis?.normal, [0, 0, -1]);

  // 2. lateral_pair without explicit origin auto-places onto -X/+X skull sides with outward normals & clean UVs.
  const latAuto = compileOne(
    makeModelSource(`expression_slot face {
      placement = lateral_pair;
      size = (4u, 3u);
      neutral = skin.eye_n; blink = skin.eye_b; screech = skin.eye_s;
    }`),
  );
  assert.equal(latAuto.ok, true, latAuto.ok ? '' : JSON.stringify(latAuto.diagnostics));
  if (!latAuto.ok) return;
  const latModel = (
    latAuto.products[0] as Extract<(typeof latAuto.products)[number], { kind: 'model' }>
  ).model;
  const leftN = latModel.scene.nodes['b/root/head/face/neutral/left'] as PlaneNode;
  const rightN = latModel.scene.nodes['b/root/head/face/neutral/right'] as PlaneNode;
  const leftB = latModel.scene.nodes['b/root/head/face/blink/left'] as PlaneNode;
  const rightB = latModel.scene.nodes['b/root/head/face/blink/right'] as PlaneNode;
  assert.ok(leftN?.kind === 'plane' && rightN?.kind === 'plane');
  assert.ok(leftB?.kind === 'plane' && rightB?.kind === 'plane');
  assert.equal(expressionSlotPlacement(leftN), 'lateral_pair');
  assert.equal(expressionSlotPlacement(rightN), 'lateral_pair');
  assert.deepEqual(leftN.basis?.normal, [-1, 0, 0]);
  assert.deepEqual(leftN.basis?.uAxis, [0, 0, 1]);
  assert.deepEqual(leftN.basis?.vAxis, [0, 1, 0]);
  assert.deepEqual(rightN.basis?.normal, [1, 0, 0]);
  assert.deepEqual(rightN.basis?.uAxis, [0, 0, -1]);
  assert.deepEqual(rightN.basis?.vAxis, [0, 1, 0]);
  assert.ok(Math.abs(leftN.transform.position[0] - -4.02) < 1e-4);
  assert.ok(Math.abs(rightN.transform.position[0] - 4.02) < 1e-4);
  // Centered vertically at 50% of skull height (10..17 -> center 13.5, bottom 12.0).
  assert.ok(Math.abs(leftN.transform.position[1] - 12.0) < 1e-4);
  assert.deepEqual(leftN.transform.scale, [1, 1, 1]);
  assert.deepEqual(rightN.transform.scale, [1, 1, 1]);
  assert.deepEqual(leftB.transform.scale, [0, 0, 0]);
  assert.deepEqual(rightB.transform.scale, [0, 0, 0]);

  // Both left & right variant nodes get animated STEP scale channels in idle clip!
  const idleClip = Object.values(latModel.animations)[0]!;
  const animTargets = new Set(Object.values(idleClip.channels).map((c) => c.targetNodeId));
  assert.ok(animTargets.has('b/root/head/face/neutral/left'));
  assert.ok(animTargets.has('b/root/head/face/neutral/right'));
  assert.ok(animTargets.has('b/root/head/face/blink/left'));
  assert.ok(animTargets.has('b/root/head/face/blink/right'));
  assert.ok(animTargets.has('b/root/head/face/screech/left'));
  assert.ok(animTargets.has('b/root/head/face/screech/right'));

  // 3. lateral_pair with explicit origin mirrors symmetrically around head center.
  const latExplicit = compileOne(
    makeModelSource(`expression_slot face {
      placement = lateral_pair;
      origin = (-4u, 12.5u, -2.5u);
      size = (4u, 3u);
      neutral = skin.eye_n; blink = skin.eye_b; screech = skin.eye_s;
    }`),
  );
  assert.equal(latExplicit.ok, true, latExplicit.ok ? '' : JSON.stringify(latExplicit.diagnostics));
  if (!latExplicit.ok) return;
  const latExpModel = (
    latExplicit.products[0] as Extract<(typeof latExplicit.products)[number], { kind: 'model' }>
  ).model;
  const expL = latExpModel.scene.nodes['b/root/head/face/neutral/left'] as PlaneNode;
  const expR = latExpModel.scene.nodes['b/root/head/face/neutral/right'] as PlaneNode;
  assert.ok(Math.abs(expL.transform.position[0] - -4.02) < 1e-4);
  assert.ok(Math.abs(expR.transform.position[0] - 4.02) < 1e-4);
  assert.ok(Math.abs(expL.transform.position[2] - -2.5) < 1e-4);
  assert.ok(Math.abs(expR.transform.position[2] - 1.5) < 1e-4);

  // 4. corner_wrap places angled front-lateral quads with outward 45deg normals and valid glTF export.
  const cornerRes = compileOne(
    makeModelSource(`expression_slot face {
      placement = corner_wrap;
      size = (3u, 3u);
      neutral = skin.eye_n; blink = skin.eye_b; screech = skin.eye_s;
    }`),
  );
  assert.equal(cornerRes.ok, true, cornerRes.ok ? '' : JSON.stringify(cornerRes.diagnostics));
  if (!cornerRes.ok) return;
  const cornerProd = cornerRes.products[0] as Extract<
    (typeof cornerRes.products)[number],
    { kind: 'model' }
  >;
  const cL = cornerProd.model.scene.nodes['b/root/head/face/neutral/left'] as PlaneNode;
  const cR = cornerProd.model.scene.nodes['b/root/head/face/neutral/right'] as PlaneNode;
  assert.equal(expressionSlotPlacement(cL), 'corner_wrap');
  assert.equal(expressionSlotPlacement(cR), 'corner_wrap');
  assert.ok(Math.abs(cL.transform.rotation[1] + 135) < 1e-4);
  assert.ok(Math.abs(cR.transform.rotation[1] - 135) < 1e-4);

  // Validate glTF export for both lateral_pair and corner_wrap.
  for (const prod of [
    latAuto.products[0] as Extract<(typeof latAuto.products)[number], { kind: 'model' }>,
    cornerProd,
  ]) {
    const opened = openAssetProject({
      workspace: prod.workspace,
      entry: prod.entry,
      identity: { id: 'main', revision: 'r1', createdAt: '2026-01-01T00:00:00.000Z' },
    });
    assert.equal(opened.ok, true, opened.ok ? '' : JSON.stringify(opened));
    if (!opened.ok) return;
    const doc = opened.project.document;
    const textures = new Map(Object.values(doc.textures).map((t) => [t.source.key, t]));
    const bundle = await exportProductionProjectResolved(
      opened.project,
      { target: 'glb', modelPath: 'main' },
      {
        resolveBlob: async (ref) => {
          const t = textures.get(ref.key);
          return t
            ? { bytes: encodeCanonicalPng(rasterizeTexture(doc, t)), contentType: 'image/png' }
            : null;
        },
      },
    );
    const glb = bundle.files.find((f) => f.path.endsWith('.glb'));
    assert.ok(glb && glb.kind === 'binary');
    const rep = await validator.validateBytes(glb.data);
    assert.equal(rep.issues.numErrors, 0, JSON.stringify(rep.issues.messages));
  }

  // 5. Transformed skull (position + inflate + rotation) updates auto-placed lateral_pair bounds.
  const transformedSource = makeModelSource(`expression_slot face {
      placement = lateral_pair;
      size = (4u, 3u);
      neutral = skin.eye_n; blink = skin.eye_b; screech = skin.eye_s;
    }`).replace(
    'cube skull { origin = (-4u, 10u, -3.5u); size = (8u, 7u, 7u); surface = skin.skull; }',
    'cube skull { origin = (-4u, 10u, -3.5u); size = (8u, 7u, 7u); position = (2u, 1u, 0u); inflate = 0.5u; pivot = (0u, 13.5u, 0u); rotation = (0deg, 90deg, 0deg); surface = skin.skull; }',
  );
  const transformedRes = compileOne(transformedSource);
  assert.equal(
    transformedRes.ok,
    true,
    transformedRes.ok ? '' : JSON.stringify(transformedRes.diagnostics),
  );
  if (transformedRes.ok) {
    const trModel = (
      transformedRes.products[0] as Extract<
        (typeof transformedRes.products)[number],
        { kind: 'model' }
      >
    ).model;
    const trL = trModel.scene.nodes['b/root/head/face/neutral/left'] as PlaneNode;
    const trR = trModel.scene.nodes['b/root/head/face/neutral/right'] as PlaneNode;
    // Rotated 90deg Y swaps 8u X and 7u Z -> half X becomes 3.5 + 0.5 inflate = 4.0, shifted +2u X => [-2, 6].
    assert.ok(
      Math.abs(trL.transform.position[0] - -2.02) < 1e-4,
      `got ${trL.transform.position[0]}`,
    );
    assert.ok(
      Math.abs(trR.transform.position[0] - 6.02) < 1e-4,
      `got ${trR.transform.position[0]}`,
    );
    // Y shifted +1u and inflated +-0.5u -> [10.5..18.5], center 14.5, bottom 14.5 - 1.5 = 13.0.
    assert.ok(
      Math.abs(trL.transform.position[1] - 13.0) < 1e-4,
      `got ${trL.transform.position[1]}`,
    );
  }

  // 6. Quoted or unknown placement enum fails closed with diagnostic.
  const quotedRes = compileOne(
    makeModelSource(`expression_slot face {
      placement = "lateral_pair";
      size = (4u, 3u);
      neutral = skin.eye_n;
    }`),
  );
  assert.equal(quotedRes.ok, false);
  const badEnumRes = compileOne(
    makeModelSource(`expression_slot face {
      placement = lateral;
      size = (4u, 3u);
      neutral = skin.eye_n;
    }`),
  );
  assert.equal(badEnumRes.ok, false);

  console.log('expression_slot placement (front | lateral_pair | corner_wrap) tests ok');
}

const reg = globalThis as { __ashfoxEngineTestPromises?: Promise<unknown>[] };
reg.__ashfoxEngineTestPromises?.push(main());
