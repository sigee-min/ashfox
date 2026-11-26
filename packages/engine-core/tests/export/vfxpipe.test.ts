import assert from 'node:assert/strict';
import {
  auditVfx,
  compileDirectoryWorkspace,
  compileVfxRecipe,
  emitVfxGlb,
  encodeCanonicalPng,
  rasterizeCanonicalTexture,
} from '../../src';

// 1. Verify 8-bit soft-alpha raster + PNG roundtrip
const softRaster = rasterizeCanonicalTexture(8, 8, {
  background: '#ffffff',
  backgroundAlpha: 64,
  alphaMode: 'soft',
  canvasDetails: [{ id: 'core', color: '#ff8a24', alpha: 180, x: 2, y: 2, width: 4, height: 4 }],
  alphaMasks: [],
});
assert.equal(softRaster.rgba.at(3), 64);
assert.equal(softRaster.rgba.at((2 * 8 + 2) * 4 + 3), 180);
const softPng = encodeCanonicalPng(softRaster);
assert.equal(softPng[0], 0x89);

// 2. Verify ashfox 1 vfx DSL -> directory compile -> GLB (KHR_materials_unlit) + specs
const config = JSON.stringify({
  format: 'ashfox-workspace',
  version: 2,
  name: 'vfx_pipe',
  packages: [
    {
      name: 'vfx_pipe',
      root: 'assets',
      manifest: {
        format: 'ashfox-package',
        version: 1,
        dependencies: [],
        entries: [{ name: 'flame_cleave', path: 'vfx/flame_cleave.ashfox' }],
        modules: [{ subpath: './palettes', path: 'module/palettes.ashfox' }],
      },
    },
  ],
  include: ['assets/**/*.ashfox'],
  ignore: [],
  build: { directory: 'dist/build' },
  exports: [
    {
      name: 'flame_cleave',
      entry: { packageName: 'vfx_pipe', entryName: 'flame_cleave' },
      format: 'glb',
      directory: 'dist/vfx',
    },
  ],
});

const palSource = `ashfox 1
module palettes {
  export palette EmberSolar {
    core = #fff7d6;
    mid = #ff8a24;
    edge = #b8250e;
    smoke = #3d2824;
  }
}
`;

const vfxSource = `ashfox 1
vfx flame_cleave {
  import "../module/palettes.ashfox" as pal;

  duration = 0.65s;
  fps = 30;
  loop = once;
  palette = pal.EmberSolar;

  element main_slash : slash_arc {
    at = 0.10s..0.34s;
    blend = additive;
    radius = 7u..18u;
    arc = -75deg..95deg;
    pitch = 14deg;
    position = (0u, 2u, 0u);
    rotation = (15deg, 0deg, 0deg);
    spin = 90deg;
    texture slash_streak { posterize = 4; bristles = 60%; }
    dissolve directional_wipe { frames = 10; edge_glow = core; }
    scale = 0.85 -> 1.10 ease_out -> 1.18;
  }

  emitter sparks : voxel_burst {
    at = 0.13s..0.62s;
    seed = 42;
    count = 24;
    shape = cone(55deg, 3u);
    particle = shard;
    speed = 18u..34u;
    life = 0.25s..0.55s;
    gravity = -28u;
    drag = 1.4;
    turbulence = curl(1.8, 7u);
    ground { y = 0u; bounce = 45%; friction = 70%; }
    size_over_life = 1.2u -> 0.9u -> 0u;
    color_over_life = core -> mid -> edge;
  }
}
`;

