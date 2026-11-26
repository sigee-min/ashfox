import { add3, cross3, normalize3, scale3, sub3 } from '../math/vec3';
import type { Vec3 } from '../model/identity';
import type { VfxDomeSpec, VfxPrimitiveKind, VfxPrimitiveMesh } from './contract';

export interface MeshDraft {
  readonly positions: number[];
  readonly normals: number[];
  readonly uvs: number[];
  readonly indices: number[];
}

export const createMeshDraft = (): MeshDraft => ({
  positions: [],
  normals: [],
  uvs: [],
  indices: [],
});

export const pushVertex = (
  draft: MeshDraft,
  pos: Vec3,
  normal: Vec3,
  u: number,
  v: number,
): number => {
  const idx = draft.positions.length / 3;
  draft.positions.push(pos[0], pos[1], pos[2]);
  draft.normals.push(normal[0], normal[1], normal[2]);
  draft.uvs.push(u, v);
  return idx;
};

export const pushTri = (draft: MeshDraft, a: number, b: number, c: number): void => {
  draft.indices.push(a, b, c);
};

export const pushQuad = (draft: MeshDraft, a: number, b: number, c: number, d: number): void => {
  draft.indices.push(a, b, c, a, c, d);
};

export const faceNormal = (a: Vec3, b: Vec3, c: Vec3): Vec3 =>
  normalize3(cross3(sub3(b, a), sub3(c, a)));

/** Build an X-crossed or 2-strip quad segment between two 3D spine frames. */
export const addCrossedSegmentQuad = (
  draft: MeshDraft,
  p0: Vec3,
  p1: Vec3,
  axis0: Vec3,
  axis1: Vec3,
  u0: number,
  u1: number,
): void => {
  const a0 = sub3(p0, axis0);
  const b0 = add3(p0, axis0);
  const b1 = add3(p1, axis1);
  const a1 = sub3(p1, axis1);
  const n = faceNormal(a0, a1, b1);
  const i0 = pushVertex(draft, a0, n, u0, 0);
  const i1 = pushVertex(draft, a1, n, u1, 0);
  const i2 = pushVertex(draft, b1, n, u1, 1);
  const i3 = pushVertex(draft, b0, n, u0, 1);
  pushQuad(draft, i0, i1, i2, i3);
};

/** Build a single faceted quad from 4 vertices with computed outward normal. */
export const addFacetedQuad = (
  draft: MeshDraft,
  p0: Vec3,
  p1: Vec3,
  p2: Vec3,
  p3: Vec3,
  uv0: readonly [number, number],
  uv1: readonly [number, number],
  uv2: readonly [number, number],
  uv3: readonly [number, number],
): void => {
  const n = faceNormal(p0, p1, p2);
  const i0 = pushVertex(draft, p0, n, uv0[0], uv0[1]);
  const i1 = pushVertex(draft, p1, n, uv1[0], uv1[1]);
  const i2 = pushVertex(draft, p2, n, uv2[0], uv2[1]);
  const i3 = pushVertex(draft, p3, n, uv3[0], uv3[1]);
  pushQuad(draft, i0, i1, i2, i3);
};

