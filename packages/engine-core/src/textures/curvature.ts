import { clamp01, hexToOklch, oklchToHex } from './oklch';

export interface CurvatureRegionSpec {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly isBoxFace: boolean;
  readonly density?: number;
}

export interface ChartCurvatureMask {
  readonly convex: Float32Array;
  readonly concave: Float32Array;
}

interface FaceData {
  readonly centroid: readonly [number, number, number];
  readonly normal: readonly [number, number, number];
}

const edgeKey = (a: number, b: number): string => (a < b ? `${a}:${b}` : `${b}:${a}`);

const computeTriangleData = (
  positions: readonly number[],
  normals: readonly number[],
  i0: number,
  i1: number,
  i2: number,
): FaceData => {
  const cx = (positions[i0 * 3]! + positions[i1 * 3]! + positions[i2 * 3]!) / 3;
  const cy = (positions[i0 * 3 + 1]! + positions[i1 * 3 + 1]! + positions[i2 * 3 + 1]!) / 3;
  const cz = (positions[i0 * 3 + 2]! + positions[i1 * 3 + 2]! + positions[i2 * 3 + 2]!) / 3;
  const nx = normals[i0 * 3]! + normals[i1 * 3]! + normals[i2 * 3]!;
  const ny = normals[i0 * 3 + 1]! + normals[i1 * 3 + 1]! + normals[i2 * 3 + 1]!;
  const nz = normals[i0 * 3 + 2]! + normals[i1 * 3 + 2]! + normals[i2 * 3 + 2]!;
  const len = Math.hypot(nx, ny, nz) || 1;
  return { centroid: [cx, cy, cz], normal: [nx / len, ny / len, nz / len] };
};

const addEdgeDihedral = (
  a: FaceData,
  b: FaceData,
  v0: number,
  v1: number,
  sums: Float32Array,
  counts: Uint16Array,
): void => {
  const dotN = Math.max(
    -1,
    Math.min(1, a.normal[0] * b.normal[0] + a.normal[1] * b.normal[1] + a.normal[2] * b.normal[2]),
  );
  if (dotN > 0.995) return;
  const angle = Math.acos(dotN) / Math.PI;
  const dcX = b.centroid[0] - a.centroid[0];
  const dcY = b.centroid[1] - a.centroid[1];
  const dcZ = b.centroid[2] - a.centroid[2];
  const dnX = b.normal[0] - a.normal[0];
  const dnY = b.normal[1] - a.normal[1];
  const dnZ = b.normal[2] - a.normal[2];
  const sign = dcX * dnX + dcY * dnY + dcZ * dnZ >= 0 ? 1 : -1;
  const signedCurvature = sign * angle;
  sums[v0] = (sums[v0] ?? 0) + signedCurvature;
  sums[v1] = (sums[v1] ?? 0) + signedCurvature;
  counts[v0] = (counts[v0] ?? 0) + 1;
  counts[v1] = (counts[v1] ?? 0) + 1;
};

/**
 * Compute per-vertex signed 3D dihedral curvature in [-1, 1] from triangle topology.
 * Positive values denote convex edges; negative values denote concave creases.
 */
export const computeMeshVertexCurvature = (
  positions: readonly number[],
  normals: readonly number[],
  indices: readonly number[],
): Float32Array => {
  const count = Math.floor(positions.length / 3);
  const out = new Float32Array(count);
  if (count === 0 || indices.length < 3) return out;
  const sums = new Float32Array(count);
  const counts = new Uint16Array(count);
  const edgeOwners = new Map<
    string,
    { readonly v0: number; readonly v1: number; readonly face: FaceData }
  >();
  for (let i = 0; i + 2 < indices.length; i += 3) {
    const tri = [indices[i]!, indices[i + 1]!, indices[i + 2]!] as const;
    const face = computeTriangleData(positions, normals, tri[0], tri[1], tri[2]);
    const edges = [
      [tri[0], tri[1]],
      [tri[1], tri[2]],
      [tri[2], tri[0]],
    ] as const;
    for (const [v0, v1] of edges) {
      const key = edgeKey(v0, v1);
      const prev = edgeOwners.get(key);
      if (prev) addEdgeDihedral(prev.face, face, v0, v1, sums, counts);
      else edgeOwners.set(key, { v0, v1, face });
    }
  }
  for (let v = 0; v < count; v += 1) {
    if (counts[v]! > 0) out[v] = Math.max(-1, Math.min(1, sums[v]! / counts[v]!));
  }
  return out;
};

