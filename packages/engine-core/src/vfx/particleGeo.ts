import { normalize3, scale3 } from '../math/vec3';
import type { Vec3 } from '../model/identity';
import type {
  CompiledVfxElement,
  VfxCurveEasing,
  VfxLifeStop,
  VfxParticleShape,
  VfxPrimitiveMesh,
  VfxQuat,
} from './contract';
import {
  addFacetedQuad,
  buildFrameFromTangent,
  createMeshDraft,
  faceNormal,
  finalizeMesh,
  pushTri,
  pushVertex,
  type MeshDraft,
} from './primMesh';

const buildVoxelCubeMesh = (): VfxPrimitiveMesh => {
  const draft = createMeshDraft();
  const h = 0.5;
  const faces: readonly [Vec3, Vec3, Vec3, Vec3][] = [
    [
      [-h, -h, h],
      [h, -h, h],
      [h, h, h],
      [-h, h, h],
    ],
    [
      [h, -h, -h],
      [-h, -h, -h],
      [-h, h, -h],
      [h, h, -h],
    ],
    [
      [h, -h, h],
      [h, -h, -h],
      [h, h, -h],
      [h, h, h],
    ],
    [
      [-h, -h, -h],
      [-h, -h, h],
      [-h, h, h],
      [-h, h, -h],
    ],
    [
      [-h, h, h],
      [h, h, h],
      [h, h, -h],
      [-h, h, -h],
    ],
    [
      [-h, -h, -h],
      [h, -h, -h],
      [h, -h, h],
      [-h, -h, h],
    ],
  ];
  for (const [p0, p1, p2, p3] of faces) {
    addFacetedQuad(draft, p0, p1, p2, p3, [0, 0], [1, 0], [1, 1], [0, 1]);
  }
  return finalizeMesh('dome', draft);
};

const buildShardMesh = (): VfxPrimitiveMesh => {
  const draft = createMeshDraft();
  const tipTop: Vec3 = [0, 0.85, 0];
  const tipBot: Vec3 = [0, -0.45, 0];
  const ring: readonly Vec3[] = [
    [0, 0, 0.28],
    [0.28, 0, 0],
    [0, 0, -0.28],
    [-0.28, 0, 0],
  ];
  for (let i = 0; i < 4; i += 1) {
    const a = ring[i]!;
    const b = ring[(i + 1) % 4]!;
    const nTop = faceNormal(a, b, tipTop);
    const i0 = pushVertex(draft, a, nTop, i / 4, 0.5);
    const i1 = pushVertex(draft, b, nTop, (i + 1) / 4, 0.5);
    const i2 = pushVertex(draft, tipTop, nTop, (i + 0.5) / 4, 1);
    pushTri(draft, i0, i1, i2);
    const nBot = faceNormal(b, a, tipBot);
    const j0 = pushVertex(draft, b, nBot, (i + 1) / 4, 0.5);
    const j1 = pushVertex(draft, a, nBot, i / 4, 0.5);
    const j2 = pushVertex(draft, tipBot, nBot, (i + 0.5) / 4, 0);
    pushTri(draft, j0, j1, j2);
  }
  return finalizeMesh('dome', draft);
};

const buildPuffMesh = (): VfxPrimitiveMesh => {
  const draft = createMeshDraft();
  const pts: readonly Vec3[] = [
    [1, 0, 0],
    [-1, 0, 0],
    [0, 1, 0],
    [0, -1, 0],
    [0, 0, 1],
    [0, 0, -1],
  ];
  const tris: readonly [number, number, number][] = [
    [4, 0, 2],
    [0, 5, 2],
    [5, 1, 2],
    [1, 4, 2],
    [0, 4, 3],
    [5, 0, 3],
    [1, 5, 3],
    [4, 1, 3],
  ];
  for (const [ia, ib, ic] of tris) {
    const a = scale3(pts[ia]!, 0.55);
    const b = scale3(pts[ib]!, 0.55);
    const c = scale3(pts[ic]!, 0.55);
    const n = faceNormal(a, b, c);
    const v0 = pushVertex(draft, a, n, 0, 0);
    const v1 = pushVertex(draft, b, n, 1, 0);
    const v2 = pushVertex(draft, c, n, 0.5, 1);
    pushTri(draft, v0, v1, v2);
  }
  return finalizeMesh('dome', draft);
};

const buildCrossCardMesh = (): VfxPrimitiveMesh => {
  const draft: MeshDraft = createMeshDraft();
  const h = 0.5;
  addFacetedQuad(
    draft,
    [-h, -h, 0],
    [h, -h, 0],
    [h, h, 0],
    [-h, h, 0],
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  );
  addFacetedQuad(
    draft,
    [0, -h, h],
    [0, -h, -h],
    [0, h, -h],
    [0, h, h],
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  );
  return finalizeMesh('dome', draft);
};

/** Build the single shared low-poly mesh for a particle shape (1 draw call for all particles). */
export const buildSharedParticleMesh = (shape: VfxParticleShape): VfxPrimitiveMesh => {
  switch (shape) {
    case 'voxel_cube':
      return buildVoxelCubeMesh();
    case 'shard':
      return buildShardMesh();
    case 'puff':
      return buildPuffMesh();
    case 'cross_card':
      return buildCrossCardMesh();
  }
};

const applyEasing = (t: number, easing: VfxCurveEasing | undefined): number => {
  const u = t < 0 ? 0 : t > 1 ? 1 : t;
  if (easing === 'ease_out') return 1 - (1 - u) * (1 - u);
  if (easing === 'ease_in') return u * u;
  if (easing === 'snap') return Math.pow(u, 0.38);
  return u;
};

