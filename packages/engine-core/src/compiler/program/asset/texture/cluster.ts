export interface ClusterDensity {
  readonly numerator: bigint;
  readonly denominator: bigint;
}

type Point = readonly [number, number, number];

const hash = (x: number, y: number, z: number, seed: number, stream: number): number => {
  let value =
    Math.imul(x | 0, 0x45d9f3b) ^
    Math.imul(y | 0, 0x119de1f3) ^
    Math.imul(z | 0, 0x3449f5) ^
    Math.imul(seed | 0, 0x27d4eb2d) ^
    Math.imul(stream | 0, 0x165667b1);
  value ^= value >>> 16;
  value = Math.imul(value, 0x45d9f3b);
  value ^= value >>> 13;
  return (value ^ (value >>> 16)) >>> 0;
};

const modulo = (value: number, divisor: number): number => ((value % divisor) + divisor) % divisor;

const interpolate = (left: number, right: number, offset: number, scale: number): number =>
  Math.floor((left * (scale - offset) + right * offset) / scale);

/** Bounded integer value noise shared by macro blotches and clustered grain. */
export const coherentValue = (
  point: Point,
  scale: readonly [number, number, number],
  seed: number,
  stream: number,
): number => {
  const px = point[0];
  const py = point[1];
  const pz = point[2];
  const sx = scale[0];
  const sy = scale[1];
  const sz = scale[2];
  const cx = Math.floor(px / sx);
  const cy = Math.floor(py / sy);
  const cz = Math.floor(pz / sz);
  const fx = modulo(px, sx);
  const fy = modulo(py, sy);
  const fz = modulo(pz, sz);
  const x00 = interpolate(
    hash(cx, cy, cz, seed, stream),
    hash(cx + 1, cy, cz, seed, stream),
    fx,
    sx,
  );
  const x10 = interpolate(
    hash(cx, cy + 1, cz, seed, stream),
    hash(cx + 1, cy + 1, cz, seed, stream),
    fx,
    sx,
  );
  const x01 = interpolate(
    hash(cx, cy, cz + 1, seed, stream),
    hash(cx + 1, cy, cz + 1, seed, stream),
    fx,
    sx,
  );
  const x11 = interpolate(
    hash(cx, cy + 1, cz + 1, seed, stream),
    hash(cx + 1, cy + 1, cz + 1, seed, stream),
    fx,
    sx,
  );
  return interpolate(interpolate(x00, x10, fy, sy), interpolate(x01, x11, fy, sy), fz, sz) >>> 0;
};

export const hashText = (value: string): number => {
  let result = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 0x01000193);
  }
  return result >>> 0;
};
