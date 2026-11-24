import assert from 'node:assert/strict';

import { compileDirectoryWorkspace } from '../../../src';

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

const mirrorSource = (extraGeometry = ''): string => `ashfox-model 1
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
    chart body box { coverage = opaque; }
    chart ear box { coverage = opaque; }
    chart tuft flat { coverage = opaque; }
    material = opaque;
  }
  surface red: Skin {
    material = opaque;
    texture tex {
      background = bg; background-alpha = 255;
      palette {
        bg = #101010;
        coat = (#402010, #804020, #c06030);
      }
      chart body box { fill = coat; }
      chart ear box { fill = coat; }
      chart tuft flat { fill = coat; }
    }
  }
  component Body {
    requires rig skeleton: R;
    requires surface skin: Skin;
    bind bone root to skeleton.root;
    geometry {
      bone root {
        cube torso { origin = (-2u, 0u, -2u); size = (4u, 4u, 4u); surface = skin.body; }
        cube ear_left {
          origin = (-4u, 4u, -1u);
          size = (2u, 3u, 1u);
          pivot = (-3u, 4u, 0u);
          rotation = (5deg, 10deg, -15deg);
          mirror-x = ear_right;
          surface = skin.ear;
          face east { enabled = false; }
        }
        plane tuft_left {
          origin = (-4u, 7u, 0u);
          size = (2u, 2u);
          u-axis = (1u, 0u, 0u);
          v-axis = (0u, 1u, 0u);
          mirror-x = tuft_right;
          surface = skin.tuft;
        }
        ${extraGeometry}
      }
    }
  }
  export asset main {
    settings { density = 16; forward = north; }
    skeleton = S;
    use Body as body {
      bind skeleton = R;
      bind skin = red;
    };
  }
}`;

const compiled = compileSingle(mirrorSource());
assert.equal(compiled.ok, true, compiled.ok ? '' : JSON.stringify(compiled.diagnostics));
if (compiled.ok) {
  const product = compiled.products[0]!;
  assert.equal(product.kind, 'model');
  if (product.kind === 'model') {
    const nodes = product.model.scene.nodes;
    const earRight = nodes['body/root/ear_right'];
    assert.ok(earRight && earRight.kind === 'cube' && earRight.geometryMode === 'axis-box');
    if (earRight && earRight.kind === 'cube' && earRight.geometryMode === 'axis-box') {
      assert.deepEqual(earRight.bounds.from, [2, 4, -1]);
      assert.deepEqual(earRight.bounds.to, [4, 7, 0]);
      assert.deepEqual(earRight.transform.pivot, [3, 4, 0]);
      assert.deepEqual(earRight.transform.rotation, [5, -10, 15]);
      assert.equal(earRight.mirror, true);
      assert.equal(earRight.faces.west.enabled, false);
      assert.equal(earRight.faces.east.enabled, true);
    }
    const tuftRight = nodes['body/root/tuft_right'];
    assert.ok(tuftRight && tuftRight.kind === 'plane');
    if (tuftRight && tuftRight.kind === 'plane') {
      assert.deepEqual(tuftRight.transform.position, [4, 7, 0]);
      assert.deepEqual(tuftRight.basis?.uAxis, [-1, 0, 0]);
    }
  }
}

// Self mirror-x rejected.
const selfMirror = compileSingle(
  mirrorSource(
    'cube bad { origin = (0u, 0u, 0u); size = (1u, 1u, 1u); mirror-x = bad; surface = skin.ear; }',
  ),
);
assert.equal(selfMirror.ok, false);

// Duplicate emitted sibling id rejected.
const duplicateMirror = compileSingle(
  mirrorSource(
    'cube ear_right { origin = (2u, 4u, -1u); size = (2u, 3u, 1u); surface = skin.ear; }',
  ),
);
assert.equal(duplicateMirror.ok, false);

// mirror-x on bone rejected.
const boneMirror = compileSingle(mirrorSource('bone extra { mirror-x = other; }'));
assert.equal(boneMirror.ok, false);
