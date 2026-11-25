import assert from 'node:assert/strict';

import { compileDirectoryWorkspace, rasterizeCanonicalTexture } from '../../../src';

const workspaceConfig = (): string =>
  JSON.stringify({
    format: 'ashfox-workspace',
    version: 2,
    name: 'demo',
    packages: [
      {
        name: 'demo',
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

const compileSingle = (source: string) =>
  compileDirectoryWorkspace(workspaceConfig(), [{ path: 'pkg/main.ashfox', source }]);

const rasterBytes = (
  width: number,
  height: number,
  raster: {
    readonly background: string;
    readonly backgroundAlpha: 0 | 255;
    readonly canvasDetails: Parameters<typeof rasterizeCanonicalTexture>[2]['canvasDetails'];
    readonly alphaMasks?: Parameters<typeof rasterizeCanonicalTexture>[2]['alphaMasks'];
  },
): Uint8Array =>
  rasterizeCanonicalTexture(width, height, {
    ...raster,
    alphaMasks: raster.alphaMasks ?? [],
  }).rgba.copy();

const pixelAt = (rgba: Uint8Array, width: number, x: number, y: number): string => {
  const offset = (y * width + x) * 4;
  return (
    '#' +
    [rgba[offset]!, rgba[offset + 1]!, rgba[offset + 2]!]
      .map((channel) => channel.toString(16).padStart(2, '0'))
      .join('')
  );
};

const lumAt = (rgba: Uint8Array, width: number, x: number, y: number): number => {
  const offset = (y * width + x) * 4;
  return 0.2126 * rgba[offset]! + 0.7152 * rgba[offset + 1]! + 0.0722 * rgba[offset + 2]!;
};

const painterlySource = (opts?: {
  readonly ao?: boolean;
  readonly stampProtect?: boolean;
}): string => `ashfox-model 1
asset main {
  rig contract R {
    handedness = right;
    frame { x = (1, 0, 0); y = (0, 1, 0); z = (0, 0, 1); }
    joint root {
      parent = none; role = root;
      frame { x = (1, 0, 0); y = (0, 1, 0); z = (0, 0, 1); }
      channels = rotation; mirror = none;
    }
  }
  skeleton S implements R {
    bind root { parent-origin = (0u, 0u, 0u); frame { x = (1, 0, 0); y = (0, 1, 0); z = (0, 0, 1); } }
  }
  surface contract Skin {
    chart bare box { coverage = opaque; }
    chart styled box { coverage = opaque; }
    chart armor box { coverage = opaque; }
    material = opaque;
  }
  surface wolf: Skin {
    material = opaque;
    texture fur {
      background = bg; background-alpha = 255;
      palette {
        bg = #101010;
        coat = (#402010, #804020, #c06030);
        cream = (#705030, #b09060, #ffe0a0);
        trim = (#202020, #505050, #909090);
        stripe_c = (#303060, #5050a0, #8080e0);
        eye = #112233;
        patch = (#601010, #a02020, #e04040);
      }
      stamp dot { pixels = "pp/pp"; p = patch; }
      chart bare box {
        fill = coat;
      }
      chart styled box {
        fill = coat;
        grain = none;
        pattern gradient { from = cream; to = coat; axis = y; space = local; soft = 0.0ratio; }
        pattern border { paint = trim; width = 1px; edges = bottom; }
        face west { mirror = east; }
        face east {
          fill = stripe_c;
          grain = none;
          stamp dot { at = (0px, 0px); protect = ${opts?.stampProtect === false ? 'false' : 'true'}; }
        }
        ${opts?.ao ? 'pattern ao { strength = 0.9ratio; radius = 2u; }' : ''}
      }
      chart armor box {
        fill = trim;
        grain = soft;
        pattern stripe { paint = cream; axis = u; period = 3px; width = 1px; phase = 0; }
      }
      grain clustered { seed = 99; }
      tone painterly;
    }
  }
  component Body {
    requires rig skeleton: R;
    requires surface skin: Skin;
    bind bone root to skeleton.root;
    geometry {
      bone root {
        cube bare_cube { origin = (-20u, 0u, -2u); size = (6u, 6u, 6u); surface = skin.bare; }
        cube styled_cube { origin = (-3u, 0u, -3u); size = (6u, 6u, 6u); surface = skin.styled; }
        cube occluder { origin = (3u, 0u, -3u); size = (4u, 6u, 6u); surface = skin.armor; }
      }
    }
  }
  export asset main {
    settings { density = 16; forward = north; }
    skeleton = S;
    use Body as body {
      bind skeleton = R;
      bind skin = wolf;
    };
  }
}`;

const withoutAo = compileSingle(painterlySource({ ao: false, stampProtect: true }));
const withAo = compileSingle(painterlySource({ ao: true, stampProtect: true }));
assert.equal(withoutAo.ok, true, withoutAo.ok ? '' : JSON.stringify(withoutAo.diagnostics));
assert.equal(withAo.ok, true, withAo.ok ? '' : JSON.stringify(withAo.diagnostics));

if (withAo.ok && withoutAo.ok) {
  const prodAo = withAo.products[0]!;
  const prodNoAo = withoutAo.products[0]!;
  assert.equal(prodAo.kind, 'model');
  assert.equal(prodNoAo.kind, 'model');
  if (prodAo.kind === 'model' && prodNoAo.kind === 'model') {
    const texAo = Object.values(prodAo.model.textures)[0]!;
    const texNoAo = Object.values(prodNoAo.model.textures)[0]!;
    const rgbaAo = rasterBytes(texAo.width, texAo.height, texAo.raster!);
    const rgbaNoAo = rasterBytes(texNoAo.width, texNoAo.height, texNoAo.raster!);

    // Telemetry separates bare grain-only chart (0 authored deltas) vs styled chart (>0 deltas & AO texels).
    const telemetry = prodAo.telemetry?.textures[texAo.id];
    assert.ok(telemetry);
    assert.equal(telemetry.tone, 'painterly');
    const bareTel = telemetry.charts.find((c) => c.id === 'bare')!;
    const styledTel = telemetry.charts.find((c) => c.id === 'styled')!;
    assert.equal(bareTel.authoredDeltaTexels, 0);
    assert.equal(bareTel.regionGrainModes.north, 'clustered');
    assert.ok(styledTel.authoredDeltaTexels > 0);
    assert.ok(styledTel.aoTexels > 0);
    assert.equal(styledTel.regionGrainModes.north, 'none');

    // Verify face west mirrored east (including top-right mirror of stripe_c + protected dot) & stamp stayed crisp (#a02020).
    const eastNode = prodAo.model.scene.nodes['body/root/styled_cube']!;
    assert.equal(eastNode.kind, 'cube');
    if (eastNode.kind === 'cube') {
      const eastUv = eastNode.faces.east.uv!;
      const westUv = eastNode.faces.west.uv!;
      assert.equal(pixelAt(rgbaNoAo, texNoAo.width, eastUv[0], eastUv[1]), '#a02020');
      assert.equal(pixelAt(rgbaNoAo, texNoAo.width, westUv[2] - 1, westUv[1]), '#a02020');

      // North face top row has painterly highlight > middle row, and AO darkens contact face (east of styled_cube vs exposed west).
      const northUv = eastNode.faces.north.uv!;
      assert.ok(
        lumAt(rgbaNoAo, texNoAo.width, northUv[0] + 2, northUv[1]) >
          lumAt(rgbaNoAo, texNoAo.width, northUv[0] + 2, northUv[1] + 2),
      );

      // On east face (touching occluder at x=+3), a non-protected row (y+3) is darker with AO than without AO!
      assert.ok(
        lumAt(rgbaAo, texAo.width, eastUv[0] + 2, eastUv[1] + 3) <
          lumAt(rgbaNoAo, texNoAo.width, eastUv[0] + 2, eastUv[1] + 3),
      );
    }
  }
}

// Verify stamp protect = false allows painterly tone to shade stamped ramp texels.
const unprotected = compileSingle(painterlySource({ ao: false, stampProtect: false }));
assert.equal(unprotected.ok, true);
if (unprotected.ok && unprotected.products[0]?.kind === 'model') {
  const tex = Object.values(unprotected.products[0].model.textures)[0]!;
  const rgba = rasterBytes(tex.width, tex.height, tex.raster!);
  const node = unprotected.products[0].model.scene.nodes['body/root/styled_cube']!;
  if (node.kind === 'cube') {
    const eastUv = node.faces.east.uv!;
    // Top row at (0,0) gets painterly upper step tone (#c03030) instead of flat midtone (#a02020).
    assert.equal(pixelAt(rgba, tex.width, eastUv[0], eastUv[1]), '#c03030');
  }
}

// Verify ancestor bone rotation moves occluder away from styled_cube so AO drops to 0.
const boneRotated = compileSingle(
  painterlySource({ ao: true, stampProtect: true }).replace(
    'cube occluder { origin = (3u, 0u, -3u); size = (4u, 6u, 6u); surface = skin.armor; }',
    'bone swung { pivot = (0u, 0u, -10u); rotation = (0deg, 90deg, 0deg); cube occluder { origin = (3u, 0u, -3u); size = (4u, 6u, 6u); surface = skin.armor; } }',
  ),
);
assert.equal(boneRotated.ok, true, boneRotated.ok ? '' : JSON.stringify(boneRotated.diagnostics));
if (boneRotated.ok && boneRotated.products[0]?.kind === 'model') {
  const tex = Object.values(boneRotated.products[0].model.textures)[0]!;
  const styledTel = boneRotated.products[0].telemetry?.textures[tex.id]?.charts.find(
    (c) => c.id === 'styled',
  );
  assert.equal(styledTel?.aoTexels, 0);
}

// Verify non-default-axis plane maps texels via its u-axis/v-axis/normal for model gradient and AO.
const planeBasisSource = `ashfox-model 1
asset main {
  rig contract R {
    handedness = right;
    frame { x = (1, 0, 0); y = (0, 1, 0); z = (0, 0, 1); }
    joint root { parent = none; role = root; frame { x = (1, 0, 0); y = (0, 1, 0); z = (0, 0, 1); } channels = rotation; mirror = none; }
  }
  skeleton S implements R { bind root { parent-origin = (0u, 0u, 0u); frame { x = (1, 0, 0); y = (0, 1, 0); z = (0, 0, 1); } } }
  surface contract Skin {
    chart blk box { coverage = opaque; }
    chart fin flat { coverage = opaque; }
    material = opaque;
  }
  surface surf: Skin {
    material = opaque;
    texture tex {
      background = bg; background-alpha = 255;
      palette {
        bg = #101010;
        coat = (#402010, #804020, #c06030);
        cream = (#705030, #b09060, #ffe0a0);
      }
      chart blk box { fill = coat; }
      chart fin flat {
        fill = coat;
        pattern gradient { from = cream; to = coat; axis = z; space = model; soft = 0.0ratio; }
        pattern ao { strength = 0.9ratio; radius = 2u; }
      }
    }
  }
  component Body {
    requires rig skeleton: R;
    requires surface skin: Skin;
    bind bone root to skeleton.root;
    geometry {
      bone root {
        cube blk { origin = (6u, 0u, 0u); size = (4u, 4u, 4u); surface = skin.blk; }
        plane fin { origin = (10u, 0u, 0u); size = (4u, 4u); u-axis = (0u, 0u, 1u); v-axis = (0u, 1u, 0u); surface = skin.fin; }
      }
    }
  }
  export asset main {
    settings { density = 16; forward = north; }
    skeleton = S;
    use Body as body { bind skeleton = R; bind skin = surf; };
  }
}`;
const planeRes = compileSingle(planeBasisSource);
assert.equal(planeRes.ok, true, planeRes.ok ? '' : JSON.stringify(planeRes.diagnostics));
if (planeRes.ok && planeRes.products[0]?.kind === 'model') {
  const tex = Object.values(planeRes.products[0].model.textures)[0]!;
  const finTel = planeRes.products[0].telemetry?.textures[tex.id]?.charts.find(
    (c) => c.id === 'fin',
  )!;
  assert.ok(finTel.aoTexels > 0, 'touching cube must cast AO onto u-axis=Z plane');
  assert.ok(finTel.distinctRoles >= 2, 'model-Z gradient must paint both cream and coat roles');
  const finNode = planeRes.products[0].model.scene.nodes['body/root/fin']!;
  assert.equal(finNode.kind, 'plane');
  if (finNode.kind === 'plane') {
    const rgba = rasterBytes(tex.width, tex.height, tex.raster!);
    const uv = finNode.faces.front.uv!;
    assert.notEqual(
      pixelAt(rgba, tex.width, uv[0], uv[1]),
      pixelAt(rgba, tex.width, uv[2] - 1, uv[1]),
    );
  }
}

// Verify texture density and render-mode contracts & emissive compilation.
const withHeader = (header: string): string =>
  planeBasisSource.replace('texture tex {', `texture tex {\n      ${header}`);

const badDensity = compileSingle(withHeader('density = 3;'));
assert.equal(badDensity.ok, false);
assert.ok(
  badDensity.diagnostics.some(
    (d) =>
      d.code === 'asset.texture.invalid-density' ||
      d.message.includes('asset.texture.invalid-density'),
  ),
);

const badRenderMode = compileSingle(withHeader('render-mode = neon;'));
assert.equal(badRenderMode.ok, false);
assert.ok(
  badRenderMode.diagnostics.some(
    (d) =>
      d.code === 'asset.texture.invalid-render-mode' ||
      d.message.includes('asset.texture.invalid-render-mode'),
  ),
);

const emissiveTex = compileSingle(withHeader('density = 2; render-mode = emissive;'));
assert.equal(emissiveTex.ok, true, emissiveTex.ok ? '' : JSON.stringify(emissiveTex.diagnostics));
if (emissiveTex.ok && emissiveTex.products[0]?.kind === 'model') {
  const tex = Object.values(emissiveTex.products[0].model.textures)[0]!;
  assert.equal(tex.renderMode, 'emissive');
}

// Verify mirror = true bakes mirrored face UVs when density > 1 disables boxUv.
const unmirroredDense = compileSingle(withHeader('density = 2;'));
const mirroredDense = compileSingle(
  withHeader('density = 2;').replace(
    'cube blk { origin = (6u, 0u, 0u); size = (4u, 4u, 4u); surface = skin.blk; }',
    'cube blk { origin = (6u, 0u, 0u); size = (4u, 4u, 4u); mirror = true; surface = skin.blk; }',
  ),
);
assert.equal(unmirroredDense.ok, true);
assert.equal(mirroredDense.ok, true);
if (
  unmirroredDense.ok &&
  mirroredDense.ok &&
  unmirroredDense.products[0]?.kind === 'model' &&
  mirroredDense.products[0]?.kind === 'model'
) {
  const rawNode = unmirroredDense.products[0].model.scene.nodes['body/root/blk']!;
  const mirNode = mirroredDense.products[0].model.scene.nodes['body/root/blk']!;
  assert.equal(rawNode.kind, 'cube');
  assert.equal(mirNode.kind, 'cube');
  if (rawNode.kind === 'cube' && mirNode.kind === 'cube') {
    assert.equal(mirNode.boxUv, false);
    assert.equal(mirNode.mirror, false);
    assert.ok(mirNode.faces.north.uv![0] > mirNode.faces.north.uv![2]);
    assert.deepEqual(mirNode.faces.east.uv, [
      rawNode.faces.west.uv![2],
      rawNode.faces.west.uv![1],
      rawNode.faces.west.uv![0],
      rawNode.faces.west.uv![3],
    ]);
    assert.deepEqual(mirNode.faces.west.uv, [
      rawNode.faces.east.uv![2],
      rawNode.faces.east.uv![1],
      rawNode.faces.east.uv![0],
      rawNode.faces.east.uv![3],
    ]);
  }
}
