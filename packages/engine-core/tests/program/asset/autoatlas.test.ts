import assert from 'node:assert/strict';

import { compileDirectoryWorkspace } from '../../../src';

const workspaceConfig = (entryName = 'main', path = 'main.ashfox'): string =>
  JSON.stringify({
    format: 'ashfox-workspace',
    version: 2,
    name: 'demo',
    packages: [
      {
        name: 'demo',
        root: 'assets/models',
        manifest: {
          format: 'ashfox-package',
          version: 1,
          dependencies: [],
          entries: [{ name: entryName, path }],
          modules: [],
        },
      },
    ],
    include: ['assets/**/*.ashfox'],
    ignore: [],
    build: { directory: 'dist/build' },
    exports: [],
  });

const compileSingle = (source: string) =>
  compileDirectoryWorkspace(workspaceConfig(), [{ path: 'assets/models/main.ashfox', source }]);

const autoPackedSource = (chartsOrder: 'normal' | 'reversed'): string => {
  const cA = `chart body box { coverage = opaque; }`;
  const cB = `chart badge flat { coverage = opaque; }`;
  const tA = `chart body box { fill = coat; }`;
  const tB = `chart badge flat { fill = crest; }`;
  const contractCharts = chartsOrder === 'normal' ? `${cA}\n    ${cB}` : `${cB}\n    ${cA}`;
  const textureCharts = chartsOrder === 'normal' ? `${tA}\n      ${tB}` : `${tB}\n      ${tA}`;
  return `ashfox 1
model main {
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
    bind root { parent_origin = (0u, 0u, 0u); frame { x = (1, 0, 0); y = (0, 1, 0); z = (0, 0, 1); } }
  }
  surface contract Skin {
    ${contractCharts}
    material = opaque;
  }
  surface coat: Skin {
    material = opaque;
    texture main_tex {
      background = bg; background_alpha = 255;
      palette {
        bg = #101010;
        coat = (#402010, #804020, #c06030);
        crest = (#906010, #ffd060, #fff0a0);
      }
      ${textureCharts}
      grain clustered { seed = 11; }
      tone voxel;
    }
  }
  component Body {
    requires rig skeleton: R;
    requires surface skin: Skin;
    bind bone root to skeleton.root;
    geometry {
      bone root {
        cube torso { origin = (-2u, 0u, -2u); size = (4u, 6u, 4u); surface = skin.body; }
        plane crest { origin = (-1u, 6u, 0u); size = (2u, 2u); u_axis = (1u, 0u, 0u); v_axis = (0u, 1u, 0u); surface = skin.badge; }
      }
    }
  }
  settings { density = 16; forward = north; }
  skeleton = S;
  use Body as body {
    skeleton = R;
    skin = coat;
  }
}`;
};

// 1. Omitted contract atlas, omitted chart sizes, omitted chart origins compile & auto-pack deterministically.
const normal = compileSingle(autoPackedSource('normal'));
const reversed = compileSingle(autoPackedSource('reversed'));
assert.equal(normal.ok, true, normal.ok ? '' : JSON.stringify(normal.diagnostics));
assert.equal(reversed.ok, true);
if (normal.ok && reversed.ok) {
  assert.equal(normal.products[0]?.kind, 'model');
  assert.equal(reversed.products[0]?.kind, 'model');
  if (normal.products[0]?.kind === 'model' && reversed.products[0]?.kind === 'model') {
    const texA = Object.values(normal.products[0].model.textures)[0]!;
    const texB = Object.values(reversed.products[0].model.textures)[0]!;
    assert.ok(texA.width >= 16 && texA.height >= 16);
    assert.equal(texA.width, texB.width);
    assert.equal(texA.height, texB.height);
    assert.equal(texA.source.contentHash, texB.source.contentHash);
  }
}

// 2. Fail-closed on half-specified chart width without height.
const halfSized = compileSingle(
  autoPackedSource('normal').replace(
    'chart body box { coverage = opaque; }',
    'chart body box { width = 16px; coverage = opaque; }',
  ),
);
assert.equal(halfSized.ok, false);

// 3. Fail-closed on mixed explicit origin and omitted auto-packed origin.
const mixedOrigin = compileSingle(
  autoPackedSource('normal').replace(
    'chart body box { fill = coat; }',
    'chart body box { origin = (0px, 0px); fill = coat; }',
  ),
);
assert.equal(mixedOrigin.ok, false);

// 4. Fail-closed when shared chart is used by mismatched cube sizes.
const mismatchedUse = compileSingle(
  autoPackedSource('normal').replace(
    'plane crest { origin = (-1u, 6u, 0u); size = (2u, 2u); u_axis = (1u, 0u, 0u); v_axis = (0u, 1u, 0u); surface = skin.badge; }',
    'cube torso2 { origin = (4u, 0u, 0u); size = (2u, 2u, 2u); surface = skin.body; }\n        plane crest { origin = (-1u, 6u, 0u); size = (2u, 2u); u_axis = (1u, 0u, 0u); v_axis = (0u, 1u, 0u); surface = skin.badge; }',
  ),
);
assert.equal(mismatchedUse.ok, false);

// 5. Fail-closed when explicit atlas is too small for auto-packed charts.
const tooSmall = compileSingle(
  autoPackedSource('normal').replace(
    'surface contract Skin {',
    'surface contract Skin {\n    atlas { width = 8px; height = 8px; }',
  ),
);
assert.equal(tooSmall.ok, false);
