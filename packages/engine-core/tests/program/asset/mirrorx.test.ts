import assert from 'node:assert/strict';

import {
  compileDirectoryWorkspace,
  openAssetProject,
  validateAssetProjectExportTarget,
} from '../../../src';

const workspaceConfig = (): string =>
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

const compileSingle = (source: string) =>
  compileDirectoryWorkspace(workspaceConfig(), [{ path: 'assets/models/main.ashfox', source }]);

const mirrorSource = (extraGeometry = ''): string => `ashfox 1
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
    chart body box { coverage = opaque; }
    chart ear box { coverage = opaque; }
    chart tuft flat { coverage = opaque; }
    material = opaque;
  }
  surface red: Skin {
    material = opaque;
    texture tex {
      background = bg; background_alpha = 255;
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
          mirror_x = ear_right;
          surface = skin.ear;
          face east { enabled = false; }
        }
        plane tuft_left {
          origin = (-4u, 7u, 0u);
          size = (2u, 2u);
          u_axis = (1u, 0u, 0u);
          v_axis = (0u, 1u, 0u);
          mirror_x = tuft_right;
          surface = skin.tuft;
        }
        ${extraGeometry}
      }
    }
  }
  settings { density = 16; forward = north; }
  skeleton = S;
  use Body as body {
    skeleton = R;
    skin = red;
  }
}`;

const compiled = compileSingle(mirrorSource());
assert.equal(compiled.ok, true, compiled.ok ? '' : JSON.stringify(compiled.diagnostics));
if (compiled.ok) {
  const product = compiled.products[0]!;
  assert.equal(product.kind, 'model');
  if (product.kind === 'model') {
    const nodes = product.model.scene.nodes;
    const earLeft = nodes['body/root/ear_left'];
    const earRight = nodes['body/root/ear_right'];
    assert.ok(earLeft && earLeft.kind === 'cube');
    assert.ok(earRight && earRight.kind === 'cube' && earRight.geometryMode === 'axis-box');
    if (
      earLeft &&
      earLeft.kind === 'cube' &&
      earRight &&
      earRight.kind === 'cube' &&
      earRight.geometryMode === 'axis-box'
    ) {
      assert.deepEqual(earRight.bounds.from, [2, 4, -1]);
      assert.deepEqual(earRight.bounds.to, [4, 7, 0]);
      assert.deepEqual(earRight.transform.pivot, [3, 4, 0]);
      assert.deepEqual(earRight.transform.rotation, [5, -10, 15]);
      assert.equal(earRight.mirror, false);
      assert.equal(earRight.boxUv, false);
      const ln = earLeft.faces.north.uv!;
      const le = earLeft.faces.east.uv!;
      assert.deepEqual(earRight.faces.north.uv, [ln[2], ln[1], ln[0], ln[3]]);
      assert.deepEqual(earRight.faces.west.uv, [le[2], le[1], le[0], le[3]]);
      assert.equal(earRight.faces.west.enabled, false);
      assert.equal(earRight.faces.east.enabled, true);
    }
    const tuftRight = nodes['body/root/tuft_right'];
    assert.ok(tuftRight && tuftRight.kind === 'plane');
    if (tuftRight && tuftRight.kind === 'plane') {
      assert.deepEqual(tuftRight.transform.position, [4, 7, 0]);
      assert.deepEqual(tuftRight.basis?.uAxis, [-1, 0, 0]);
    }
    // Baked UVs on mirrored cubes pass glTF/GLB validation and export cleanly.
    const opened = openAssetProject({
      workspace: product.workspace,
      entry: product.entry,
      identity: { id: 'mirror', revision: 'r1', createdAt: '2026-01-01T00:00:00.000Z' },
    });
    assert.equal(opened.ok, true);
    if (opened.ok) {
      const targetValidation = validateAssetProjectExportTarget(opened.project, {
        target: 'glb',
        modelPath: 'mirror',
      });
      assert.equal(
        targetValidation.valid,
        true,
        targetValidation.valid ? '' : JSON.stringify(targetValidation.findings),
      );
    }
  }
}

// Self mirror_x rejected.
const selfMirror = compileSingle(
  mirrorSource(
    'cube bad { origin = (0u, 0u, 0u); size = (1u, 1u, 1u); mirror_x = bad; surface = skin.ear; }',
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

// mirror_x on bone rejected.
const boneMirror = compileSingle(mirrorSource('bone extra { mirror_x = other; }'));
assert.equal(boneMirror.ok, false);