const compiled = compileDirectoryWorkspace(config, [
  { path: 'assets/module/palettes.ashfox', source: palSource },
  { path: 'assets/vfx/flame_cleave.ashfox', source: vfxSource },
]);
assert.equal(compiled.ok, true, compiled.ok ? '' : JSON.stringify(compiled.diagnostics));
if (compiled.ok) {
  const product = compiled.products[0]!;
  assert.equal(product.kind, 'vfx');
  if (product.kind === 'vfx') {
    const audit = auditVfx(product.vfx);
    assert.equal(audit.passed, true, JSON.stringify(audit.hardGateFailures));
    assert.ok(product.glb.byteLength > 200 && product.glb.byteLength <= 150 * 1024);
    assert.equal(product.spec.kind, 'vfx');
    assert.equal(product.particles.length, 1);
    // Check KHR_materials_unlit present in GLB JSON chunk
    const jsonLen = new DataView(product.glb.buffer, product.glb.byteOffset, 16).getUint32(
      12,
      true,
    );
    const gltf = JSON.parse(new TextDecoder().decode(product.glb.subarray(20, 20 + jsonLen)));
    assert.ok(gltf.extensionsUsed?.includes('KHR_materials_unlit'));
    assert.equal(gltf.materials[0].extras.ashfoxBlendMode, 'additive');
    const elNode = gltf.nodes.find((n: { name?: string }) => n.name === 'vfx_el_main_slash');
    assert.ok(elNode?.translation && Math.abs(elNode.translation[1] - 2 / 16) < 1e-5);
    assert.ok(elNode?.rotation && Array.isArray(elNode?.children) && elNode.children.length === 10);
    const animChannels = gltf.animations[0].channels as Array<{
      target: { node: number; path: string };
    }>;
    assert.ok(animChannels.some((c) => c.target.path === 'rotation'));
    assert.ok(
      animChannels.some((c) => c.target.path === 'scale' && c.target.node === elNode.children[1]),
    );
    const hasEdgeColor = (
      gltf.materials as Array<{ pbrMetallicRoughness?: { baseColorFactor?: number[] } }>
    ).some((m) => {
      const f = m.pbrMetallicRoughness?.baseColorFactor;
      return f !== undefined && f[0]! > 0.65 && f[1]! < 0.25 && f[2]! < 0.1;
    });
    assert.ok(hasEdgeColor, 'expected burst GLB to emit late-life edge palette color material');
  }
}

// 3. Element alpha curves produce distinct GLBs and explicit alpha=0 sets baseColorFactor[3]=0
const makeAlphaVfx = (alphaCurve: { t: number; value: number }[]) =>
  compileVfxRecipe({
    schema: 'ashfox 1',
    kind: 'vfx',
    name: 'alpha_test',
    durationSeconds: 0.5,
    fps: 30,
    loop: 'once',
    palette: { name: 'P', core: '#ffffff', mid: '#ff8822', edge: '#992211', smoke: '#332222' },
    elements: [
      {
        id: 'ring',
        startTime: 0,
        endTime: 0.5,
        blendMode: 'blend',
        primitive: { kind: 'ring', innerRadius: 2, outerRadius: 5 },
        texture: { kind: 'ring_wave', width: 32, height: 32, blendMode: 'blend', seed: 1 },
        colorRole: 'core',
        scaleCurve: [
          { t: 0, value: 1 },
          { t: 1, value: 1 },
        ],
        alphaCurve,
      },
    ],
    emitters: [],
  });
const glbFade = emitVfxGlb(
  makeAlphaVfx([
    { t: 0, value: 1 },
    { t: 1, value: 0 },
  ]),
);
const glbZero = emitVfxGlb(
  makeAlphaVfx([
    { t: 0, value: 0 },
    { t: 1, value: 0 },
  ]),
);
assert.notEqual(Buffer.compare(glbFade, glbZero), 0);
const zeroLen = new DataView(glbZero.buffer, glbZero.byteOffset, 16).getUint32(12, true);
const zeroGltf = JSON.parse(new TextDecoder().decode(glbZero.subarray(20, 20 + zeroLen)));
assert.equal(zeroGltf.materials[0].pbrMetallicRoughness.baseColorFactor[3], 0);

console.log('vfx end-to-end pipeline ok');
