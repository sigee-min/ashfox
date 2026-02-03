export type UvRect = [number, number, number, number];

export const scaleUvRect = (uv: UvRect, scaleX: number, scaleY: number): UvRect => [
  uv[0] * scaleX,
  uv[1] * scaleY,
  uv[2] * scaleX,
  uv[3] * scaleY
];


