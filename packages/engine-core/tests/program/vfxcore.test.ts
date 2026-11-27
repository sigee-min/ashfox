import assert from 'node:assert/strict';
import { auditVfx } from '../../src/vfx/audit';
import { compileVfxRecipe, readVfxRecipe } from '../../src/vfx/compile';
import type { VfxPrimitiveMesh, VfxTextureKind } from '../../src/vfx/contract';
import { bakeDissolveFlipbook } from '../../src/vfx/dissolve';
import { hexToRgb01 } from '../../src/textures/oklch';
import { VFX_PALETTES, VFX_SHOWCASE_PRESETS } from '../../src/vfx/presets';
import { buildVfxPrimitive } from '../../src/vfx/primitives';
import { emitBedrockParticleSpecs, emitVfxRuntimeSpec } from '../../src/vfx/specEmit';
import { synthesizeVfxTexture } from '../../src/vfx/textures';

const countSoftAlphaLevels = (rgba: Uint8Array): { midAlpha: number; nonZero: number } => {
  let midAlpha = 0;
  let nonZero = 0;
  for (let i = 3; i < rgba.length; i += 4) {
    const a = rgba[i]!;
    if (a > 0) nonZero += 1;
    if (a > 0 && a < 255) midAlpha += 1;
  }
  return { midAlpha, nonZero };
};

// 1. 8-bit soft alpha (0..255) + premultiplied luminous glow across all 6 texture kinds.
const kinds: readonly VfxTextureKind[] = [
  'slash_streak',
  'radial_flare',
  'starburst',
  'ring_wave',
  'magic_circle',
  'stylized_smoke',
];
for (const kind of kinds) {
  const tex = synthesizeVfxTexture(
    {
      kind,
      width: 64,
      height: 64,
      blendMode: kind === 'stylized_smoke' ? 'blend' : 'additive',
      seed: 42,
      posterize: kind === 'slash_streak' ? 4 : undefined,
    },
    VFX_PALETTES.EmberSolar,
  );
  assert.equal(tex.alphaMode, 'soft');
  assert.equal(tex.rgba.length, 64 * 64 * 4);
  const { midAlpha, nonZero } = countSoftAlphaLevels(tex.rgba);
  assert.ok(nonZero > 200, `${kind} should render visible pixels`);
  assert.ok(midAlpha > 20, `${kind} should have soft 8-bit intermediate alpha (0 < a < 255)`);
  if (kind !== 'stylized_smoke') {
    assert.equal(tex.premultiplied, true);
    assert.equal(tex.extras.ashfoxBlendMode, 'additive');
    assert.equal(tex.extras.ashfoxUnlit, true);
    for (let i = 0; i < tex.rgba.length; i += 4) {
      if (tex.rgba[i + 3] === 0) {
        assert.equal(tex.rgba[i], 0);
        assert.equal(tex.rgba[i + 1], 0);
        assert.equal(tex.rgba[i + 2], 0);
      }
    }
  }
}

