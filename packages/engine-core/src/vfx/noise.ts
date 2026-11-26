import type { Vec3 } from '../model/identity';

/** Deterministic seeded PRNG returning values in [0, 1). */
export const createSeededRng = (seed: number): (() => number) => {
  let state = seed >>> 0 || 1;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const hashInt3 = (x: number, y: number, z: number, seed: number): number => {
  let h = (seed ^ Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 2147483647)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
};

const smoothstep = (t: number): number => t * t * (3 - 2 * t);
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Smooth 2D value noise in [0, 1]. */
export const noise2D = (x: number, y: number, seed: number): number => {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = smoothstep(x - ix);
  const fy = smoothstep(y - iy);
  const n00 = hashInt3(ix, iy, 0, seed);
  const n10 = hashInt3(ix + 1, iy, 0, seed);
  const n01 = hashInt3(ix, iy + 1, 0, seed);
  const n11 = hashInt3(ix + 1, iy + 1, 0, seed);
  return lerp(lerp(n00, n10, fx), lerp(n01, n11, fx), fy);
};

/** 2D fractal Brownian motion noise in [0, 1]. */
export const fbm2D = (x: number, y: number, seed: number, octaves = 3): number => {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let freq = 1;
  for (let i = 0; i < octaves; i += 1) {
    sum += noise2D(x * freq, y * freq, seed + i * 101) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2.03;
  }
  return norm > 0 ? sum / norm : 0;
};

/** Deterministic 2D Voronoi normalized distance F1 in [0, 1]. */
export const voronoi2D = (x: number, y: number, seed: number): number => {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  let minDist = 4;
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      const cx = ix + dx;
      const cy = iy + dy;
      const px = cx + hashInt3(cx, cy, 17, seed);
      const py = cy + hashInt3(cx, cy, 53, seed);
      const dist = Math.hypot(px - x, py - y);
      if (dist < minDist) minDist = dist;
    }
  }
  return Math.min(1, minDist / 1.25);
};

/** Smooth 3D value noise in [-1, 1]. */
export const noise3D = (x: number, y: number, z: number, seed: number): number => {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  const fx = smoothstep(x - ix);
  const fy = smoothstep(y - iy);
  const fz = smoothstep(z - iz);
  const c000 = hashInt3(ix, iy, iz, seed);
  const c100 = hashInt3(ix + 1, iy, iz, seed);
  const c010 = hashInt3(ix, iy + 1, iz, seed);
  const c110 = hashInt3(ix + 1, iy + 1, iz, seed);
  const c001 = hashInt3(ix, iy, iz + 1, seed);
  const c101 = hashInt3(ix + 1, iy, iz + 1, seed);
  const c011 = hashInt3(ix, iy + 1, iz + 1, seed);
  const c111 = hashInt3(ix + 1, iy + 1, iz + 1, seed);
  const x00 = lerp(c000, c100, fx);
  const x10 = lerp(c010, c110, fx);
  const x01 = lerp(c001, c101, fx);
  const x11 = lerp(c011, c111, fx);
  return lerp(lerp(x00, x10, fy), lerp(x01, x11, fy), fz) * 2 - 1;
};

const potential3D = (x: number, y: number, z: number, seed: number): Vec3 => [
  noise3D(x, y, z, seed),
  noise3D(x + 19.3, y + 7.1, z + 31.7, seed + 131),
  noise3D(x + 41.9, y + 53.2, z + 11.4, seed + 263),
];

/** Divergence-free 3D Curl-Noise turbulence field using central finite differences. */
export const curlNoise3D = (x: number, y: number, z: number, seed: number): Vec3 => {
  const eps = 0.02;
  const inv2Eps = 1 / (2 * eps);
  const px1 = potential3D(x + eps, y, z, seed);
  const px0 = potential3D(x - eps, y, z, seed);
  const py1 = potential3D(x, y + eps, z, seed);
  const py0 = potential3D(x, y - eps, z, seed);
  const pz1 = potential3D(x, y, z + eps, seed);
  const pz0 = potential3D(x, y, z - eps, seed);
  const dPzDy = (py1[2] - py0[2]) * inv2Eps;
  const dPyDz = (pz1[1] - pz0[1]) * inv2Eps;
  const dPxDz = (pz1[0] - pz0[0]) * inv2Eps;
  const dPzDx = (px1[2] - px0[2]) * inv2Eps;
  const dPyDx = (px1[1] - px0[1]) * inv2Eps;
  const dPxDy = (py1[0] - py0[0]) * inv2Eps;
  return [dPzDy - dPyDz, dPxDz - dPzDx, dPyDx - dPxDy];
};
