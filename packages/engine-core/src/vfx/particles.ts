import { add3, cross3, length3, normalize3, scale3, sub3 } from '../math/vec3';
import type { Vec3 } from '../model/identity';
import type {
  VfxBakedBurst,
  VfxEmitterSpec,
  VfxPalette,
  VfxParticleTrack,
  VfxQuat,
} from './contract';
import { createSeededRng, curlNoise3D } from './noise';
import { samplePaletteRampHex } from './oklch';
import { buildSharedParticleMesh, evalScalarLifeCurve, orientationQuat } from './particleGeo';
import { rdpSimplifyQuat, rdpSimplifyVec3 } from './rdp';

const SIM_HZ = 120;
const SIM_DT = 1 / SIM_HZ;

interface SpawnState {
  readonly pos: Vec3;
  readonly vel: Vec3;
}

const randomUnitVec3 = (rng: () => number): Vec3 => {
  const z = rng() * 2 - 1;
  const theta = rng() * Math.PI * 2;
  const r = Math.sqrt(Math.max(0, 1 - z * z));
  return [r * Math.cos(theta), z, r * Math.sin(theta)];
};

const spawnCone = (spec: VfxEmitterSpec, speed: number, rng: () => number): SpawnState => {
  const p = spec.shapeParams;
  const radius = (p?.radius ?? 1) * Math.sqrt(rng());
  const phi = rng() * Math.PI * 2;
  const maxTilt = ((p?.angleDeg ?? 35) * Math.PI) / 180;
  const tilt = maxTilt * Math.sqrt(rng());
  const dir: Vec3 = [
    Math.sin(tilt) * Math.cos(phi),
    Math.cos(tilt),
    Math.sin(tilt) * Math.sin(phi),
  ];
  return {
    pos: [radius * Math.cos(phi), 0, radius * Math.sin(phi)],
    vel: scale3(dir, speed),
  };
};

const spawnRingOrArc = (
  spec: VfxEmitterSpec,
  speed: number,
  rng: () => number,
  isArc: boolean,
): SpawnState => {
  const p = spec.shapeParams;
  const rIn = p?.innerRadius ?? (p?.radius ?? 4) * 0.85;
  const rOut = p?.radius ?? 4;
  const r = rIn + (rOut - rIn) * rng();
  const sweep = isArc ? ((p?.sweepDeg ?? 120) * Math.PI) / 180 : Math.PI * 2;
  const theta = (rng() - (isArc ? 0.5 : 0)) * sweep;
  const radial: Vec3 = [Math.cos(theta), 0.15 + rng() * 0.35, Math.sin(theta)];
  return {
    pos: [r * Math.cos(theta), 0, r * Math.sin(theta)],
    vel: scale3(normalize3(radial), speed),
  };
};

const sampleSpawn = (spec: VfxEmitterSpec, rng: () => number): SpawnState => {
  const speed = spec.speedMin + (spec.speedMax - spec.speedMin) * rng();
  const off = spec.shapeParams?.offset ?? [0, 0, 0];
  let raw: SpawnState;
  if (spec.shape === 'cone') raw = spawnCone(spec, speed, rng);
  else if (spec.shape === 'sphere') {
    const dir = randomUnitVec3(rng);
    const r = (spec.shapeParams?.radius ?? 1) * Math.cbrt(rng());
    raw = { pos: scale3(dir, r), vel: scale3(dir, speed) };
  } else if (spec.shape === 'ring') raw = spawnRingOrArc(spec, speed, rng, false);
  else if (spec.shape === 'arc') raw = spawnRingOrArc(spec, speed, rng, true);
  else if (spec.shape === 'box') {
    const sz = spec.shapeParams?.size ?? [2, 2, 2];
    raw = {
      pos: [(rng() - 0.5) * sz[0], (rng() - 0.5) * sz[1], (rng() - 0.5) * sz[2]],
      vel: scale3(randomUnitVec3(rng), speed),
    };
  } else {
    raw = { pos: [0, 0, 0], vel: scale3(randomUnitVec3(rng), speed) };
  }
  return { pos: add3(raw.pos, off), vel: raw.vel };
};

const stepVelocityForces = (
  pos: Vec3,
  vel: Vec3,
  spec: VfxEmitterSpec,
  dt: number,
  seed: number,
): Vec3 => {
  let vx = vel[0];
  let vy = vel[1] + spec.gravity * dt;
  let vz = vel[2];
  if (spec.turbulence) {
    const freq = spec.turbulence.freq;
    const curl = curlNoise3D(pos[0] * freq, pos[1] * freq, pos[2] * freq, seed);
    vx += curl[0] * spec.turbulence.amp * dt;
    vy += curl[1] * spec.turbulence.amp * dt;
    vz += curl[2] * spec.turbulence.amp * dt;
  }
  if (spec.vortex) {
    const offset = sub3(pos, spec.vortex.center);
    const axis = normalize3(spec.vortex.axis);
    const tangent = normalize3(cross3(axis, offset));
    const pull = spec.vortex.radialPull ?? 0;
    vx += (tangent[0] * spec.vortex.strength - offset[0] * pull) * dt;
    vy += (tangent[1] * spec.vortex.strength - offset[1] * pull) * dt;
    vz += (tangent[2] * spec.vortex.strength - offset[2] * pull) * dt;
  }
  const damp = Math.max(0, 1 - spec.drag * dt);
  return [vx * damp, vy * damp, vz * damp];
};