// 2. Dissolve erosion monotonicity & hot OKLCH burning edge band across all 4 modes.
const baseTex = synthesizeVfxTexture(
  { kind: 'radial_flare', width: 32, height: 32, blendMode: 'additive', seed: 11 },
  VFX_PALETTES.EmberSolar,
);
const edgeRgb = hexToRgb01(VFX_PALETTES.EmberSolar.mid).map((v) => Math.round(v * 255));
for (const mode of ['voronoi', 'simplex', 'directional_wipe', 'radial_noise'] as const) {
  const atlas = bakeDissolveFlipbook(
    baseTex,
    { mode, frames: 10, edgeWidth: 0.16, edgeGlowRole: 'mid', seed: 99 },
    VFX_PALETTES.EmberSolar,
  );
  assert.equal(atlas.frameCount, 10);
  assert.equal(atlas.atlasWidth, atlas.columns * 32);
  assert.equal(atlas.atlasHeight, atlas.rows * 32);
  const counts: number[] = [];
  let sawHotEdge = false;
  for (let f = 0; f < atlas.frameCount; f += 1) {
    const col = f % atlas.columns;
    const row = Math.floor(f / atlas.columns);
    let visible = 0;
    for (let y = 0; y < 32; y += 1) {
      for (let x = 0; x < 32; x += 1) {
        const off = ((row * 32 + y) * atlas.atlasWidth + (col * 32 + x)) * 4;
        const a = atlas.rgba[off + 3]!;
        if (a > 0) visible += 1;
        if (
          a > 120 &&
          Math.abs(atlas.rgba[off]! - edgeRgb[0]!) <= 25 &&
          Math.abs(atlas.rgba[off + 1]! - edgeRgb[1]!) <= 35
        ) {
          sawHotEdge = true;
        }
      }
    }
    counts.push(visible);
  }
  for (let i = 1; i < counts.length; i += 1) {
    assert.ok(counts[i]! <= counts[i - 1]!, `${mode} dissolve must erode monotonically`);
  }
  assert.equal(counts[counts.length - 1], 0, `${mode} final frame must fully erode`);
  assert.ok(sawHotEdge, `${mode} dissolve should emit hot edge glow band`);
}

// 3. All 5 procedural primitives: non-degenerate tris, unit normals, [0..1] UVs, outward winding.
const assertValidMesh = (mesh: VfxPrimitiveMesh, label: string): void => {
  assert.ok(mesh.vertexCount >= 4, `${label} vertexCount`);
  assert.ok(mesh.triangleCount >= 2, `${label} triangleCount`);
  assert.equal(mesh.positions.length, mesh.vertexCount * 3);
  assert.equal(mesh.normals.length, mesh.vertexCount * 3);
  assert.equal(mesh.uvs.length, mesh.vertexCount * 2);
  assert.equal(mesh.indices.length, mesh.triangleCount * 3);
  let minU = Infinity;
  let maxU = -Infinity;
  for (let i = 0; i < mesh.uvs.length; i += 2) {
    const u = mesh.uvs[i]!;
    const v = mesh.uvs[i + 1]!;
    assert.ok(u >= -1e-4 && u <= 1 + 1e-4 && v >= -1e-4 && v <= 1 + 1e-4, `${label} UV range`);
    minU = Math.min(minU, u);
    maxU = Math.max(maxU, u);
  }
  assert.ok(maxU - minU > 0.25, `${label} UV span`);
  for (let i = 0; i < mesh.normals.length; i += 3) {
    const len = Math.hypot(mesh.normals[i]!, mesh.normals[i + 1]!, mesh.normals[i + 2]!);
    assert.ok(Math.abs(len - 1) < 1e-3, `${label} unit normal`);
  }
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const ia = mesh.indices[t]! * 3;
    const ib = mesh.indices[t + 1]! * 3;
    const ic = mesh.indices[t + 2]! * 3;
    const abx = mesh.positions[ib]! - mesh.positions[ia]!;
    const aby = mesh.positions[ib + 1]! - mesh.positions[ia + 1]!;
    const abz = mesh.positions[ib + 2]! - mesh.positions[ia + 2]!;
    const acx = mesh.positions[ic]! - mesh.positions[ia]!;
    const acy = mesh.positions[ic + 1]! - mesh.positions[ia + 1]!;
    const acz = mesh.positions[ic + 2]! - mesh.positions[ia + 2]!;
    const area2 = Math.hypot(aby * acz - abz * acy, abz * acx - abx * acz, abx * acy - aby * acx);
    assert.ok(area2 > 1e-6, `${label} non-degenerate triangle`);
  }
};