/** Build an orthonormal frame (tangent, normal, binormal) from a direction vector. */
export const buildFrameFromTangent = (
  tangent: Vec3,
  prevNormal?: Vec3,
): { readonly tangent: Vec3; readonly normal: Vec3; readonly binormal: Vec3 } => {
  const t = normalize3(tangent);
  if (prevNormal !== undefined) {
    const projected = sub3(
      prevNormal,
      scale3(t, prevNormal[0] * t[0] + prevNormal[1] * t[1] + prevNormal[2] * t[2]),
    );
    const len = Math.hypot(projected[0], projected[1], projected[2]);
    if (len > 1e-4) {
      const n = scale3(projected, 1 / len);
      return { tangent: t, normal: n, binormal: normalize3(cross3(t, n)) };
    }
  }
  const ref: Vec3 = Math.abs(t[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const binormal = normalize3(cross3(t, ref));
  const normal = normalize3(cross3(binormal, t));
  return { tangent: t, normal, binormal };
};

/** Finalize a MeshDraft into an immutable VfxPrimitiveMesh with computed AABB bounds. */
export const finalizeMesh = (kind: VfxPrimitiveKind, draft: MeshDraft): VfxPrimitiveMesh => {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < draft.positions.length; i += 3) {
    const x = draft.positions[i]!;
    const y = draft.positions[i + 1]!;
    const z = draft.positions[i + 2]!;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }
  const safeMin: Vec3 = Number.isFinite(minX) ? [minX, minY, minZ] : [0, 0, 0];
  const safeMax: Vec3 = Number.isFinite(maxX) ? [maxX, maxY, maxZ] : [0, 0, 0];
  return Object.freeze({
    kind,
    positions: Object.freeze(draft.positions),
    normals: Object.freeze(draft.normals),
    uvs: Object.freeze(draft.uvs),
    indices: Object.freeze(draft.indices),
    vertexCount: draft.positions.length / 3,
    triangleCount: draft.indices.length / 3,
    boundsMin: safeMin,
    boundsMax: safeMax,
  });
};

const subdivideOctahedron = (subdiv: 1 | 2, hemisphere: boolean): readonly [Vec3, Vec3, Vec3][] => {
  const xp: Vec3 = [1, 0, 0],
    xn: Vec3 = [-1, 0, 0];
  const yp: Vec3 = [0, 1, 0],
    yn: Vec3 = [0, -1, 0];
  const zp: Vec3 = [0, 0, 1],
    zn: Vec3 = [0, 0, -1];
  let tris: [Vec3, Vec3, Vec3][] = [
    [zp, xp, yp],
    [xp, zn, yp],
    [zn, xn, yp],
    [xn, zp, yp],
    ...(hemisphere
      ? []
      : ([
          [xp, zp, yn],
          [zn, xp, yn],
          [xn, zn, yn],
          [zp, xn, yn],
        ] as [Vec3, Vec3, Vec3][])),
  ];
  for (let s = 0; s < subdiv; s += 1) {
    const next: [Vec3, Vec3, Vec3][] = [];
    for (const [a, b, c] of tris) {
      const ab = normalize3(add3(a, b)),
        bc = normalize3(add3(b, c)),
        ca = normalize3(add3(c, a));
      next.push([a, ab, ca], [ab, b, bc], [ca, bc, c], [ab, bc, ca]);
    }
    tris = next;
  }
  return tris;
};

const sphereUv = (dir: Vec3): readonly [number, number] => [
  Math.atan2(dir[2], dir[0]) / (Math.PI * 2) + 0.5,
  Math.acos(Math.max(-1, Math.min(1, dir[1]))) / Math.PI,
];

const emitConeDome = (draft: MeshDraft, radius: number, height: number, segs: number): void => {
  const apex: Vec3 = [0, height, 0];
  for (let i = 0; i < segs; i += 1) {
    const t0 = (i / segs) * Math.PI * 2;
    const t1 = ((i + 1) / segs) * Math.PI * 2;
    const b0: Vec3 = [radius * Math.cos(t0), 0, radius * Math.sin(t0)];
    const b1: Vec3 = [radius * Math.cos(t1), 0, radius * Math.sin(t1)];
    const n = faceNormal(b1, b0, apex);
    pushTri(
      draft,
      pushVertex(draft, b1, n, 0.5 + 0.34 * Math.cos(t1), 0.5 + 0.34 * Math.sin(t1)),
      pushVertex(draft, b0, n, 0.5 + 0.34 * Math.cos(t0), 0.5 + 0.34 * Math.sin(t0)),
      pushVertex(draft, apex, n, 0.5, 0.5),
    );
  }
};

const emitTorusDome = (
  draft: MeshDraft,
  majorR: number,
  minorR: number,
  majSegs: number,
  minSegs: number,
): void => {
  const pt = (u: number, v: number): Vec3 => {
    const phi = u * Math.PI * 2;
    const theta = v * Math.PI * 2;
    const r = majorR + minorR * Math.cos(theta);
    return [r * Math.cos(phi), minorR * Math.sin(theta), r * Math.sin(phi)];
  };
  for (let i = 0; i < majSegs; i += 1) {
    const u0 = i / majSegs,
      u1 = (i + 1) / majSegs;
    for (let j = 0; j < minSegs; j += 1) {
      const v0 = j / minSegs,
        v1 = (j + 1) / minSegs;
      addFacetedQuad(
        draft,
        pt(u0, v0),
        pt(u0, v1),
        pt(u1, v1),
        pt(u1, v0),
        [u0, v0],
        [u0, v1],
        [u1, v1],
        [u1, v0],
      );
    }
  }
};

export const buildDome = (spec: VfxDomeSpec): VfxPrimitiveMesh => {
  const draft = createMeshDraft();
  const radius = Math.max(0.1, spec.radius);
  if (spec.shape === 'cone') {
    emitConeDome(draft, radius, spec.height ?? radius * 1.6, spec.subdiv === 2 ? 16 : 10);
    return finalizeMesh('dome', draft);
  }
  if (spec.shape === 'torus') {
    const minorR = Math.max(0.05, radius - (spec.innerRadius ?? radius * 0.65));
    emitTorusDome(draft, radius, minorR, spec.subdiv === 2 ? 16 : 10, spec.subdiv === 2 ? 8 : 6);
    return finalizeMesh('dome', draft);
  }
  const hemisphere = spec.shape === 'hemisphere';
  const tris = subdivideOctahedron(spec.subdiv, hemisphere);
  const uvForDir = (d: Vec3): readonly [number, number] =>
    hemisphere ? [0.5 + 0.44 * d[0], 0.5 + 0.44 * d[2]] : sphereUv(d);
  for (const [a, b, c] of tris) {
    const pa = scale3(a, radius);
    const pb = scale3(b, radius);
    const pc = scale3(c, radius);
    const n = faceNormal(pa, pb, pc);
    const uva = uvForDir(a);
    const uvb = uvForDir(b);
    const uvc = uvForDir(c);
    const ia = pushVertex(draft, pa, n, uva[0], uva[1]);
    const ib = pushVertex(draft, pb, n, uvb[0], uvb[1]);
    const ic = pushVertex(draft, pc, n, uvc[0], uvc[1]);
    pushTri(draft, ia, ib, ic);
  }
  return finalizeMesh('dome', draft);
};