const stepParticleKinematics = (
  pos: Vec3,
  vel: Vec3,
  spec: VfxEmitterSpec,
  dt: number,
  seed: number,
): SpawnState => {
  let nextVel = stepVelocityForces(pos, vel, spec, dt, seed);
  let nextPos: Vec3 = [
    pos[0] + nextVel[0] * dt,
    pos[1] + nextVel[1] * dt,
    pos[2] + nextVel[2] * dt,
  ];
  if (spec.ground && nextPos[1] <= spec.ground.y && nextVel[1] < 0) {
    nextPos = [nextPos[0], spec.ground.y, nextPos[2]];
    nextVel = [
      nextVel[0] * spec.ground.friction,
      -nextVel[1] * spec.ground.bounce,
      nextVel[2] * spec.ground.friction,
    ];
  }
  return { pos: nextPos, vel: nextVel };
};

interface SampleBuffers {
  readonly times: number[];
  readonly pos: Vec3[];
  readonly rot: VfxQuat[];
  readonly scl: Vec3[];
}

const buildScaleVec = (baseSize: number, speed: number, stretch: number): Vec3 => {
  const s = Math.max(0.001, baseSize);
  const longScale = s * (1 + Math.min(2.5, speed * stretch * 0.04));
  return [s, longScale, s];
};

const padScalarStepBounds = (
  times: readonly number[],
  values: readonly Vec3[],
  birthTime: number,
  deathTime: number,
  duration: number,
): { readonly times: readonly number[]; readonly values: readonly Vec3[] } => {
  const outTimes = [...times];
  const outValues = [...values];
  if (birthTime > 1e-4) {
    const preBirth = Math.fround(Math.max(0, birthTime - 1e-4));
    if (preBirth > 0 && Math.fround(outTimes[0] ?? birthTime) > preBirth) {
      outTimes.unshift(0, preBirth);
      outValues.unshift([0, 0, 0], [0, 0, 0]);
    } else if (Math.fround(outTimes[0] ?? birthTime) > 0) {
      outTimes.unshift(0);
      outValues.unshift([0, 0, 0]);
    }
  }
  const endT = Math.min(duration, deathTime);
  const lastT = outTimes[outTimes.length - 1] ?? 0;
  if (Math.fround(endT) <= Math.fround(lastT)) {
    outValues[outValues.length - 1] = [0, 0, 0];
  } else {
    outTimes.push(endT);
    outValues.push([0, 0, 0]);
  }
  const tailT = outTimes[outTimes.length - 1] ?? 0;
  if (Math.fround(tailT) < Math.fround(duration)) {
    outTimes.push(duration);
    outValues.push([0, 0, 0]);
  }
  return { times: outTimes, values: outValues };
};

const padVec3HoldBounds = <T>(
  times: readonly number[],
  values: readonly T[],
  birthTime: number,
  deathTime: number,
  duration: number,
): { readonly times: readonly number[]; readonly values: readonly T[] } => {
  const outTimes = [...times];
  const outValues = [...values];
  if (birthTime > 1e-4 && Math.fround(outTimes[0] ?? birthTime) > 0) {
    outTimes.unshift(0);
    outValues.unshift(outValues[0]!);
  }
  const lastT = outTimes[outTimes.length - 1] ?? 0;
  if (deathTime < duration - 1e-4 && Math.fround(duration) > Math.fround(lastT)) {
    outTimes.push(duration);
    outValues.push(outValues[outValues.length - 1]!);
  }
  return { times: outTimes, values: outValues };
};

