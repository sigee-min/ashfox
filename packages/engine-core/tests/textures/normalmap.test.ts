import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  compileDirectoryWorkspace,
  encodeCanonicalPng,
  exportProductionProjectResolved,
  exportStructureGltfResolved,
  openAssetProject,
  rasterizeTexture,
  virtualLibrarySpecifierFromPath,
} from '../../src';
import { decodePngBase64Rgba } from '../../src/audit/pngDecode';
import { computeOrthogonalTangents } from '../../src/export/targets/gltf/tangent';
import {
  applyCurvatureOklch,
  applyCurvaturePbr,
  bakeChartCurvatureMask,
  computeMeshVertexCurvature,
} from '../../src/textures/curvature';
import {
  grainHeightOffset,
  patternHeightOffset,
  synthesizeNormalMapPngBase64,
} from '../../src/textures/normalMap';
import { hexToOklch } from '../../src/textures/oklch';

const validator = require('gltf-validator') as {
  validateBytes: (data: Uint8Array) => Promise<{
    issues: { numErrors: number; messages: { severity: number; message: string }[] };
  }>;
};

const loadStdLibs = (): Map<string, string> => {
  const stdDir = path.resolve(__dirname, '../../../../library/std');
  const out = new Map<string, string>();
  for (const rel of fs.readdirSync(stdDir, { recursive: true }) as string[]) {
    if (!rel.endsWith('.ashfox')) continue;
    const spec = virtualLibrarySpecifierFromPath(`library/std/${rel.replaceAll(path.sep, '/')}`);
    if (spec) out.set(spec, fs.readFileSync(path.join(stdDir, rel), 'utf8'));
  }
  return out;
};

const wsConfig = JSON.stringify({
  format: 'ashfox-workspace',
  version: 2,
  name: 'normalmap_demo',
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
  compileDirectoryWorkspace(
    wsConfig,
    [{ path: 'assets/models/main.ashfox', source }],
    loadStdLibs(),
  );

const parseGlb = (glb: Uint8Array) => {
  const view = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
  const jsonLen = view.getUint32(12, true);
  const gltf = JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + jsonLen))) as {
    materials: Array<{
      pbrMetallicRoughness?: { metallicFactor?: number; roughnessFactor?: number };
      normalTexture?: { index: number; scale?: number };
    }>;
    meshes: Array<{ primitives: Array<{ attributes: Record<string, number>; material?: number }> }>;
    accessors: Array<{
      bufferView: number;
      byteOffset?: number;
      componentType: number;
      count: number;
      type: string;
    }>;
    bufferViews: Array<{
      buffer: number;
      byteOffset?: number;
      byteLength: number;
      byteStride?: number;
    }>;
  };
  const binStart = 20 + jsonLen;
  const binLen = view.getUint32(binStart, true);
  const bin = glb.subarray(binStart + 8, binStart + 8 + binLen);
  return { gltf, bin };
};

const testScharrNormalSynthesis = (): void => {
  const flat = new Float32Array(16 * 16).fill(0.5);
  assert.equal(
    synthesizeNormalMapPngBase64(16, 16, flat, [
      { x: 0, y: 0, width: 16, height: 16, strength: 0.5 },
    ]),
    undefined,
  );
  const sloped = new Float32Array(16 * 16).fill(0.5);
  for (let y = 0; y < 16; y += 1) {
    for (let x = 0; x < 16; x += 1) {
      sloped[y * 16 + x] = x >= 8 ? 0.85 : 0.15;
    }
  }
  assert.equal(
    synthesizeNormalMapPngBase64(16, 16, sloped, [
      { x: 0, y: 0, width: 16, height: 16, strength: 0 },
    ]),
    undefined,
  );
  const b64A = synthesizeNormalMapPngBase64(16, 16, sloped, [
    { x: 0, y: 0, width: 16, height: 16, strength: 0.6 },
  ]);
  const b64B = synthesizeNormalMapPngBase64(16, 16, sloped, [
    { x: 0, y: 0, width: 16, height: 16, strength: 0.6 },
  ]);
  assert.ok(b64A && b64A === b64B, 'normal PNG synthesis must be deterministic');
  const decoded = decodePngBase64Rgba(b64A);
  assert.ok(decoded !== null, 'decoded normal PNG must be valid');
  const stepOff = (8 * 16 + 7) * 4;
  assert.ok(
    decoded.rgba[stepOff]! < 120,
    'rising height along +u tilts normal toward -u (R < 128)',
  );
  assert.equal(decoded.rgba[stepOff + 1], 128, 'pure horizontal step has neutral G=128');
  assert.ok(decoded.rgba[stepOff + 2]! > 128, 'tangent normal Z stays positive');
  const flatOff = (8 * 16 + 2) * 4;
  assert.deepEqual(
    [decoded.rgba[flatOff], decoded.rgba[flatOff + 1], decoded.rgba[flatOff + 2]],
    [128, 128, 255],
  );
};

