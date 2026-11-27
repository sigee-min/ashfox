import assert from 'node:assert/strict';
import {
  compileDirectoryWorkspace,
  computeModelColliders,
  elaborateModelVariants,
  emptyHooksDocument,
  encodeCanonicalPng,
  exportProductionProjectResolved,
  generateAllHookBindings,
  openAssetProject,
  rasterizeTexture,
} from '../../src';

const wsConfig = JSON.stringify({
  format: 'ashfox-workspace',
  version: 2,
  name: 'hitzone_demo',
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

const HITZONE_MODEL = `ashfox 1
model main {
  rig contract R {
    joint root { parent = none; role = root; channels = rotation; }
    joint torso { parent = root; role = body; channels = rotation; }
    joint head { parent = torso; role = head; channels = rotation; }
    joint core { parent = torso; role = prop; channels = rotation; }
  }
  skeleton S implements R {
    bind root { parent_origin = (0u, 0u, 0u); }
    bind torso { parent_origin = (0u, 12u, 0u); }
    bind head { parent_origin = (0u, 12u, 0u); }
    bind core { parent_origin = (0u, 6u, -3u); }
  }
  surface contract Skin {
    chart chest box { coverage = opaque; }
    chart head box { coverage = opaque; }
    chart core box { coverage = opaque; }
    material = opaque;
  }
  surface coat: Skin {
    material = opaque;
    texture tex {
      background = bg; background_alpha = 255;
      palette { bg = #333333; stone = (#666666, #888888, #aaaaaa); }
      chart chest box { fill = stone; }
      chart head box { fill = stone; }
      chart core box { fill = stone; }
    }
  }
  component Body {
    requires rig skeleton: R;
    requires surface skin: Skin;
    bind bone root to skeleton.root;
    bind bone torso to skeleton.torso;
    bind bone head to skeleton.head;
    bind bone core to skeleton.core;
    geometry {
      bone root {
        bone torso {
          cube chest { origin = (-4u, 12u, -3u); size = (8u, 12u, 6u); surface = skin.chest; }
          bone head {
            cube skull { origin = (-4u, 24u, -4u); size = (8u, 8u, 8u); surface = skin.head; }
          }
          bone core {
            cube crystal { origin = (-2u, 16u, -5u); size = (4u, 4u, 4u); surface = skin.core; }
          }
        }
      }
    }
  }
  settings { density = 16; forward = north; profile = creature; }
  skeleton = S;
  use Body as body { skeleton = R; skin = coat; }

  hitzone head { bone = head; shape = box; multiplier = 2.0; tag = headshot; }
  hitzone torso { bone = torso; shape = capsule; multiplier = 1.0; tag = body; }
  hitzone weakpoint { bone = core; shape = sphere; multiplier = 2.5; tag = critical; }
}`;

// 1. Bone-bound multi-collider hitzones + glTF emission.
const runAsync = async (): Promise<void> => {
  const res = compileDirectoryWorkspace(wsConfig, [
    { path: 'assets/models/main.ashfox', source: HITZONE_MODEL },
  ]);
  assert.equal(res.ok, true, res.ok ? '' : JSON.stringify(res.diagnostics));
  if (!res.ok) return;
  const prod = res.products[0]!;
  assert.equal(prod.kind, 'model');
  if (prod.kind !== 'model') return;

  const col = computeModelColliders(prod.model);
  assert.equal(col.hitzones?.length, 3);
  const hzHead = col.hitzones!.find((h) => h.id === 'head')!;
  const hzTorso = col.hitzones!.find((h) => h.id === 'torso')!;
  const hzWeak = col.hitzones!.find((h) => h.id === 'weakpoint')!;

  assert.equal(hzHead.shape, 'box');
  assert.equal(hzHead.multiplier, 2.0);
  assert.equal(hzHead.tag, 'headshot');
  assert.deepEqual(hzHead.center, [0, 1.75, 0]);
  assert.deepEqual(hzHead.localCenter, [0, 0.25, 0]);
  assert.deepEqual(hzHead.size, [0.5, 0.5, 0.5]);

  assert.equal(hzTorso.shape, 'capsule');
  assert.equal(hzTorso.multiplier, 1.0);
  assert.deepEqual(hzTorso.center, [0, 1.125, 0]);

  assert.equal(hzWeak.shape, 'sphere');
  assert.equal(hzWeak.multiplier, 2.5);
  assert.equal(hzWeak.tag, 'critical');
  assert.equal(hzWeak.radius, 0.125);
  assert.deepEqual(prod.hooks?.colliders?.hitzones, col.hitzones);

  // GLTF export carries hitzone_<id> nodes + extras.ashfox.hooks.colliders.hitzones.
  const opened = openAssetProject({
    workspace: prod.workspace,
    entry: prod.entry,
    identity: { id: 'test', revision: '1', createdAt: '2000-01-01T00:00:00.000Z' },
  });
  assert.equal(opened.ok, true);
  if (opened.ok) {
    const doc = opened.project.document;
    const textures = new Map(Object.values(doc.textures).map((t) => [t.source.key, t]));
    const bundle = await exportProductionProjectResolved(
      opened.project,
      { target: 'gltf', modelPath: 'main' },
      {
        encoding: 'portable',
        hooks: prod.hooks,
        resolveBlob: async (ref) => {
          const tex = textures.get(ref.key);
          return tex
            ? {
                bytes: encodeCanonicalPng(rasterizeTexture(doc, tex)),
                contentType: 'image/png',
              }
            : null;
        },
      },
    );
    const gltfFile = bundle.files.find((f) => f.path.endsWith('.gltf'))!;
    assert.ok(gltfFile && gltfFile.kind === 'json');
    const gltfJson = gltfFile.data as {
      nodes: Array<{ name?: string; extras?: { ashfox?: { hitzone?: { id: string } } } }>;
      extras?: { ashfox?: { hooks?: { colliders?: { hitzones?: unknown[] } } } };
    };
    assert.ok(gltfJson.nodes.some((n) => n.name === 'hitzone_head'));
    assert.ok(gltfJson.nodes.some((n) => n.name === 'hitzone_weakpoint'));
    assert.equal(gltfJson.extras?.ashfox?.hooks?.colliders?.hitzones?.length, 3);
  }
};

// 2. Bindings emit hitzone definitions across TS / C# / GDScript.
{
  const bindings = generateAllHookBindings(emptyHooksDocument('demo').schemas);
  assert.match(bindings.ts.content, /export interface AshfoxModelHitZone/);
  assert.match(bindings.cs.content, /public sealed class ModelHitZone/);
  assert.match(bindings.gd.content, /class ModelHitZone:/);
}

// 3. Variant damage_state elaboration + backward compatibility.
{
  const variantSrc = HITZONE_MODEL.replace(
    'size = (8u, 12u, 6u);',
    'size = (8u, chest_h, 6u);',
  ).replace(
    /\}$/,
    `
  variant intact {
    state = intact;
    chest_h = 12u;
  }
  variant damaged {
    state = damaged;
    break_vfx = "vfx.splinter";
    break_sound = "sfx.crack";
    chest_h = 8u;
  }
  variant destroyed {
    state = destroyed;
    break_vfx = "vfx.dust";
    break_sound = "sfx.collapse";
    chest_h = 4u;
  }
}`,
  );
  const elaborated = elaborateModelVariants(variantSrc, 'assets/models/main.ashfox');
  assert.equal(elaborated.length, 3);
  assert.equal(elaborated[1]!.damageState?.state, 'damaged');
  assert.equal(elaborated[1]!.damageState?.breakVfx, 'vfx.splinter');
  assert.equal(elaborated[1]!.damageState?.breakSound, 'sfx.crack');

  const compiledVars = compileDirectoryWorkspace(wsConfig, [
    { path: 'assets/models/main.ashfox', source: variantSrc },
  ]);
  assert.equal(
    compiledVars.ok,
    true,
    compiledVars.ok ? '' : JSON.stringify(compiledVars.diagnostics),
  );
  if (compiledVars.ok) {
    const damaged = compiledVars.products.find(
      (p) => p.kind === 'model' && p.entry.entryName === 'main_damaged',
    );
    assert.ok(damaged && damaged.kind === 'model');
    assert.equal(damaged.hooks?.damageState?.state, 'damaged');
    assert.equal(damaged.hooks?.damageState?.baseId, 'main');
    assert.equal(damaged.hooks?.damageState?.breakVfx, 'vfx.splinter');
    assert.equal(damaged.hooks?.damageState?.breakSound, 'sfx.crack');
  }
}

// 4. Negative cases: missing bone, bad shape, negative multiplier.
{
  const badBone = HITZONE_MODEL.replace('bone = head;', 'bone = nonexistent;');
  const r1 = compileDirectoryWorkspace(wsConfig, [
    { path: 'assets/models/main.ashfox', source: badBone },
  ]);
  assert.equal(r1.ok, false);

  const badShape = HITZONE_MODEL.replace('shape = sphere;', 'shape = pyramid;');
  const r2 = compileDirectoryWorkspace(wsConfig, [
    { path: 'assets/models/main.ashfox', source: badShape },
  ]);
  assert.equal(r2.ok, false);

  const badMult = HITZONE_MODEL.replace('multiplier = 2.5;', 'multiplier = 0;');
  const r3 = compileDirectoryWorkspace(wsConfig, [
    { path: 'assets/models/main.ashfox', source: badMult },
  ]);
  assert.equal(r3.ok, false);
}

const p = runAsync().then(() => console.log('hitzone and damage state tests ok'));
(
  globalThis as { __ashfoxEngineTestPromises?: Promise<unknown>[] }
).__ashfoxEngineTestPromises?.push(p);
