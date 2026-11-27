import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  buildPrimitivePolygons,
  compileDirectoryWorkspace,
  encodeCanonicalPng,
  exportProductionProjectResolved,
  exportStructureGltfResolved,
  openAssetProject,
  rasterizeTexture,
  validateAssetProjectExportTarget,
  type DirectoryFile,
} from '../../src';
import { classifyStructureTilePbr } from '../../src/compiler/structure/tilePbr';

type CompiledModelProduct = Extract<
  Extract<ReturnType<typeof compileDirectoryWorkspace>, { ok: true }>['products'][number],
  { kind: 'model' }
>;

const exportModelGlb = async (
  prod: CompiledModelProduct,
  encoding: 'portable' | 'optimized',
): Promise<Uint8Array> => {
  const opened = openAssetProject({
    workspace: prod.workspace,
    entry: prod.entry,
    identity: { id: 'main', revision: 'r1', createdAt: '2026-01-01T00:00:00.000Z' },
  });
  assert.equal(opened.ok, true, opened.ok ? '' : JSON.stringify(opened));
  if (!opened.ok) throw new Error('openAssetProject failed');
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
      encoding,
    },
  );
  const glbFile = bundle.files.find((f) => f.path.endsWith('.glb'));
  assert.ok(glbFile && glbFile.kind === 'binary');
  return glbFile.data;
};

interface ValidatorReport {
  issues: { numErrors: number; messages: { severity: number; code: string; message: string }[] };
}

const validator = require('gltf-validator') as {
  validateBytes: (
    data: Uint8Array,
    opts?: { externalResourceFunction?: (uri: string) => Promise<Uint8Array> },
  ) => Promise<ValidatorReport>;
};

const parseGlbJson = (glb: Uint8Array) => {
  const view = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
  const len = view.getUint32(12, true);
  return JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + len))) as {
    materials: Array<{
      pbrMetallicRoughness?: {
        metallicFactor?: number;
        roughnessFactor?: number;
        metallicRoughnessTexture?: { index: number };
      };
      occlusionTexture?: { index: number };
    }>;
    meshes: Array<{ primitives: Array<Record<string, unknown>> }>;
    nodes: Array<{ name?: string; scale?: [number, number, number]; mesh?: number }>;
    animations?: Array<{
      channels: Array<{ target: { node?: number; path: string }; sampler: number }>;
      samplers: Array<{ interpolation?: string }>;
    }>;
  };
};

