export interface RgbColor {
  r: number;
  g: number;
  b: number;
}

const HEX_COLOR = /^#([0-9a-f]{6})$/i;

/** Parse the explicit six-digit colors accepted by authored texture source. */
export const parseSurfaceColor = (value: string): RgbColor => {
  if (typeof value !== 'string' || value.length !== 7) {
    throw new RangeError('Surface colors must use exactly six hexadecimal digits (#rrggbb).');
  }
  const match = HEX_COLOR.exec(value);
  if (!match) {
    throw new RangeError('Surface colors must use exactly six hexadecimal digits (#rrggbb).');
  }
  const hex = match[1]!;
  return {
    r: Number.parseInt(hex.slice(0, 2), 16),
    g: Number.parseInt(hex.slice(2, 4), 16),
    b: Number.parseInt(hex.slice(4, 6), 16),
  };
};