const wearChipWeight = (x: number, y: number, w: number, h: number): number => {
  let v =
    (Math.imul(x + 17, 0x9e3779b1) ^
      Math.imul(y + 31, 0x85ebca6b) ^
      Math.imul(w * 29 + h, 0xc2b2ae35)) >>>
    0;
  v ^= v >>> 15;
  v = Math.imul(v, 0x2c1b3c6d) >>> 0;
  const norm = ((v ^ (v >>> 12)) & 0xffff) / 0xffff;
  return 0.55 + 0.45 * norm;
};

const rawConvexEdgeWeight = (lx: number, ly: number, region: CurvatureRegionSpec): number => {
  const { width, height, isBoxFace } = region;
  if (width < 2 || height < 2) return 0;
  const dist = Math.min(lx, ly, width - 1 - lx, height - 1 - ly);
  const reach = (region.density ?? 1) >= 2 && width >= 4 && height >= 4 ? 1 : 0;
  if (dist > reach) return 0;
  const base = dist === 0 ? (isBoxFace ? 1.0 : 0.55) : 0.4;
  return base * wearChipWeight(lx, ly, width, height);
};

const bakeRegionCurvature = (
  region: CurvatureRegionSpec,
  chartWidth: number,
  aoGrid: Uint8Array,
  bentAo: Float32Array | undefined,
  mask: ChartCurvatureMask,
): void => {
  for (let ly = 0; ly < region.height; ly += 1) {
    for (let lx = 0; lx < region.width; lx += 1) {
      const idx = (region.y + ly) * chartWidth + (region.x + lx);
      const aoStep = aoGrid[idx] ?? 0;
      const bent = bentAo?.[idx] ?? 0;
      const concave = clamp01(Math.max(bent, aoStep * 0.45));
      const convex = clamp01(rawConvexEdgeWeight(lx, ly, region) * (1 - concave));
      if (convex > mask.convex[idx]!) mask.convex[idx] = convex;
      if (concave > mask.concave[idx]!) mask.concave[idx] = concave;
    }
  }
};

/**
 * Project 3D dihedral convex edge weights and concave Bent-AO crease masks
 * onto a chart's texture grid.
 */
export const bakeChartCurvatureMask = (
  chartWidth: number,
  chartHeight: number,
  regions: readonly CurvatureRegionSpec[],
  aoGrid: Uint8Array,
  bentAo?: Float32Array,
): ChartCurvatureMask => {
  const len = chartWidth * chartHeight;
  const mask: ChartCurvatureMask = {
    convex: new Float32Array(len),
    concave: new Float32Array(len),
  };
  for (const region of regions) {
    bakeRegionCurvature(region, chartWidth, aoGrid, bentAo, mask);
  }
  return mask;
};

/** Apply convex edge-wear OKLCH lightness lift and concave Bent-AO darkening to a hex color. */
export const applyCurvatureOklch = (
  hex: string,
  convex: number,
  concave: number,
  edgeWear: number,
): string => {
  if (edgeWear <= 0 || (convex <= 0 && concave <= 0)) return hex;
  const color = hexToOklch(hex);
  const lLift = 0.085 * edgeWear * convex;
  const lDrop = 0.055 * edgeWear * concave;
  const cScale = 1 - 0.1 * edgeWear * convex;
  return oklchToHex({
    l: clamp01(color.l + lLift - lDrop),
    c: Math.max(0, color.c * cScale),
    h: color.h,
  });
};

/** Adjust roughness and AO byte from convex edge wear and concave Bent-AO crease mask. */
export const applyCurvaturePbr = (
  roughness: number,
  aoByte: number,
  convex: number,
  concave: number,
  edgeWear: number,
): Readonly<{ readonly roughness: number; readonly aoByte: number }> => {
  const nextRoughness = clamp01(roughness - 0.18 * edgeWear * convex + 0.12 * concave);
  const bentAoByte = Math.round(255 * (1 - 0.42 * concave));
  return { roughness: nextRoughness, aoByte: Math.min(aoByte, bentAoByte) };
};