const wsConfig = JSON.stringify({
  format: 'ashfox-workspace',
  version: 2,
  name: 'craft_demo',
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

const compileOne = (source: string) =>
  compileDirectoryWorkspace(wsConfig, [{ path: 'assets/models/main.ashfox', source }]);

const baseRigAndSettings = (geometry: string, surfaceBody: string, extraMotion = '') => `ashfox 1
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
  ${surfaceBody}
  component Body {
    requires rig skeleton: R;
    requires surface skin: Skin;
    bind bone root to skeleton.root;
    geometry {
      bone root {
        ${geometry}
      }
    }
  }
  ${extraMotion}
  settings { density = 16; forward = north; profile = prop; }
  skeleton = S;
  ${extraMotion ? 'motions = [idle, attack];' : ''}
  use Body as body { skeleton = R; skin = coat; }
}`;

const testUniformScalarPbr = async (): Promise<void> => {
  const src = baseRigAndSettings(
    'cube box1 { origin = (-2u, 0u, -2u); size = (4u, 4u, 4u); surface = skin.body; }',
    `surface contract Skin { chart body box { coverage = opaque; } material = opaque; }
     surface coat: Skin {
       material opaque { roughness = 0.72; metallic = 0.15; }
       texture tex {
         background = bg; background_alpha = 255;
         palette { bg = #445566; c = (#445566, #556677, #667788); }
         chart body box { fill = c; }
       }
     }`,
  );
  const res = compileOne(src);
  assert.equal(res.ok, true, res.ok ? '' : JSON.stringify(res.diagnostics));
  if (!res.ok) return;
  const prod = res.products[0]!;
  assert.equal(prod.kind, 'model');
  if (prod.kind !== 'model') return;
  const tex = Object.values(prod.model.textures)[0]!;
  assert.equal(tex.pbr?.roughness, 0.72);
  assert.equal(tex.pbr?.metallic, 0.15);
  assert.equal(tex.pbr?.metallicRoughnessPngBase64, undefined);
  const glb = await exportModelGlb(prod, 'portable');
  const gltf = parseGlbJson(glb);
  assert.equal(gltf.meshes[0]!.primitives.length, 1);
  const matIdx = gltf.meshes[0]!.primitives[0]!.material as number;
  const lod0Mat = gltf.materials[matIdx]!;
  assert.equal(lod0Mat.pbrMetallicRoughness?.metallicFactor, 0.15);
  assert.equal(lod0Mat.pbrMetallicRoughness?.roughnessFactor, 0.72);
  assert.equal(lod0Mat.pbrMetallicRoughness?.metallicRoughnessTexture, undefined);
  const rep = await validator.validateBytes(glb);
  assert.equal(rep.issues.numErrors, 0, JSON.stringify(rep.issues.messages));
};

const testMixedPbrAndPrimitives = async (): Promise<void> => {
  const src = baseRigAndSettings(
    `taper horn { origin = (-2u, 0u, -2u); size = (4u, 6u, 4u); top_scale = (0.35, 0.35); axis = y; surface = skin.metal_part; }
     wedge ramp { origin = (3u, 0u, -2u); size = (4u, 4u, 4u); slope = north; surface = skin.wood_part; }
     cylinder barrel { origin = (-5u, 0u, 0u); radius = 2u; radius_top = 1.5u; height = 6u; sides = 8; axis = y; surface = skin.metal_part; }`,
    `surface contract Skin {
       chart metal_part box { coverage = opaque; }
       chart wood_part box { coverage = opaque; }
       material = opaque;
     }
     surface coat: Skin {
       material = opaque;
       texture tex {
         background = bg; background_alpha = 255;
         palette { bg = #202020; steel = (#606870, #88929c, #b0bac4); oak = (#5c3d22, #734c2b, #8a5e34); }
         chart metal_part box { fill = steel; roughness = 0.25; metallic = 0.92; roughness_variation = 0.08; }
         chart wood_part box { fill = oak; roughness = 0.85; metallic = 0.0; roughness_variation = 0.12; }
       }
     }`,
  );
  const res = compileOne(src);
  assert.equal(res.ok, true, res.ok ? '' : JSON.stringify(res.diagnostics));
  if (!res.ok) return;
  const prod = res.products[0]!;
  assert.equal(prod.kind, 'model');
  if (prod.kind !== 'model') return;
  const tex = Object.values(prod.model.textures)[0]!;
  assert.ok(tex.pbr?.metallicRoughnessPngBase64, 'mixed PBR charts synthesize shared MR+AO PNG');

  const horn = prod.model.scene.nodes['body/root/horn'];
  const ramp = prod.model.scene.nodes['body/root/ramp'];
  const barrel = prod.model.scene.nodes['body/root/barrel'];
  assert.ok(horn?.kind === 'taper' && ramp?.kind === 'wedge' && barrel?.kind === 'cylinder');
  assert.equal(buildPrimitivePolygons(horn).length, 6);
  assert.equal(
    buildPrimitivePolygons(ramp).reduce((s, p) => s + p.vertices.length - 2, 0),
    8,
  );
  assert.equal(
    buildPrimitivePolygons(barrel).reduce((s, p) => s + p.vertices.length - 2, 0),
    28,
  );

  // Minecraft exporters must fail closed on taper/wedge/cylinder.
  const opened = openAssetProject({
    workspace: prod.workspace,
    entry: prod.entry,
    identity: { id: 'main', revision: 'r1', createdAt: '2026-01-01T00:00:00.000Z' },
  });
  assert.equal(opened.ok, true, opened.ok ? '' : JSON.stringify(opened));
  if (!opened.ok) return;
  for (const target of ['bedrock', 'geckolib5', 'java_block'] as const) {
    const chk = validateAssetProjectExportTarget(opened.project, {
      target,
      namespace: 'demo',
      modelPath: 'main',
    });
    assert.equal(chk.valid, false, `${target} should reject extended primitives`);
    assert.ok(chk.findings.some((d) => d.code === 'format.unsupported_data'));
  }

  // GLB export emits 1 draw call (merged static primitive) + MR texture + occlusionTexture.
  const glb = await exportModelGlb(prod, 'optimized');
  const gltf = parseGlbJson(glb);
  assert.equal(gltf.meshes[0]!.primitives.length, 1);
  const matIdx = gltf.meshes[0]!.primitives[0]!.material as number;
  const lod0Mat = gltf.materials[matIdx]!;
  assert.ok(lod0Mat.pbrMetallicRoughness?.metallicRoughnessTexture);
  assert.ok(lod0Mat.occlusionTexture);
  const rep = await validator.validateBytes(glb);
  assert.equal(rep.issues.numErrors, 0, JSON.stringify(rep.issues.messages));
};

const testFacialExpressions = async (): Promise<void> => {
  const src = baseRigAndSettings(
    `cube head { origin = (-2u, 4u, -2u); size = (4u, 4u, 4u); surface = skin.head; }
     expression_slot face {
       origin = (-2u, 4u, -2u);
       size = (4u, 4u);
       u_axis = (-1u, 0u, 0u);
       v_axis = (0u, 1u, 0u);
       neutral = skin.face_neutral;
       blink = skin.face_blink;
       roar = skin.face_roar;
     }`,
    `surface contract Skin {
       chart head box { coverage = opaque; }
       chart face_neutral flat { coverage = opaque; }
       chart face_blink flat { coverage = opaque; }
       chart face_roar flat { coverage = opaque; }
       material = cutout;
     }
     surface coat: Skin {
       material = cutout;
       texture tex {
         background = bg; background_alpha = 0;
         palette { bg = #000000; fur = (#a85820, #c96f2d, #e08d45); eye = (#10161e, #182028, #283644); jaw = (#a82820, #d94136, #f06050); }
         chart head box { fill = fur; }
         chart face_neutral flat { fill = eye; }
         chart face_blink flat { fill = fur; }
         chart face_roar flat { fill = jaw; }
       }
     }`,
    `motion idle for R {
       duration = 2.0s;
       fps = 24;
       loop = loop;
       rest_relative = true;
       expression face {
         at 0.00s = neutral;
         at 1.45s..1.58s = blink;
       }
     }
     motion attack for R {
       duration = 1.5s;
       fps = 24;
       loop = once;
       rest_relative = true;
       expression face {
         at 0.00s = neutral;
         at 0.50s = roar;
       }
     }`,
  );
  const res = compileOne(src);
  assert.equal(res.ok, true, res.ok ? '' : JSON.stringify(res.diagnostics));
  if (!res.ok) return;
  const prod = res.products[0]!;
  assert.equal(prod.kind, 'model');
  if (prod.kind !== 'model') return;
  const neutral = prod.model.scene.nodes['body/root/face/neutral'];
  const blink = prod.model.scene.nodes['body/root/face/blink'];
  assert.ok(neutral?.kind === 'plane' && blink?.kind === 'plane');
  assert.deepEqual(neutral.transform.scale, [1, 1, 1]);
  assert.deepEqual(blink.transform.scale, [0, 0, 0]);
  assert.ok(Math.abs(neutral.transform.position[2] - -2.02) < 1e-4);

  const glb = await exportModelGlb(prod, 'portable');
  const gltf = parseGlbJson(glb);
  assert.equal(gltf.meshes[0]!.primitives.length, 1, 'expressions share single atlas / draw call');
  assert.ok(
    gltf.animations && gltf.animations[0]!.samplers.some((s) => s.interpolation === 'STEP'),
  );
  const blinkNodeIdx = gltf.nodes.findIndex((n) => n.name === 'body/root/face/blink');
  assert.ok(blinkNodeIdx >= 0);
  assert.deepEqual(gltf.nodes[blinkNodeIdx]!.scale, [0, 0, 0]);
  const rep = await validator.validateBytes(glb);
  assert.equal(rep.issues.numErrors, 0, JSON.stringify(rep.issues.messages));
};

const walkAshfoxFiles = (rootDir: string, base: string): DirectoryFile[] => {
  const out: DirectoryFile[] = [];
  for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
    if (entry.name === 'dist' || entry.name === 'build') continue;
    const rel = base ? `${base}/${entry.name}` : entry.name;
    const full = path.join(rootDir, entry.name);
    if (entry.isDirectory()) out.push(...walkAshfoxFiles(full, rel));
    else if (entry.name.endsWith('.ashfox'))
      out.push({ path: rel, source: fs.readFileSync(full, 'utf8') });
  }
  return out;
};

const testStructureTilePbr = async (): Promise<void> => {
  assert.equal(classifyStructureTilePbr('iron_block').metallic > 0.8, true);
  assert.equal(classifyStructureTilePbr('glass').roughness < 0.2, true);
  assert.equal(classifyStructureTilePbr('water').roughness < 0.15, true);
  assert.equal(classifyStructureTilePbr('polished_andesite').materialClass, 'polished_stone');
  assert.equal(classifyStructureTilePbr('oak_planks').materialClass, 'wood');
  assert.equal(classifyStructureTilePbr('plaster_white').materialClass, 'plaster');

  const dir = path.resolve(__dirname, '../../../../examples/structure');
  const cfg = fs.readFileSync(path.join(dir, '.ashfoxworkspace'), 'utf8');
  const compiled = compileDirectoryWorkspace(cfg, walkAshfoxFiles(dir, ''));
  assert.equal(compiled.ok, true);
  if (!compiled.ok) return;
  const prod = compiled.products.find((p) => p.kind === 'structure');
  assert.ok(prod && prod.kind === 'structure');
  if (!prod || prod.kind !== 'structure') return;
  const texWithPbr = Object.values(prod.structure.bakedMesh.textures).filter(
    (t) => t.pbr?.metallicRoughnessPngBase64 !== undefined,
  );
  assert.ok(texWithPbr.length > 0);
  const bundle = await exportStructureGltfResolved(prod.structure, 'structure', 'key', {
    encoding: 'portable',
  });
  const glbFile = bundle.files.find((f) => f.path.endsWith('.glb'));
  assert.ok(glbFile && glbFile.kind === 'binary');
  const rep = await validator.validateBytes(glbFile.data);
  assert.equal(rep.issues.numErrors, 0, JSON.stringify(rep.issues.messages));
};

const testEdgeCasesFromReview = (): void => {
  const skinSrc = `
  surface contract Skin { chart c box { coverage = opaque; } material = opaque; }
  surface coat: Skin {
    material opaque {}
    texture atlas { background = shade; background_alpha = 255;
      palette { shade = #333333; base = (#556677, #8899aa, #bbccdd); }
      chart c box { fill = base; }
    }
  }`;
  // 1. Pointed cylinder (radius_top = 0u) with axis = x and mirror_x compiles cleanly and reflects axial extent & radii.
  const coneRes = compileOne(
    baseRigAndSettings(
      `cylinder tip {
        origin = (2u, 0u, 0u); radius = 3u; radius_top = 0u; height = 4u; sides = 8; axis = x;
        mirror_x = tip_m;
        surface = skin.c;
      }`,
      skinSrc,
    ),
  );
  assert.equal(coneRes.ok, true, coneRes.ok ? '' : JSON.stringify(coneRes.diagnostics));
  if (coneRes.ok) {
    const model = (coneRes.products[0] as CompiledModelProduct).model;
    const orig = model.scene.nodes['body/root/tip'];
    const mir = model.scene.nodes['body/root/tip_m'];
    assert.ok(orig?.kind === 'cylinder' && mir?.kind === 'cylinder');
    assert.equal(orig.radiusTop, 0);
    assert.equal(mir.origin[0], -6);
    assert.equal(mir.radius, 0);
    assert.equal(mir.radiusTop, 3);
  }
  // 2. Unknown expression slot or variant fails closed with diagnostic.
  const exprSurface = `
  surface contract Skin {
    chart head box { coverage = opaque; }
    chart neutral flat { coverage = opaque; }
    material = opaque;
  }
  surface coat: Skin {
    material opaque {}
    texture atlas { background = shade; background_alpha = 0;
      palette { shade = #000000; body = (#888888, #aaaaaa, #cccccc); }
      chart head box { fill = body; }
      chart neutral flat { fill = body; }
    }
  }`;
  const slotDecl = `cube head { origin = (-2u, 0u, -2u); size = (4u, 4u, 4u); surface = skin.head; }
    expression_slot face { origin = (-2u, 0u, -2u); size = (4u, 4u); u_axis = (-1u, 0u, 0u); v_axis = (0u, 1u, 0u); neutral = skin.neutral; }`;
  const badSlot = compileOne(
    baseRigAndSettings(
      slotDecl,
      exprSurface,
      `motion idle for R { duration = 1.0s; fps = 24; loop = loop; rest_relative = true; expression missing { at 0s = neutral; } }
       motion attack for R { duration = 0.5s; fps = 24; loop = once; rest_relative = true; track root.rotation { key 0s = (0deg, 0deg, 0deg) step; } }`,
    ),
  );
  assert.equal(badSlot.ok, false);
  if (!badSlot.ok) {
    assert.equal(
      badSlot.diagnostics.some(
        (d) =>
          d.code === 'asset.invalid-expression-slot' ||
          d.message.includes('asset.invalid-expression-slot'),
      ),
      true,
      JSON.stringify(badSlot.diagnostics),
    );
  }
  const badVar = compileOne(
    baseRigAndSettings(
      slotDecl,
      exprSurface,
      `motion idle for R { duration = 1.0s; fps = 24; loop = loop; rest_relative = true; expression face { at 0s = typo; } }
       motion attack for R { duration = 0.5s; fps = 24; loop = once; rest_relative = true; track root.rotation { key 0s = (0deg, 0deg, 0deg) step; } }`,
    ),
  );
  assert.equal(badVar.ok, false);
  if (!badVar.ok) {
    assert.equal(
      badVar.diagnostics.some(
        (d) =>
          d.code === 'asset.invalid-expression-variant' ||
          d.message.includes('asset.invalid-expression-variant'),
      ),
      true,
      JSON.stringify(badVar.diagnostics),
    );
  }
};

const main = async (): Promise<void> => {
  await testUniformScalarPbr();
  await testMixedPbrAndPrimitives();
  await testFacialExpressions();
  await testStructureTilePbr();
  testEdgeCasesFromReview();
  console.log('pbr, extended primitives, and facial expressions tests ok');
};

const pending = main().catch((err) => {
  console.error(err);
  process.exit(1);
});
const bucket = (globalThis as { __ashfoxEngineTestPromises?: Promise<unknown>[] })
  .__ashfoxEngineTestPromises;
if (Array.isArray(bucket)) bucket.push(pending);
