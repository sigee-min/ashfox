const accumulateTriTangents = (
  positions: readonly number[],
  uvs: readonly number[],
  i0: number,
  i1: number,
  i2: number,
  tAcc: Float32Array,
  bAcc: Float32Array,
): void => {
  const e1x = positions[i1 * 3]! - positions[i0 * 3]!;
  const e1y = positions[i1 * 3 + 1]! - positions[i0 * 3 + 1]!;
  const e1z = positions[i1 * 3 + 2]! - positions[i0 * 3 + 2]!;
  const e2x = positions[i2 * 3]! - positions[i0 * 3]!;
  const e2y = positions[i2 * 3 + 1]! - positions[i0 * 3 + 1]!;
  const e2z = positions[i2 * 3 + 2]! - positions[i0 * 3 + 2]!;
  const du1 = uvs[i1 * 2]! - uvs[i0 * 2]!;
  const dv1 = uvs[i1 * 2 + 1]! - uvs[i0 * 2 + 1]!;
  const du2 = uvs[i2 * 2]! - uvs[i0 * 2]!;
  const dv2 = uvs[i2 * 2 + 1]! - uvs[i0 * 2 + 1]!;
  const det = du1 * dv2 - du2 * dv1;
  if (Math.abs(det) <= 1e-10) return;
  const inv = 1 / det;
  const tx = (e1x * dv2 - e2x * dv1) * inv;
  const ty = (e1y * dv2 - e2y * dv1) * inv;
  const tz = (e1z * dv2 - e2z * dv1) * inv;
  const bx = (e2x * du1 - e1x * du2) * inv;
  const by = (e2y * du1 - e1y * du2) * inv;
  const bz = (e2z * du1 - e1z * du2) * inv;
  for (const idx of [i0, i1, i2]) {
    const off = idx * 3;
    tAcc[off] = tAcc[off]! + tx;
    tAcc[off + 1] = tAcc[off + 1]! + ty;
    tAcc[off + 2] = tAcc[off + 2]! + tz;
    bAcc[off] = bAcc[off]! + bx;
    bAcc[off + 1] = bAcc[off + 1]! + by;
    bAcc[off + 2] = bAcc[off + 2]! + bz;
  }
};

const fallbackOrthoTangent = (
  nx: number,
  ny: number,
  nz: number,
): readonly [number, number, number] => {
  const ax = Math.abs(ny) < 0.999 ? 0 : 1;
  const ay = Math.abs(ny) < 0.999 ? 1 : 0;
  const cx = ay * nz;
  const cy = -ax * nz;
  const cz = ax * ny - ay * nx;
  const len = Math.hypot(cx, cy, cz) || 1;
  return [cx / len, cy / len, cz / len];
};

const orthonormalizeVertex = (
  nx: number,
  ny: number,
  nz: number,
  tx: number,
  ty: number,
  tz: number,
  bx: number,
  by: number,
  bz: number,
): readonly [number, number, number, number] => {
  const nLen = Math.hypot(nx, ny, nz) || 1;
  const unx = nx / nLen;
  const uny = ny / nLen;
  const unz = nz / nLen;
  const dotNt = unx * tx + uny * ty + unz * tz;
  const ox = tx - unx * dotNt;
  const oy = ty - uny * dotNt;
  const oz = tz - unz * dotNt;
  const oLen = Math.hypot(ox, oy, oz);
  const [utx, uty, utz] =
    oLen > 1e-6 ? [ox / oLen, oy / oLen, oz / oLen] : fallbackOrthoTangent(unx, uny, unz);
  const cx = uny * utz - unz * uty;
  const cy = unz * utx - unx * utz;
  const cz = unx * uty - uny * utx;
  const w = cx * bx + cy * by + cz * bz < 0 ? -1 : 1;
  return [utx, uty, utz, w];
};

/**
 * Compute deterministic MikkTSpace-compatible orthogonal VEC4 tangents
 * `(tx, ty, tz, w)` where `bitangent = cross(N, T) * w`.
 */
export const computeOrthogonalTangents = (
  positions: readonly number[],
  normals: readonly number[],
  uvs: readonly number[],
  indices: readonly number[],
): number[] => {
  const count = Math.floor(positions.length / 3);
  const tAcc = new Float32Array(count * 3);
  const bAcc = new Float32Array(count * 3);
  for (let i = 0; i + 2 < indices.length; i += 3) {
    accumulateTriTangents(
      positions,
      uvs,
      indices[i]!,
      indices[i + 1]!,
      indices[i + 2]!,
      tAcc,
      bAcc,
    );
  }
  const tangents = new Array<number>(count * 4);
  for (let v = 0; v < count; v += 1) {
    const v3 = v * 3;
    const [tx, ty, tz, w] = orthonormalizeVertex(
      normals[v3]!,
      normals[v3 + 1]!,
      normals[v3 + 2]!,
      tAcc[v3]!,
      tAcc[v3 + 1]!,
      tAcc[v3 + 2]!,
      bAcc[v3]!,
      bAcc[v3 + 1]!,
      bAcc[v3 + 2]!,
    );
    const v4 = v * 4;
    tangents[v4] = tx;
    tangents[v4 + 1] = ty;
    tangents[v4 + 2] = tz;
    tangents[v4 + 3] = w;
  }
  return tangents;
};