const sampleParticleActiveLife = (
  particleIndex: number,
  spec: VfxEmitterSpec,
  birthTime: number,
  deathTime: number,
  rng: () => number,
): SampleBuffers => {
  const spawn = sampleSpawn(spec, rng);
  let pos = spawn.pos;
  let vel = spawn.vel;
  const buffers: SampleBuffers = { times: [], pos: [], rot: [], scl: [] };
  const spinVel = ((spec.spinSpeedDeg ?? 0) * (rng() > 0.5 ? 1 : -1) * Math.PI) / 180;
  const stretch = spec.velocityStretch ?? 0;
  const steps = Math.max(2, Math.ceil((deathTime - birthTime) * SIM_HZ));
  for (let s = 0; s <= steps; s += 1) {
    const u = s / steps;
    const t = birthTime + (deathTime - birthTime) * u;
    const size = evalScalarLifeCurve(spec.sizeOverLife, u);
    const speed = length3(vel);
    buffers.times.push(t);
    buffers.pos.push(pos);
    buffers.rot.push(orientationQuat(speed > 1e-4 ? vel : [0, 1, 0], spinVel * (t - birthTime)));
    buffers.scl.push(buildScaleVec(size, speed, stretch));
    if (s < steps) {
      const next = stepParticleKinematics(pos, vel, spec, SIM_DT, spec.seed + particleIndex * 17);
      pos = next.pos;
      vel = next.vel;
    }
  }
  return buffers;
};

const simulateOneParticle = (
  particleIndex: number,
  spec: VfxEmitterSpec,
  duration: number,
  rng: () => number,
): VfxParticleTrack => {
  const spawnWindow = Math.max(0, spec.endTime - spec.startTime - spec.lifeMin);
  const birthTime = Math.min(duration, spec.startTime + rng() * Math.max(0, spawnWindow * 0.45));
  const life = spec.lifeMin + (spec.lifeMax - spec.lifeMin) * rng();
  const deathTime = Math.min(duration, birthTime + life);
  const buffers = sampleParticleActiveLife(particleIndex, spec, birthTime, deathTime, rng);
  const pRdp = rdpSimplifyVec3(buffers.times, buffers.pos, 0.015);
  const rRdp = rdpSimplifyQuat(buffers.times, buffers.rot, 1.5);
  const sRdp = rdpSimplifyVec3(buffers.times, buffers.scl, 0.01);
  const posTrack = padVec3HoldBounds(pRdp.times, pRdp.values, birthTime, deathTime, duration);
  const rotTrack = padVec3HoldBounds(rRdp.times, rRdp.values, birthTime, deathTime, duration);
  const sclTrack = padScalarStepBounds(sRdp.times, sRdp.values, birthTime, deathTime, duration);
  return Object.freeze({
    particleIndex,
    birthTime,
    deathTime,
    position: Object.freeze({
      times: posTrack.times,
      values: posTrack.values,
      interpolation: 'LINEAR' as const,
    }),
    rotation: Object.freeze({
      times: rotTrack.times,
      values: rotTrack.values,
      interpolation: 'LINEAR' as const,
    }),
    scale: Object.freeze({
      times: sclTrack.times,
      values: sclTrack.values,
      interpolation: 'STEP' as const,
    }),
  });
};

const computeBurstBounds = (tracks: readonly VfxParticleTrack[]): { min: Vec3; max: Vec3 } => {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (const track of tracks) {
    for (const p of track.position.values) {
      minX = Math.min(minX, p[0]);
      minY = Math.min(minY, p[1]);
      minZ = Math.min(minZ, p[2]);
      maxX = Math.max(maxX, p[0]);
      maxY = Math.max(maxY, p[1]);
      maxZ = Math.max(maxZ, p[2]);
    }
  }
  return {
    min: Number.isFinite(minX) ? [minX, minY, minZ] : [0, 0, 0],
    max: Number.isFinite(maxX) ? [maxX, maxY, maxZ] : [0, 0, 0],
  };
};

/**
 * Simulate and bake a seeded deterministic 120Hz 3D `voxel_burst` particle emitter
 * into 1 shared low-poly mesh + OKLCH palette + RDP-compressed transform tracks.
 */
export const simulateVoxelBurst = (
  spec: VfxEmitterSpec,
  palette: VfxPalette,
  durationSeconds: number,
): VfxBakedBurst => {
  const rng = createSeededRng(spec.seed);
  const count = Math.max(1, Math.min(64, Math.round(spec.count)));
  const sharedMesh = buildSharedParticleMesh(spec.particle);
  const tracks: VfxParticleTrack[] = [];
  for (let i = 0; i < count; i += 1) {
    tracks.push(simulateOneParticle(i, spec, durationSeconds, rng));
  }
  const rampColors: string[] = [];
  const stops = Math.max(2, spec.colorOverLife.length * 2);
  for (let i = 0; i < stops; i += 1) {
    rampColors.push(samplePaletteRampHex(palette, spec.colorOverLife, i / (stops - 1)));
  }
  const bounds = computeBurstBounds(tracks);
  return Object.freeze({
    id: spec.id,
    particleShape: spec.particle,
    blendMode: spec.blendMode ?? 'additive',
    sharedMesh,
    paletteColors: Object.freeze(rampColors),
    particleCount: count,
    drawCalls: 1,
    tracks: Object.freeze(tracks),
    boundsMin: bounds.min,
    boundsMax: bounds.max,
  });
};