const testGrainAndPatternHeightDiversity = (): void => {
  const grains = ['fur', 'wood', 'stone', 'cloth', 'brushed'] as const;
  const signatures = new Set(
    grains.map((g) =>
      [0, 1, 2, 3, 4]
        .map((i) => grainHeightOffset([i, i * 2, 1], 42, g, i, i + 1).toFixed(3))
        .join(','),
    ),
  );
  assert.equal(signatures.size, grains.length);
  const patterns = ['brick', 'plank', 'tile', 'seam'] as const;
  for (const p of patterns) {
    const groove = patternHeightOffset(0, 0, 16, 16, p);
    const body = patternHeightOffset(2, 2, 16, 16, p);
    assert.ok(groove < body, `pattern ${p} groove must sit lower than body`);
  }
};

const testCurvatureAndBentAo = (): void => {
  // Convex wedge corner vs concave L-crease
  const convexCurv = computeMeshVertexCurvature(
    [0, 1, 0, 1, 1, 0, 0, 1, 1, 1, 0, 0, 1, 0, 1],
    [0, 1, 0, 0.707, 0.707, 0, 0, 1, 0, 1, 0, 0, 1, 0, 0],
    [0, 2, 1, 1, 2, 4, 1, 4, 3],
  );
  assert.ok(
    convexCurv[1]! > 0 && convexCurv[2]! > 0,
    'convex dihedral edge has positive curvature',
  );
  const concaveCurv = computeMeshVertexCurvature(
    [0, 0, 0, 1, 0, 0, 0, 0, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1],
    [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, -1, 0, 0, -1, 0, 0],
    [0, 2, 1, 1, 2, 3, 1, 3, 5, 1, 5, 4],
  );
  assert.ok(concaveCurv[1]! < 0, 'concave crease edge has negative curvature');

  const ao = new Uint8Array(8 * 8);
  ao[3 * 8 + 3] = 2;
  const mask = bakeChartCurvatureMask(
    8,
    8,
    [{ x: 0, y: 0, width: 8, height: 8, isBoxFace: true, density: 1 }],
    ao,
  );
  assert.ok(mask.convex[0]! > 0.4, 'box border texel has convex curvature');
  assert.ok(mask.concave[3 * 8 + 3]! > 0.5, 'AO texel has concave crease weight');
  const wornHex = applyCurvatureOklch('#727e8a', mask.convex[0]!, 0, 0.6);
  const creaseHex = applyCurvatureOklch('#727e8a', 0, mask.concave[3 * 8 + 3]!, 0.6);
  assert.ok(hexToOklch(wornHex).l > hexToOklch('#727e8a').l, 'convex wear boosts OKLCH lightness');
  assert.ok(hexToOklch(creaseHex).l < hexToOklch('#727e8a').l, 'concave crease darkens lightness');
  const wornPbr = applyCurvaturePbr(0.4, 255, 1, 0, 0.5);
  const creasePbr = applyCurvaturePbr(0.4, 255, 0, 1, 0.5);
  assert.ok(wornPbr.roughness < 0.4, 'convex wear reduces roughness');
  assert.ok(
    creasePbr.roughness > 0.4 && creasePbr.aoByte < 255,
    'concave crease boosts roughness and Bent-AO',
  );
};

const testOrthogonalTangents = (): void => {
  const pos = [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0];
  const nrm = [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1];
  const uvs = [0, 1, 1, 1, 1, 0, 0, 0];
  const idx = [0, 1, 2, 0, 2, 3];
  const tan = computeOrthogonalTangents(pos, nrm, uvs, idx);
  assert.equal(tan.length, 16);
  for (let v = 0; v < 4; v += 1) {
    const [tx, ty, tz, tw] = [tan[v * 4]!, tan[v * 4 + 1]!, tan[v * 4 + 2]!, tan[v * 4 + 3]!];
    assert.ok(Math.abs(Math.hypot(tx, ty, tz) - 1) < 1e-5);
    assert.ok(Math.abs(tx * 0 + ty * 0 + tz * 1) < 1e-5);
    assert.ok(tw === 1 || tw === -1);
  }
};

