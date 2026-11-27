import assert from 'node:assert/strict';

import {
  compileDirectoryWorkspace,
  exportProductionProjectResolved,
  openAssetProject,
  rasterizeTexture,
  encodeCanonicalPng,
} from '../../../src';

const wsConfig = JSON.stringify({
  format: 'ashfox-workspace',
  version: 2,
  name: 'prim_pivot_demo',
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

const source = `ashfox 1
model main {
  rig contract R {
    handedness = right;
    frame { x = (1, 0, 0); y = (0, 1, 0); z = (0, 0, 1); }
    socket mount: Grip { joint = hand; capacity = one; }
    joint root {
      parent = none; role = root;
      frame { x = (1, 0, 0); y = (0, 1, 0); z = (0, 0, 1); }
      channels = rotation; mirror = none;
    }
    joint hand {
      parent = root; role = weapon;
      frame { x = (1, 0, 0); y = (0, 1, 0); z = (0, 0, 1); }
      channels = rotation; mirror = none;
    }
  }
  socket contract Grip {}
  skeleton S implements R {
    bind root { parent_origin = (0u, 10u, 0u); frame { x = (1, 0, 0); y = (0, 1, 0); z = (0, 0, 1); } }
    bind hand { parent_origin = (4u, 2u, -1u); frame { x = (1, 0, 0); y = (0, 1, 0); z = (0, 0, 1); } }
  }
  surface contract Skin {
    chart base box { coverage = opaque; }
    chart part box { coverage = opaque; }
    chart cyl box { coverage = opaque; }
    material = opaque;
  }
  surface coat: Skin {
    material = opaque;
    texture tex {
      background = bg; background_alpha = 255;
      palette { bg = #202020; metal = (#505860, #78828c, #a0aab4); }
      chart base box { fill = metal; roughness = 0.35; metallic = 0.85; }
      chart part box { fill = metal; roughness = 0.35; metallic = 0.85; }
      chart cyl box { fill = metal; roughness = 0.35; metallic = 0.85; }
    }
  }
  component Host {
    requires rig skeleton: R;
    requires surface skin: Skin;
    provides socket mount: Grip capacity = one;
    bind bone root to skeleton.root;
    bind bone hand to skeleton.hand;
    bind socket mount to bone hand {
      frame { origin = (2u, -3u, 4u); x = (1, 0, 0); y = (0, 1, 0); z = (0, 0, 1); }
    }
    geometry {
      bone root {
        cube base { origin = (-2u, 10u, -2u); size = (4u, 4u, 4u); surface = skin.base; }
        bone hand {}
      }
    }
  }
  component Prop {
    requires socket grip: Grip;
    requires surface skin: Skin;
    bind socket grip to bone root { frame { origin = (0u, 0u, 0u); x = (1, 0, 0); y = (0, 1, 0); z = (0, 0, 1); } }
    geometry {
      bone root {
        cube c_rot { origin = (-1u, 4u, -1u); size = (2u, 2u, 2u); pivot = (0.5u, 0u, -1u); rotation = (-14deg, 0deg, 0deg); surface = skin.part; }
        taper t_rot { origin = (-1u, 6u, -1u); size = (2u, 2u, 2u); top_scale = (0.4, 0.4); axis = y; pivot = (0.5u, 0u, -1u); rotation = (-14deg, 0deg, 0deg); surface = skin.part; }
        wedge w_rot { origin = (-1u, 8u, -1u); size = (2u, 2u, 2u); slope = north; pivot = (0.5u, 0u, -1u); rotation = (-14deg, 0deg, 0deg); surface = skin.part; }
        cylinder cyl_rot { origin = (0u, 0u, 0u); radius = 1u; radius_top = 1u; height = 4u; sides = 8; axis = y; pivot = (0.5u, 0u, -1u); rotation = (-14deg, 0deg, 0deg); surface = skin.cyl; }
        taper t_nopiv { origin = (-1u, 10u, -1u); size = (2u, 2u, 2u); top_scale = (0.5, 0.5); axis = y; rotation = (10deg, 0deg, 0deg); surface = skin.part; }
      }
    }
  }
  settings { density = 16; forward = north; profile = prop; }
  skeleton = S;
  use Host as host { skeleton = R; skin = coat; }
  use Prop as prop { skin = coat; }
  connect host.mount -> prop.grip;
}`;

interface GlbJson {
  nodes: Array<{ name?: string; translation?: [number, number, number]; mesh?: number }>;
  meshes: Array<{ primitives: Array<{ attributes: Record<string, number> }> }>;
  accessors: Array<{ min?: number[]; max?: number[] }>;
}

const parseGlbJson = (glb: Uint8Array): GlbJson => {
  const view = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
  const len = view.getUint32(12, true);
  return JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + len))) as GlbJson;
};