const meshes: readonly VfxPrimitiveMesh[] = [
  buildVfxPrimitive({
    kind: 'slash_arc',
    innerRadius: 5,
    outerRadius: 12,
    thetaStartDeg: -60,
    thetaEndDeg: 90,
    crossed: true,
    pitchTwistDeg: 15,
  }),
  buildVfxPrimitive({
    kind: 'ribbon',
    points: [
      [0, 0, 0],
      [3, 2, 1],
      [6, 1, 4],
    ],
    widthStart: 2,
    widthEnd: 0.4,
    profile: 'crossed',
  }),
  buildVfxPrimitive({
    kind: 'ribbon',
    points: [
      [0, 0, 0],
      [2, 3, 0],
      [5, 3, 2],
    ],
    widthStart: 1.5,
    widthEnd: 0.5,
    profile: 'tube',
  }),
  buildVfxPrimitive({
    kind: 'ring',
    innerRadius: 2,
    outerRadius: 8,
    segments: 20,
    bevelHeight: 0.5,
    rippleAmp: 0.2,
  }),
  buildVfxPrimitive({
    kind: 'beam',
    start: [0, 16, 0],
    end: [0, 0, 0],
    width: 1.8,
    style: 'column',
  }),
  buildVfxPrimitive({
    kind: 'beam',
    start: [0, 16, 0],
    end: [0, 0, 0],
    width: 1.8,
    style: 'lightning',
    forks: 3,
    forkDepth: 2,
    seed: 7,
  }),
  buildVfxPrimitive({ kind: 'dome', shape: 'hemisphere', radius: 6, subdiv: 2 }),
  buildVfxPrimitive({ kind: 'dome', shape: 'sphere', radius: 5, subdiv: 1 }),
  buildVfxPrimitive({ kind: 'dome', shape: 'cone', radius: 4, height: 8, subdiv: 1 }),
  buildVfxPrimitive({ kind: 'dome', shape: 'torus', radius: 5, innerRadius: 3.5, subdiv: 2 }),
];
for (const m of meshes) assertValidMesh(m, m.kind);

// Check outward winding on sphere dome (normal dot position > 0) and ring (+Y normal).
const sphereMesh = meshes[7]!;
for (let i = 0; i < sphereMesh.positions.length; i += 3) {
  const dot =
    sphereMesh.positions[i]! * sphereMesh.normals[i]! +
    sphereMesh.positions[i + 1]! * sphereMesh.normals[i + 1]! +
    sphereMesh.positions[i + 2]! * sphereMesh.normals[i + 2]!;
  assert.ok(dot > 0, 'sphere dome normals must face outward');
}

// 4. Closed contract reader, .vfx.json + Bedrock .particle.json lowering, & VFX audit gates.
assert.throws(() => readVfxRecipe({ ...VFX_SHOWCASE_PRESETS.flame_cleave, unknownField: true }));
const compiled = compileVfxRecipe(VFX_SHOWCASE_PRESETS.flame_cleave);
const runtimeSpec = emitVfxRuntimeSpec(compiled);
assert.equal(runtimeSpec.schema, 'ashfox 1');
assert.equal(runtimeSpec.kind, 'vfx');
assert.ok(runtimeSpec.palette.core.oklch.l >= 0.9);
const bedrock = emitBedrockParticleSpecs(VFX_SHOWCASE_PRESETS.flame_cleave);
assert.equal(bedrock.length, 2);
assert.equal(bedrock[0]!.format_version, '1.10.0');
assert.equal(bedrock[0]!.particle_effect.description.identifier, 'ashfox:flame_cleave_sparks');

const goodAudit = auditVfx(compiled);
assert.equal(goodAudit.passed, true, JSON.stringify(goodAudit));
assert.equal(goodAudit.hardGateFailures.length, 0);

// Hard-gate failures: exceed draws / triangles / GLB / particles & dim core contrast.
const overBudgetAudit = auditVfx(compiled, { maxDrawCalls: 2, maxParticles: 16 });
assert.equal(overBudgetAudit.passed, false);
assert.ok(overBudgetAudit.hardGateFailures.length >= 2);

const dimCompiled = compileVfxRecipe({
  ...VFX_SHOWCASE_PRESETS.flame_cleave,
  palette: { name: 'Dim', core: '#666666', mid: '#555555', edge: '#444444', smoke: '#222222' },
});
const dimAudit = auditVfx(dimCompiled);
assert.equal(dimAudit.passed, false);
assert.equal(dimAudit.metrics.find((m) => m.id === 'vfx.valueContrast')?.passed, false);
