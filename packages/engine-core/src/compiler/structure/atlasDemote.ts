export interface DemotableBatch {
  readonly positions: number[];
  readonly normals: number[];
  readonly uvs: number[];
  readonly colors: number[];
  readonly indices: number[];
}

export const countMultiQuadSavings = (b: DemotableBatch): number => {
  let saved = 0;
  for (let i = 0; i < b.uvs.length; i += 8) {
    const mw = Math.max(1, Math.round(Math.abs(b.uvs[i + 2]! - b.uvs[i]!) * 2));
    const mh = Math.max(1, Math.round(Math.abs(b.uvs[i + 1]! - b.uvs[i + 5]!) * 2));
    saved += mw * mh - 1;
  }
  return saved;
};

const lerp3 = (a: number, b: number, c: number, d: number, s: number, t: number): number =>
  (a * (1 - s) + b * s) * t + (d * (1 - s) + c * s) * (1 - t);

const pushCornerAttr = (
  dst: number[],
  a: readonly number[],
  vp: number,
  s0: number,
  s1: number,
  t0: number,
  t1: number,
): void => {
  for (let o = 0; o < 3; o += 1)
    dst.push(lerp3(a[vp + o]!, a[vp + 3 + o]!, a[vp + 6 + o]!, a[vp + 9 + o]!, s0, t1));
  for (let o = 0; o < 3; o += 1)
    dst.push(lerp3(a[vp + o]!, a[vp + 3 + o]!, a[vp + 6 + o]!, a[vp + 9 + o]!, s1, t1));
  for (let o = 0; o < 3; o += 1)
    dst.push(lerp3(a[vp + o]!, a[vp + 3 + o]!, a[vp + 6 + o]!, a[vp + 9 + o]!, s1, t0));
  for (let o = 0; o < 3; o += 1)
    dst.push(lerp3(a[vp + o]!, a[vp + 3 + o]!, a[vp + 6 + o]!, a[vp + 9 + o]!, s0, t0));
};

const pushSubdividedGrid = (
  dst: DemotableBatch,
  src: DemotableBatch,
  vBase: number,
  idxStart: number,
  mw: number,
  mh: number,
): void => {
  const flipped = src.indices[idxStart]! !== vBase;
  const p = src.positions;
  const c = src.colors;
  const nx = src.normals[vBase * 3]!;
  const ny = src.normals[vBase * 3 + 1]!;
  const nz = src.normals[vBase * 3 + 2]!;
  const vp = vBase * 3;
  for (let gy = 0; gy < mh; gy += 1) {
    const t0 = gy / mh;
    const t1 = (gy + 1) / mh;
    for (let gx = 0; gx < mw; gx += 1) {
      const s0 = gx / mw;
      const s1 = (gx + 1) / mw;
      const outBase = dst.positions.length / 3;
      pushCornerAttr(dst.positions, p, vp, s0, s1, t0, t1);
      dst.normals.push(nx, ny, nz, nx, ny, nz, nx, ny, nz, nx, ny, nz);
      pushCornerAttr(dst.colors, c, vp, s0, s1, t0, t1);
      dst.uvs.push(0, 1, 1, 1, 1, 0, 0, 0);
      if (flipped)
        dst.indices.push(outBase + 1, outBase + 2, outBase + 3, outBase + 1, outBase + 3, outBase);
      else dst.indices.push(outBase, outBase + 1, outBase + 2, outBase, outBase + 2, outBase + 3);
    }
  }
};

export const appendDemotedFullBatch = (dst: DemotableBatch, src: DemotableBatch): void => {
  const quadCount = src.indices.length / 6;
  for (let q = 0; q < quadCount; q += 1) {
    const u0 = q * 8;
    const mw = Math.max(1, Math.round(Math.abs(src.uvs[u0 + 2]! - src.uvs[u0]!) * 2));
    const mh = Math.max(1, Math.round(Math.abs(src.uvs[u0 + 1]! - src.uvs[u0 + 5]!) * 2));
    if (mw === 1 && mh === 1) {
      const outBase = dst.positions.length / 3;
      const vBase = q * 4;
      const vp = vBase * 3;
      const flipped = src.indices[q * 6]! !== vBase;
      for (let k = 0; k < 12; k += 1) {
        dst.positions.push(src.positions[vp + k]!);
        dst.normals.push(src.normals[vp + k]!);
        dst.colors.push(src.colors[vp + k]!);
      }
      const uMin = Math.min(src.uvs[u0]!, src.uvs[u0 + 2]!, src.uvs[u0 + 4]!, src.uvs[u0 + 6]!);
      const vMin = Math.min(src.uvs[u0 + 1]!, src.uvs[u0 + 3]!, src.uvs[u0 + 5]!, src.uvs[u0 + 7]!);
      for (let k = 0; k < 8; k += 2) {
        dst.uvs.push((src.uvs[u0 + k]! - uMin) * 2, (src.uvs[u0 + k + 1]! - vMin) * 2);
      }
      if (flipped)
        dst.indices.push(outBase + 1, outBase + 2, outBase + 3, outBase + 1, outBase + 3, outBase);
      else dst.indices.push(outBase, outBase + 1, outBase + 2, outBase, outBase + 2, outBase + 3);
    } else {
      pushSubdividedGrid(dst, src, q * 4, q * 6, mw, mh);
    }
  }
};