const validator = require('gltf-validator') as {
  validateBytes: (data: Uint8Array) => Promise<{
    issues: { numErrors: number; messages: unknown[] };
  }>;
};

const run = async (): Promise<void> => {
  const compiled = compileDirectoryWorkspace(wsConfig, [
    { path: 'assets/models/main.ashfox', source },
  ]);
  assert.equal(compiled.ok, true, compiled.ok ? '' : JSON.stringify(compiled.diagnostics));
  if (!compiled.ok) return;
  const prod = compiled.products[0]!;
  assert.equal(prod.kind, 'model');
  if (prod.kind !== 'model') return;

  // Component offset = root(0,10,0) + hand(4,2,-1) + mount(2,-3,4) = (6, 9, 3).
  const offset = [6, 9, 3] as const;
  const expectedPivot = [0.5 + offset[0], 0 + offset[1], -1 + offset[2]] as const;
  const nodes = prod.model.scene.nodes;

  for (const id of ['prop/root/c_rot', 'prop/root/t_rot', 'prop/root/w_rot', 'prop/root/cyl_rot']) {
    const node = nodes[id];
    assert.ok(node, `missing node ${id}`);
    assert.deepEqual(
      node.transform.pivot,
      expectedPivot,
      `${id} pivot must shift by componentOffset identically to cube`,
    );
  }

  const cubeNode = nodes['prop/root/c_rot']!;
  const taperNode = nodes['prop/root/t_rot']!;
  const wedgeNode = nodes['prop/root/w_rot']!;
  const cylNode = nodes['prop/root/cyl_rot']!;
  const noPivTaper = nodes['prop/root/t_nopiv']!;
  assert.equal(cubeNode.kind, 'cube');
  assert.equal(taperNode.kind, 'taper');
  assert.equal(wedgeNode.kind, 'wedge');
  assert.equal(cylNode.kind, 'cylinder');
  assert.equal(noPivTaper.kind, 'taper');
  if (
    cubeNode.kind === 'cube' &&
    cubeNode.geometryMode === 'axis-box' &&
    taperNode.kind === 'taper' &&
    wedgeNode.kind === 'wedge' &&
    cylNode.kind === 'cylinder' &&
    noPivTaper.kind === 'taper'
  ) {
    assert.deepEqual(cubeNode.bounds.from, [offset[0] - 1, offset[1] + 4, offset[2] - 1]);
    assert.deepEqual(taperNode.bounds.from, [offset[0] - 1, offset[1] + 6, offset[2] - 1]);
    assert.deepEqual(wedgeNode.bounds.from, [offset[0] - 1, offset[1] + 8, offset[2] - 1]);
    assert.deepEqual(cylNode.origin, [offset[0], offset[1], offset[2]]);
    assert.deepEqual(noPivTaper.transform.pivot, offset);
  }

  const opened = openAssetProject({
    workspace: prod.workspace,
    entry: prod.entry,
    identity: { id: 'main', revision: 'r1', createdAt: '2026-01-01T00:00:00.000Z' },
  });
  assert.equal(opened.ok, true);
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
      encoding: 'portable',
    },
  );
  const glbFile = bundle.files.find((f) => f.path.endsWith('.glb'));
  assert.ok(glbFile && glbFile.kind === 'binary');
  const rep = await validator.validateBytes(glbFile.data);
  assert.equal(rep.issues.numErrors, 0, JSON.stringify(rep.issues.messages));

  // Verify the exported GLB compiles cleanly with co-located geometry (no detached pivot offset).
  const gltf = parseGlbJson(glbFile.data);
  assert.ok(gltf.meshes.length >= 1);
  const posAccessorIdx = gltf.meshes[0]!.primitives[0]!.attributes.POSITION!;
  const posAcc = gltf.accessors[posAccessorIdx]!;
  assert.ok(posAcc.min && posAcc.max);
  // Base cube is at y=10..14 (0.625..0.875m); prop primitives at offset=(6,9,3) must stay >= y=0.5m, never near y=0.
  assert.ok(
    posAcc.min[1]! >= 0.5,
    `expected all GLB vertices co-located above y=0.5m, got minY=${posAcc.min[1]}`,
  );
  assert.ok(
    posAcc.max[0]! <= 0.55 && posAcc.min[0]! >= -0.2,
    `expected co-located X bounds, got [${posAcc.min[0]}, ${posAcc.max[0]}]`,
  );
  console.log('custom primitive pivot shift regression tests ok');
};

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