const modelTemplate = (surfaceBlock: string): string => `ashfox 1
model main {
  rig contract R {
    joint root { parent = none; role = root; channels = rotation; }
  }
  skeleton S implements R {
    bind root { parent_origin = (0u, 0u, 0u); }
  }
  ${surfaceBlock}
  component Body {
    requires rig skeleton: R;
    requires surface skin: Skin;
    bind bone root to skeleton.root;
    geometry {
      bone root {
        cube plate { origin = (-4u, 0u, -4u); size = (8u, 8u, 8u); surface = skin.plate; }
      }
    }
  }
  settings { density = 16; forward = north; profile = prop; }
  skeleton = S;
  use Body as body { skeleton = R; skin = coat; }
}`;

const exportModel = async (source: string, encoding: 'portable' | 'optimized') => {
  const res = compileOne(source);
  assert.equal(res.ok, true, res.ok ? '' : JSON.stringify(res.diagnostics));
  if (!res.ok || res.products[0]?.kind !== 'model') throw new Error('compile failed');
  const prod = res.products[0];
  const opened = openAssetProject({
    workspace: prod.workspace,
    entry: prod.entry,
    identity: { id: 'main', revision: 'r1', createdAt: '2026-01-01T00:00:00.000Z' },
  });
  assert.equal(opened.ok, true);
  if (!opened.ok) throw new Error('open failed');
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
  const glb = bundle.files.find((f) => f.path.endsWith('.glb'));
  assert.ok(glb && glb.kind === 'binary');
  return { prod, glb: glb.data };
};

const testZeroOverheadAndActiveNormalGltf = async (): Promise<void> => {
  const offSrc = modelTemplate(`
    surface contract Skin { chart plate box { coverage = opaque; } material = opaque; }
    surface coat: Skin {
      material opaque { roughness = 0.35; metallic = 0.85; normal_strength = 0; }
      texture tex {
        background = bg; background_alpha = 255;
        palette { bg = #222222; steel = (#505860, #78828c, #a0aab4); }
        chart plate box { fill = steel; grain = brushed; }
      }
    }`);
  const off = await exportModel(offSrc, 'portable');
  const offTex = Object.values(off.prod.model.textures)[0]!;
  assert.equal(offTex.pbr?.normalPngBase64, undefined, 'normal_strength = 0 omits normalPngBase64');
  const offParsed = parseGlb(off.glb);
  assert.equal(offParsed.gltf.materials[0]!.normalTexture, undefined);
  assert.equal(offParsed.gltf.meshes[0]!.primitives[0]!.attributes.TANGENT, undefined);

  const onSrc = modelTemplate(`
    surface contract Skin { chart plate box { coverage = opaque; } material = opaque; }
    surface coat: Skin {
      material opaque { roughness = 0.32; metallic = 0.88; normal_strength = 0.45; edge_wear = 0.35; }
      texture tex {
        density = 2;
        background = bg; background_alpha = 255;
        palette { bg = #222222; steel = (#505860, #78828c, #a0aab4); brass = (#75531d, #bd8b34, #ebbf63); }
        stamp rivet { pixels = "bb/bb"; b = brass; }
        chart plate box {
          fill = steel; grain = brushed;
          pattern border { paint = brass; width = 1px; edges = all; }
          face north { stamp rivet { at = (2px, 2px); protect = true; } }
        }
      }
    }`);
  for (const encoding of ['portable', 'optimized'] as const) {
    const on = await exportModel(onSrc, encoding);
    const onTex = Object.values(on.prod.model.textures)[0]!;
    assert.ok(onTex.pbr?.normalPngBase64, 'active normal_strength emits shared normal PNG');
    assert.ok(onTex.pbr?.metallicRoughnessPngBase64, 'active edge_wear emits shared MR+AO PNG');
    const parsed = parseGlb(on.glb);
    assert.equal(parsed.gltf.meshes[0]!.primitives.length, 1, '0 extra draw calls');
    const prim = parsed.gltf.meshes[0]!.primitives[0]!;
    assert.ok(prim.attributes.TANGENT !== undefined, `${encoding} emits TANGENT attribute`);
    assert.ok(parsed.gltf.materials[prim.material!]!.normalTexture !== undefined);
    const tanAcc = parsed.gltf.accessors[prim.attributes.TANGENT!]!;
    assert.equal(tanAcc.type, 'VEC4');
    const rep = await validator.validateBytes(on.glb);
    assert.equal(rep.issues.numErrors, 0, `${encoding}: ${JSON.stringify(rep.issues.messages)}`);
  }

  const bad = compileOne(
    modelTemplate(`
      surface contract Skin { chart plate box { coverage = opaque; } material = opaque; }
      surface coat: Skin {
        material opaque { normal_strength = 1.5; }
        texture tex { background = bg; background_alpha = 255; palette { bg = #222222; c = (#444444, #666666, #888888); } chart plate box { fill = c; } }
      }`),
  );
  assert.equal(bad.ok, false);
  assert.ok(
    !bad.ok &&
      bad.diagnostics.some(
        (d) =>
          d.code === 'asset.texture.invalid-pbr' || d.message.includes('asset.texture.invalid-pbr'),
      ),
  );
};