/** Evaluate a piecewise scalar life curve over normalized age t in [0, 1]. */
export const evalScalarLifeCurve = (stops: readonly VfxLifeStop<number>[], t: number): number => {
  if (stops.length === 0) return 1;
  if (stops.length === 1) return stops[0]!.value;
  const u = t < 0 ? 0 : t > 1 ? 1 : t;
  if (u <= stops[0]!.t) return stops[0]!.value;
  for (let i = 0; i < stops.length - 1; i += 1) {
    const a = stops[i]!;
    const b = stops[i + 1]!;
    if (u <= b.t) {
      const span = Math.max(1e-6, b.t - a.t);
      const frac = applyEasing((u - a.t) / span, b.easing ?? a.easing);
      return a.value + (b.value - a.value) * frac;
    }
  }
  return stops[stops.length - 1]!.value;
};

const matrixToQuat = (
  m00: number,
  m01: number,
  m02: number,
  m10: number,
  m11: number,
  m12: number,
  m20: number,
  m21: number,
  m22: number,
): VfxQuat => {
  const trace = m00 + m11 + m22;
  let qx = 0;
  let qy = 0;
  let qz = 0;
  let qw = 1;
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2;
    qw = 0.25 * s;
    qx = (m21 - m12) / s;
    qy = (m02 - m20) / s;
    qz = (m10 - m01) / s;
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    qw = (m21 - m12) / s;
    qx = 0.25 * s;
    qy = (m01 + m10) / s;
    qz = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    qw = (m02 - m20) / s;
    qx = (m01 + m10) / s;
    qy = 0.25 * s;
    qz = (m12 + m21) / s;
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    qw = (m10 - m01) / s;
    qx = (m02 + m20) / s;
    qy = (m12 + m21) / s;
    qz = 0.25 * s;
  }
  const len = Math.hypot(qx, qy, qz, qw) || 1;
  return [qx / len, qy / len, qz / len, qw / len];
};

/** Clean axis-aligned +Y to `dir` quaternion with axial spin around `dir`. */
export const orientationQuat = (dir: Vec3, spinRad: number): VfxQuat => {
  const up = normalize3(dir);
  const frame = buildFrameFromTangent(up);
  const c = Math.cos(spinRad);
  const s = Math.sin(spinRad);
  const rx = frame.normal[0] * c + frame.binormal[0] * s;
  const ry = frame.normal[1] * c + frame.binormal[1] * s;
  const rz = frame.normal[2] * c + frame.binormal[2] * s;
  const bx = up[1] * rz - up[2] * ry;
  const by = up[2] * rx - up[0] * rz;
  const bz = up[0] * ry - up[1] * rx;
  return matrixToQuat(rx, up[0], bx, ry, up[1], by, rz, up[2], bz);
};

export const clampUnit = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

export const scaleStopsToTrack = (
  el: CompiledVfxElement,
  duration: number,
): { readonly times: number[]; readonly values: number[] } => {
  const stops: readonly VfxLifeStop<number>[] =
    el.scaleCurve.length > 0
      ? el.scaleCurve
      : [
          { t: 0, value: 0.7 },
          { t: 0.4, value: 1 },
          { t: 1, value: 1.15 },
        ];
  const times: number[] = [];
  const values: number[] = [];
  const span = Math.max(0.01, el.endTime - el.startTime);
  if (el.startTime > 0.001) {
    times.push(0, Math.max(0, el.startTime - 0.001));
    values.push(0, 0, 0, 0, 0, 0);
  }
  for (const stop of stops) {
    const t = Number((el.startTime + stop.t * span).toFixed(4));
    if (times.length > 0 && t <= times[times.length - 1]!) continue;
    times.push(t);
    const s = Math.max(0.0001, stop.value);
    values.push(s, s, s);
  }
  if (el.endTime < duration - 0.001) {
    times.push(Number((el.endTime + 0.001).toFixed(4)), duration);
    values.push(0, 0, 0, 0, 0, 0);
  }
  return { times, values };
};

export const analyzeAlphaCurve = (
  stops: readonly VfxLifeStop<number>[],
): { readonly varies: boolean; readonly midAlpha: number } => {
  const probeTs = [0, 0.25, 0.5, 0.75, 1, ...stops.map((s) => s.t)];
  let minA = 1;
  let maxA = 0;
  for (const t of probeTs) {
    const a = clampUnit(evalScalarLifeCurve(stops, t));
    if (a < minA) minA = a;
    if (a > maxA) maxA = a;
  }
  return { varies: maxA - minA > 0.02, midAlpha: (minA + maxA) * 0.5 };
};

export const computeDissolveCellUvs = (el: CompiledVfxElement, frame: number): number[] => {
  const atlas = el.dissolveAtlas!;
  const col = frame % atlas.columns;
  const row = Math.floor(frame / atlas.columns);
  const cellUvs: number[] = [];
  for (let i = 0; i < el.mesh.uvs.length; i += 2) {
    cellUvs.push((col + el.mesh.uvs[i]!) / atlas.columns, (row + el.mesh.uvs[i + 1]!) / atlas.rows);
  }
  return cellUvs;
};

export const selectStageColorIndices = (count: number): readonly number[] => {
  if (count <= 1) return [0];
  const stages = Math.min(3, count);
  return Array.from({ length: stages }, (_, k) => Math.round((k / (stages - 1)) * (count - 1)));
};
