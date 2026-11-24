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
  const cell = point.map((entry, index) => Math.floor(entry / scale[index]!)) as [
    number,
    number,
    number,
  ];
  const fraction = point.map((entry, index) => modulo(entry, scale[index]!)) as [
    number,
    number,
    number,
  ];
  const corner = (dx: number, dy: number, dz: number): number =>
    hash(cell[0] + dx, cell[1] + dy, cell[2] + dz, seed, stream);
  const x00 = interpolate(corner(0, 0, 0), corner(1, 0, 0), fraction[0], scale[0]);
  const x10 = interpolate(corner(0, 1, 0), corner(1, 1, 0), fraction[0], scale[0]);
  const x01 = interpolate(corner(0, 0, 1), corner(1, 0, 1), fraction[0], scale[0]);
  const x11 = interpolate(corner(0, 1, 1), corner(1, 1, 1), fraction[0], scale[0]);
  return (
    interpolate(
      interpolate(x00, x10, fraction[1], scale[1]),
      interpolate(x01, x11, fraction[1], scale[1]),
      fraction[2],
      scale[2],
    ) >>> 0
  );
};

export const hashText = (value: string): number => {
  let result = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 0x01000193);
  }
  return result >>> 0;
};
