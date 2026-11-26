export interface RgbColor {
  r: number;
  g: number;
  b: number;
}

const hexNibble = (code: number): number => {
  if (code >= 48 && code <= 57) return code - 48;
  if (code >= 97 && code <= 102) return code - 87;
  if (code >= 65 && code <= 70) return code - 55;
  return -1;
};

/** Parse the explicit six-digit colors accepted by authored texture source. */
export const parseSurfaceColor = (value: string): RgbColor => {
  if (typeof value !== 'string' || value.length !== 7 || value.charCodeAt(0) !== 35) {
    throw new RangeError('Surface colors must use exactly six hexadecimal digits (#rrggbb).');
  }
  const r0 = hexNibble(value.charCodeAt(1));
  const r1 = hexNibble(value.charCodeAt(2));
  const g0 = hexNibble(value.charCodeAt(3));
  const g1 = hexNibble(value.charCodeAt(4));
  const b0 = hexNibble(value.charCodeAt(5));
  const b1 = hexNibble(value.charCodeAt(6));
  if ((r0 | r1 | g0 | g1 | b0 | b1) < 0) {
    throw new RangeError('Surface colors must use exactly six hexadecimal digits (#rrggbb).');
  }
  return {
    r: (r0 << 4) | r1,
    g: (g0 << 4) | g1,
    b: (b0 << 4) | b1,
  };
};

/** Compute Rec. 709 / sRGB normalized luminance in [0, 1] from 8-bit RGB channels. */
export const srgbLuma = (r: number, g: number, b: number): number =>
  (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
