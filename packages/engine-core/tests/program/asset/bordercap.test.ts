import assert from 'node:assert/strict';

import { compileDirectoryWorkspace, rasterizeCanonicalTexture } from '../../../src';

const wsConfig = JSON.stringify({
  format: 'ashfox-workspace',
  version: 2,
  name: 'border_cap_demo',
  packages: [
    {
      name: 'demo',
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

const buildSource = (contractDecls: string, chartDecls: string, cubes: string): string => `ashfox 1
model main {
  rig contract R {
    handedness = right;
    frame { x = (1, 0, 0); y = (0, 1, 0); z = (0, 0, 1); }
    joint root { parent = none; role = root; frame { x = (1, 0, 0); y = (0, 1, 0); z = (0, 0, 1); } channels = rotation; mirror = none; }
  }
  skeleton S implements R {
    bind root { parent_origin = (0u, 0u, 0u); frame { x = (1, 0, 0); y = (0, 1, 0); z = (0, 0, 1); } }
  }
  surface contract Skin {
    ${contractDecls}
    material = opaque;
  }
  surface coat: Skin {
    material = opaque;
    texture tex {
      density = 2;
      atlas = (128px, 128px);
      background = bg; background_alpha = 255;
      palette {
        bg = #101010;
        fill_c = (#203040, #304050, #405060);
        trim_c = (#c09010, #f0c020, #ffe060);
      }
      ${chartDecls}
    }
  }
  component Body {
    requires rig skeleton: R;
    requires surface skin: Skin;
    bind bone root to skeleton.root;
    geometry {
      bone root {
        ${cubes}
      }
    }
  }
  settings { density = 16; forward = north; profile = prop; }
  skeleton = S;
  use Body as body { skeleton = R; skin = coat; }
}`;

const compileTex = (contractDecls: string, chartDecls: string, cubes: string) => {
  const res = compileDirectoryWorkspace(wsConfig, [
    { path: 'assets/models/main.ashfox', source: buildSource(contractDecls, chartDecls, cubes) },
  ]);
  assert.equal(res.ok, true, res.ok ? '' : JSON.stringify(res.diagnostics));
  if (!res.ok) throw new Error('compile failed');
  const prod = res.products[0]!;
  assert.equal(prod.kind, 'model');
  if (prod.kind !== 'model') throw new Error('not a model');
  const tex = Object.values(prod.model.textures)[0]!;
  const rgba = rasterizeCanonicalTexture(tex.width, tex.height, {
    ...tex.raster!,
    alphaMasks: tex.raster!.alphaMasks ?? [],
  }).rgba.copy();
  return { prod, tex, rgba };
};

const hexAt = (rgba: Uint8Array, width: number, x: number, y: number): string => {
  const i = (y * width + x) * 4;
  return (
    '#' +
    [rgba[i]!, rgba[i + 1]!, rgba[i + 2]!].map((c) => c.toString(16).padStart(2, '0')).join('')
  );
};

const countColorInRect = (
  rgba: Uint8Array,
  texW: number,
  uv: readonly [number, number, number, number],
  hex: string,
): number => {
  let hits = 0;
  for (let y = uv[1]; y < uv[3]; y += 1) {
    for (let x = uv[0]; x < uv[2]; x += 1) {
      if (hexAt(rgba, texW, x, y) === hex) hits += 1;
    }
  }
  return hits;
};

// 1. Box charts with edges=top, bottom, sides must skip horizontal caps (up/down) unless face-scoped.
{
  const { prod, tex, rgba } = compileTex(
    `chart c_top box { coverage = opaque; }
     chart c_bot box { coverage = opaque; }
     chart c_sid box { coverage = opaque; }
     chart c_explicit box { coverage = opaque; }`,
    `chart c_top box { fill = fill_c; pattern border { paint = trim_c; width = 1px; edges = top; } }
     chart c_bot box { fill = fill_c; pattern border { paint = trim_c; width = 1px; edges = bottom; } }
     chart c_sid box { fill = fill_c; pattern border { paint = trim_c; width = 1px; edges = sides; } }
     chart c_explicit box { fill = fill_c; face up { pattern border { paint = trim_c; width = 1px; edges = top; } } }`,
    `cube b1 { origin = (-2u, 0u, -2u); size = (4u, 4u, 4u); surface = skin.c_top; }
     cube b2 { origin = (3u, 0u, -2u); size = (4u, 4u, 4u); surface = skin.c_bot; }
     cube b3 { origin = (8u, 0u, -2u); size = (4u, 4u, 4u); surface = skin.c_sid; }
     cube b4 { origin = (13u, 0u, -2u); size = (4u, 4u, 4u); surface = skin.c_explicit; }`,
  );

  for (const id of ['body/root/b1', 'body/root/b2', 'body/root/b3']) {
    const node = prod.model.scene.nodes[id]!;
    assert.equal(node.kind, 'cube');
    if (node.kind === 'cube') {
      assert.equal(countColorInRect(rgba, tex.width, node.faces.up.uv!, '#f0c020'), 0, `${id} up`);
      assert.equal(
        countColorInRect(rgba, tex.width, node.faces.down.uv!, '#f0c020'),
        0,
        `${id} down`,
      );
      assert.ok(countColorInRect(rgba, tex.width, node.faces.north.uv!, '#f0c020') > 0);
    }
  }

  const explicit = prod.model.scene.nodes['body/root/b4']!;
  assert.equal(explicit.kind, 'cube');
  if (explicit.kind === 'cube') {
    assert.ok(countColorInRect(rgba, tex.width, explicit.faces.up.uv!, '#f0c020') > 0);
    assert.equal(countColorInRect(rgba, tex.width, explicit.faces.north.uv!, '#f0c020'), 0);
  }
}

// 2. Narrow 1u (2px at density=2) faces with edges=all must not flood 100% solid border paint.
{
  const { prod, tex, rgba } = compileTex(
    `chart plate box { coverage = opaque; }`,
    `chart plate box { fill = fill_c; pattern border { paint = trim_c; width = 1px; edges = all; } }`,
    `cube plate { origin = (-2u, 0u, 0u); size = (4u, 8u, 1u); surface = skin.plate; }`,
  );
  const node = prod.model.scene.nodes['body/root/plate']!;
  assert.equal(node.kind, 'cube');
  if (node.kind === 'cube') {
    // East/West are 2x16px, Up/Down are 8x2px: interior fill texels must remain untouched.
    assert.ok(countColorInRect(rgba, tex.width, node.faces.east.uv!, '#304050') > 0);
    assert.ok(countColorInRect(rgba, tex.width, node.faces.up.uv!, '#304050') > 0);
    // North (8x16px) still receives full 4-sided border with interior fill.
    assert.ok(countColorInRect(rgba, tex.width, node.faces.north.uv!, '#f0c020') > 0);
    assert.ok(countColorInRect(rgba, tex.width, node.faces.north.uv!, '#304050') > 0);
  }
}

console.log('texture border cap and narrow face regression tests ok');