const testStdMaterialImportsAndStructure = async (): Promise<void> => {
  const stdCases = [
    {
      mod: 'metal',
      imp: 'std/core/material/metal',
      contract: 'MetalSurface',
      surf: 'forged_iron',
      charts: ['plate', 'rivet'],
    },
    {
      mod: 'stone',
      imp: 'std/core/material/stone',
      contract: 'StoneSurface',
      surf: 'dressed_stone',
      charts: ['block', 'trim'],
    },
    {
      mod: 'wood',
      imp: 'std/core/material/wood',
      contract: 'WoodSurface',
      surf: 'oak_timber',
      charts: ['plank', 'bark'],
    },
    {
      mod: 'fabric',
      imp: 'std/core/material/fabric',
      contract: 'FabricSurface',
      surf: 'woven_cloth',
      charts: ['cloth', 'hem'],
    },
  ] as const;
  for (const c of stdCases) {
    const stdSrc = `ashfox 1
model main {
  import "${c.imp}" as ${c.mod};
  rig contract R { joint root { parent = none; role = root; channels = rotation; } }
  skeleton S implements R { bind root { parent_origin = (0u, 0u, 0u); } }
  component Body {
    requires rig skeleton: R;
    requires surface skin: ${c.mod}.${c.contract};
    bind bone root to skeleton.root;
    geometry {
      bone root {
        cube b1 { origin = (-2u, 0u, -2u); size = (4u, 4u, 4u); surface = skin.${c.charts[0]}; }
        cube b2 { origin = (3u, 0u, -2u); size = (2u, 2u, 2u); surface = skin.${c.charts[1]}; }
      }
    }
  }
  settings { density = 16; forward = north; profile = prop; }
  skeleton = S;
  use Body as body { skeleton = R; skin = ${c.mod}.${c.surf}; }
}`;
    const res = compileOne(stdSrc);
    assert.equal(res.ok, true, res.ok ? '' : JSON.stringify(res.diagnostics));
    if (res.ok && res.products[0]?.kind === 'model') {
      const tex = Object.values(res.products[0].model.textures)[0]!;
      assert.ok(tex.pbr?.normalPngBase64, `std ${c.mod}.${c.surf} carries calibrated normal map`);
      assert.ok(
        tex.pbr?.metallicRoughnessPngBase64,
        `std ${c.mod}.${c.surf} carries calibrated edge_wear MR+AO`,
      );
    }
  }

  // Structure GLB with tile normals + TANGENT
  const dir = path.resolve(__dirname, '../../../../showcase');
  const cfg = fs.readFileSync(path.join(dir, '.ashfoxworkspace'), 'utf8');
  const tavernSrc = fs.readFileSync(path.join(dir, 'assets/structures/tavern.ashfox'), 'utf8');
  const sc = compileDirectoryWorkspace(
    cfg,
    [{ path: 'assets/structures/tavern.ashfox', source: tavernSrc }],
    loadStdLibs(),
  );
  if (sc.ok) {
    const prod = sc.products.find((p) => p.kind === 'structure');
    if (prod?.kind === 'structure') {
      const bundle = await exportStructureGltfResolved(prod.structure, 'tavern', 'key', {
        encoding: 'optimized',
      });
      const glbFile = bundle.files.find((f) => f.path.endsWith('.glb'));
      assert.ok(glbFile && glbFile.kind === 'binary');
      const parsed = parseGlb(glbFile.data);
      assert.ok(parsed.gltf.materials.some((m) => m.normalTexture !== undefined));
      assert.ok(
        parsed.gltf.meshes.some((m) =>
          m.primitives.some((p) => p.attributes.TANGENT !== undefined),
        ),
      );
      const rep = await validator.validateBytes(glbFile.data);
      assert.equal(rep.issues.numErrors, 0, JSON.stringify(rep.issues.messages));
    }
  }
};

const run = async (): Promise<void> => {
  testScharrNormalSynthesis();
  testGrainAndPatternHeightDiversity();
  testCurvatureAndBentAo();
  testOrthogonalTangents();
  await testZeroOverheadAndActiveNormalGltf();
  await testStdMaterialImportsAndStructure();
  console.log('normalMap, 3D curvature, and glTF TANGENT tests ok');
};

void run().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
