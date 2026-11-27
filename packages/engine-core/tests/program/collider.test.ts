import assert from 'node:assert/strict';
import {
  compileDirectoryWorkspace,
  computeModelColliders,
  emptyHooksDocument,
  generateAllHookBindings,
} from '../../src';

const wsConfig = JSON.stringify({
  format: 'ashfox-workspace',
  version: 2,
  name: 'collider_demo',
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

const modelSource = (profile: 'creature' | 'prop' | 'block', cubes: string): string => `ashfox 1
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
    material = opaque;
  }
  surface coat: Skin {
    material = opaque;
    texture tex {
      background = bg; background_alpha = 255;
      palette { bg = #333333; stone = (#666666, #888888, #aaaaaa); }
      chart body box { fill = stone; }
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
  settings { density = 16; forward = north; profile = ${profile}; }
  skeleton = S;
  use Body as body { skeleton = R; skin = coat; }
}`;

// 1. Creature profile emits a capsule collider + root AABB and hooks document attaches it.
const creatureRes = compileDirectoryWorkspace(wsConfig, [
  {
    path: 'assets/models/main.ashfox',
    source: modelSource(
      'creature',
      'cube torso { origin = (-4u, 0u, -4u); size = (8u, 24u, 8u); surface = skin.body; }',
    ),
  },
]);
assert.equal(creatureRes.ok, true, creatureRes.ok ? '' : JSON.stringify(creatureRes.diagnostics));
if (creatureRes.ok) {
  const prod = creatureRes.products[0]!;
  assert.equal(prod.kind, 'model');
  if (prod.kind === 'model') {
    const col = computeModelColliders(prod.model);
    assert.equal(col.profile, 'creature');
    assert.deepEqual(col.aabb.min, [-0.25, 0, -0.25]);
    assert.deepEqual(col.aabb.max, [0.25, 1.5, 0.25]);
    assert.equal(col.colliders.length, 1);
    const cap = col.colliders[0]!;
    assert.equal(cap.shape, 'capsule');
    if (cap.shape === 'capsule') {
      assert.equal(cap.axis, 'y');
      assert.equal(cap.radius, 0.25);
      assert.equal(cap.height, 1.5);
      assert.deepEqual(cap.center, [0, 0.75, 0]);
    }
    assert.deepEqual(prod.hooks?.colliders, col);
  }
}

// 2. Prop profile with separated geometry parts emits distinct tight box colliders + root AABB.
const propRes = compileDirectoryWorkspace(wsConfig, [
  {
    path: 'assets/models/main.ashfox',
    source: modelSource(
      'prop',
      `cube leg_l { origin = (-8u, 0u, -2u); size = (2u, 12u, 4u); surface = skin.body; }
       cube leg_r { origin = (6u, 0u, -2u); size = (2u, 12u, 4u); surface = skin.body; }`,
    ),
  },
]);
assert.equal(propRes.ok, true, propRes.ok ? '' : JSON.stringify(propRes.diagnostics));
if (propRes.ok) {
  const prod = propRes.products[0]!;
  if (prod.kind === 'model') {
    const col = computeModelColliders(prod.model);
    assert.equal(col.profile, 'prop');
    assert.equal(col.colliders.length, 2);
    assert.ok(col.colliders.every((c) => c.shape === 'box'));
    assert.deepEqual(col.aabb.min, [-0.5, 0, -0.125]);
    assert.deepEqual(col.aabb.max, [0.5, 0.75, 0.125]);
  }
}

// 3. TS / C# / GDScript bindings include collider schema definitions.
const bindings = generateAllHookBindings(emptyHooksDocument('demo').schemas);
assert.match(bindings.ts.content, /export interface AshfoxModelColliders/);
assert.match(bindings.ts.content, /export interface AshfoxCapsuleCollider/);
assert.match(bindings.cs.content, /public sealed class ModelColliders/);
assert.match(bindings.gd.content, /class ModelColliders:/);

console.log('automatic model physics collider tests ok');
