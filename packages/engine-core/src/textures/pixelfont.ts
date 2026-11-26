const FONT_5X7: Readonly<Record<string, readonly number[]>> = {
  ' ': [0, 0, 0, 0, 0, 0, 0],
  '+': [0, 4, 4, 31, 4, 4, 0],
  '-': [0, 0, 0, 31, 0, 0, 0],
  '.': [0, 0, 0, 0, 0, 12, 12],
  '/': [1, 2, 2, 4, 8, 8, 16],
  ':': [0, 12, 12, 0, 12, 12, 0],
  '%': [24, 25, 2, 4, 8, 19, 3],
  '(': [4, 8, 16, 16, 16, 8, 4],
  ')': [4, 2, 1, 1, 1, 2, 4],
  '0': [14, 17, 19, 21, 25, 17, 14],
  '1': [4, 12, 4, 4, 4, 4, 14],
  '2': [14, 17, 1, 6, 8, 16, 31],
  '3': [30, 1, 1, 14, 1, 1, 30],
  '4': [2, 6, 10, 18, 31, 2, 2],
  '5': [31, 16, 30, 1, 1, 17, 14],
  '6': [6, 8, 16, 30, 17, 17, 14],
  '7': [31, 1, 2, 4, 8, 8, 8],
  '8': [14, 17, 17, 14, 17, 17, 14],
  '9': [14, 17, 17, 15, 1, 2, 12],
  A: [14, 17, 17, 31, 17, 17, 17],
  B: [30, 17, 17, 30, 17, 17, 30],
  C: [14, 17, 16, 16, 16, 17, 14],
  D: [30, 17, 17, 17, 17, 17, 30],
  E: [31, 16, 16, 30, 16, 16, 31],
  F: [31, 16, 16, 30, 16, 16, 16],
  G: [14, 17, 16, 23, 17, 17, 15],
  H: [17, 17, 17, 31, 17, 17, 17],
  I: [14, 4, 4, 4, 4, 4, 14],
  J: [7, 2, 2, 2, 2, 18, 12],
  K: [17, 18, 20, 24, 20, 18, 17],
  L: [16, 16, 16, 16, 16, 16, 31],
  M: [17, 27, 21, 21, 17, 17, 17],
  N: [17, 25, 21, 19, 17, 17, 17],
  O: [14, 17, 17, 17, 17, 17, 14],
  P: [30, 17, 17, 30, 16, 16, 16],
  Q: [14, 17, 17, 17, 21, 18, 13],
  R: [30, 17, 17, 30, 20, 18, 17],
  S: [15, 16, 16, 14, 1, 1, 30],
  T: [31, 4, 4, 4, 4, 4, 4],
  U: [17, 17, 17, 17, 17, 17, 14],
  V: [17, 17, 17, 17, 17, 10, 4],
  W: [17, 17, 17, 21, 21, 27, 17],
  X: [17, 17, 10, 4, 10, 17, 17],
  Y: [17, 17, 10, 4, 4, 4, 4],
  Z: [31, 1, 2, 4, 8, 16, 31],
};

export type RgbaColor = readonly [number, number, number, number];

export const fillRectRgba = (
  buf: Uint8Array,
  bufW: number,
  bufH: number,
  x: number,
  y: number,
  w: number,
  h: number,
  color: RgbaColor,
): void => {
  const x0 = Math.max(0, Math.floor(x));
  const y0 = Math.max(0, Math.floor(y));
  const x1 = Math.min(bufW, Math.floor(x + w));
  const y1 = Math.min(bufH, Math.floor(y + h));
  for (let py = y0; py < y1; py += 1) {
    for (let px = x0; px < x1; px += 1) {
      const i = (py * bufW + px) * 4;
      buf[i] = color[0];
      buf[i + 1] = color[1];
      buf[i + 2] = color[2];
      buf[i + 3] = color[3];
    }
  }
};

export const drawTextRgba = (
  buf: Uint8Array,
  bufW: number,
  bufH: number,
  text: string,
  x: number,
  y: number,
  color: RgbaColor,
  scale = 1,
): void => {
  const upper = text.toUpperCase();
  for (let c = 0; c < upper.length; c += 1) {
    const glyph = FONT_5X7[upper[c]!] ?? FONT_5X7[' '];
    for (let row = 0; row < 7; row += 1) {
      const bits = glyph[row]!;
      for (let col = 0; col < 5; col += 1) {
        if ((bits & (16 >> col)) !== 0) {
          fillRectRgba(
            buf,
            bufW,
            bufH,
            x + (c * 6 + col) * scale,
            y + row * scale,
            scale,
            scale,
            color,
          );
        }
      }
    }
  }
};

export const drawBadgeRgba = (
  buf: Uint8Array,
  bufW: number,
  bufH: number,
  x: number,
  y: number,
  label: string,
): void => {
  const padX = 6,
    padY = 4;
  const w = label.length * 6 - 1 + padX * 2;
  const h = 7 + padY * 2;
  fillRectRgba(buf, bufW, bufH, x, y, w, h, [16, 20, 28, 255]);
  drawTextRgba(buf, bufW, bufH, label, x + padX, y + padY, [240, 244, 248, 255], 1);
};
