import assert from 'node:assert/strict';
import { auditVfx } from '../../src/vfx/audit';
import { compileVfxRecipe } from '../../src/vfx/compile';
import {
  DEFAULT_VFX_BUDGET,
  type VfxEmitterShape,
  type VfxParticleShape,
} from '../../src/vfx/contract';
import { curlNoise3D } from '../../src/vfx/noise';
import { simulateVoxelBurst } from '../../src/vfx/particles';
import {
  VFX_PALETTES,
  VFX_SHOWCASE_PRESETS,
  type VfxShowcasePresetName,
} from '../../src/vfx/presets';
import { emitBedrockParticleSpecs, emitVfxRuntimeSpec } from '../../src/vfx/specEmit';

// 1. Seeded determinism & divergence-free 3D Curl-Noise check.
const curlA = curlNoise3D(1.2, 2.5, -0.7, 42);
const curlB = curlNoise3D(1.2, 2.5, -0.7, 42);
assert.deepEqual(curlA, curlB);
const eps = 1e-4;
const dCx =
  (curlNoise3D(1.2 + eps, 2.5, -0.7, 42)[0] - curlNoise3D(1.2 - eps, 2.5, -0.7, 42)[0]) / (2 * eps);
const dCy =
  (curlNoise3D(1.2, 2.5 + eps, -0.7, 42)[1] - curlNoise3D(1.2, 2.5 - eps, -0.7, 42)[1]) / (2 * eps);
const dCz =
  (curlNoise3D(1.2, 2.5, -0.7 + eps, 42)[2] - curlNoise3D(1.2, 2.5, -0.7 - eps, 42)[2]) / (2 * eps);
assert.ok(
  Math.abs(dCx + dCy + dCz) < 0.05,
  `curl field should be nearly divergence-free, got ${dCx + dCy + dCz}`,
);

// 2. Particle simulation determinism, curl + vortex + ground bounce, STEP birth/death scaling.
const bounceSpec = {
  id: 'bounce_test',
  startTime: 0.1,
  endTime: 0.9,
  seed: 777,
  count: 16,
  shape: 'cone' as const,
  shapeParams: { angleDeg: 35, radius: 1.5, offset: [0, 3, 0] as const },
  particle: 'voxel_cube' as const,
  speedMin: 8,
  speedMax: 14,
  lifeMin: 0.4,
  lifeMax: 0.7,
  gravity: -40,
  drag: 0.6,
  turbulence: { mode: 'curl' as const, freq: 0.5, amp: 12 },
  vortex: { axis: [0, 1, 0] as const, center: [0, 0, 0] as const, strength: 15, radialPull: 1.5 },
  ground: { y: 0, bounce: 0.55, friction: 0.7 },
  sizeOverLife: [
    { t: 0, value: 1.1 },
    { t: 0.6, value: 0.8 },
    { t: 1, value: 0.2 },
  ],
  colorOverLife: ['core', 'mid', 'edge'] as const,
  velocityStretch: 1.2,
  spinSpeedDeg: 180,
};

const burst1 = simulateVoxelBurst(bounceSpec, VFX_PALETTES.EmberSolar, 1.0);
const burst2 = simulateVoxelBurst(bounceSpec, VFX_PALETTES.EmberSolar, 1.0);
const burstAlt = simulateVoxelBurst({ ...bounceSpec, seed: 778 }, VFX_PALETTES.EmberSolar, 1.0);
assert.deepEqual(burst1, burst2);
assert.notDeepEqual(burst1.tracks[0]!.position, burstAlt.tracks[0]!.position);
assert.equal(burst1.drawCalls, 1);
assert.equal(burst1.particleCount, 16);

let sawGroundRebound = false;
for (const tr of burst1.tracks) {
  assert.equal(tr.scale.interpolation, 'STEP');
  if (tr.birthTime > 1e-4) {
    assert.deepEqual(tr.scale.values[0], [0, 0, 0], 'pre-birth STEP scale must be (0,0,0)');
  }
  const lastScale = tr.scale.values[tr.scale.values.length - 1];
  assert.deepEqual(lastScale, [0, 0, 0], 'death STEP scale must be (0,0,0)');
  assert.ok(
    tr.position.times.length < 70,
    `RDP should compress 120Hz track, got ${tr.position.times.length}`,
  );
  for (let i = 1; i < tr.position.values.length - 1; i += 1) {
    const yPrev = tr.position.values[i - 1]![1];
    const yCur = tr.position.values[i]![1];
    const yNext = tr.position.values[i + 1]![1];
    assert.ok(yCur >= -1e-4, `particle must stay on/above ground y=0, got ${yCur}`);
    if (yPrev > 0.05 && yCur <= 0.15 && yNext > yCur) sawGroundRebound = true;
  }
}
assert.ok(sawGroundRebound, 'at least one particle should bounce upward off ground plane');

// 3. All 4 particle shapes and 6 emitter shapes compile cleanly.
const particleShapes: readonly VfxParticleShape[] = ['voxel_cube', 'shard', 'puff', 'cross_card'];
const emitterShapes: readonly VfxEmitterShape[] = ['point', 'cone', 'sphere', 'ring', 'box', 'arc'];
for (let i = 0; i < emitterShapes.length; i += 1) {
  const b = simulateVoxelBurst(
    {
      ...bounceSpec,
      shape: emitterShapes[i]!,
      particle: particleShapes[i % particleShapes.length]!,
      count: 6,
    },
    VFX_PALETTES.StormCyan,
    1.0,
  );
  assert.equal(b.particleCount, 6);
  assert.ok(b.sharedMesh.triangleCount >= 4);
}

// 4. All 4 showcase presets pass VFX quality audit & runtime hard gates.
const presetNames: readonly VfxShowcasePresetName[] = [
  'flame_cleave',
  'arcane_shockwave',
  'lightning_strike',
  'hearth_embers',
];
for (const name of presetNames) {
  const recipe = VFX_SHOWCASE_PRESETS[name];
  const compiled = compileVfxRecipe(recipe);
  const compiledAgain = compileVfxRecipe(recipe);
  assert.deepEqual(compiled, compiledAgain, `${name} compile must be deterministic`);

  assert.ok(compiled.stats.drawCalls <= DEFAULT_VFX_BUDGET.maxDrawCalls, `${name} drawCalls`);
  assert.ok(compiled.stats.triangles <= DEFAULT_VFX_BUDGET.maxTriangles, `${name} triangles`);
  assert.ok(
    compiled.stats.estimatedGlbBytes <= DEFAULT_VFX_BUDGET.maxEstimatedGlbBytes,
    `${name} estGLB`,
  );
  assert.ok(compiled.stats.particleCount <= DEFAULT_VFX_BUDGET.maxParticles, `${name} particles`);

  const report = auditVfx(compiled);
  assert.equal(report.passed, true, `${name} audit failed: ${JSON.stringify(report)}`);
  assert.equal(report.hardGateFailures.length, 0);

  const spec = emitVfxRuntimeSpec(compiled);
  assert.equal(spec.name, name);
  const bedrock = emitBedrockParticleSpecs(recipe);
  assert.equal(bedrock.length, recipe.emitters.length);
}
