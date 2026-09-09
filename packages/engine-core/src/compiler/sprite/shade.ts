import { LIGHTS, type Material, type Shade } from '../../project/sprite/contract';

const clamp = (n: number, max: number): number => Math.max(0, Math.min(max, n));
const rgb = (color: string): number[] => [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16));
const hex = (values: number[]): string => '#' + values.map(n => clamp(Math.round(n), 255).toString(16).padStart(2, '0')).join('');
export const materialRamp = (material: Material): readonly string[] => {
  let colors: readonly string[];
  if (material.ramp.mode === 'explicit') colors = material.ramp.colors;
  else {
    const base = rgb(material.ramp.base), warm = material.ramp.preset === 'warm-v1';
    colors = [hex(base.map((v, i) => Math.floor(v * (warm ? [60, 48, 58][i]! : 55) / 100))),
      material.ramp.base, hex(base.map((v, i) => v + Math.floor((255 - v) * (warm ? [55, 44, 30][i]! : 45) / 100)))];
  }
  const mid = (a: string, b: string): string => hex(rgb(a).map((v, i) => (v + rgb(b)[i]!) / 2));
  return [colors[0]!, mid(colors[0]!, colors[1]!), colors[1]!, mid(colors[1]!, colors[2]!), colors[2]!];
};
/** Q8 stylized surface field. No runtime trigonometry, randomness or GPU. */
export const baseTone = (shade: Shade, x: number, y: number, w: number, h: number): number => {
  if (shade.contrast === 0 || shade.form === 'flat') return 2;
  const [lx, ly] = LIGHTS[shade.light]!;
  let nx: number, ny: number, nz = 128;
  if (shade.form === 'round') {
    nx = Math.trunc(((2 * x + 1 - w) * 256) / w);
    ny = Math.trunc(((2 * y + 1 - h) * 256) / h);
    // Integer hemisphere height curves the light field instead of diagonal bands.
    const squared = Math.max(0, 65536 - nx * nx - ny * ny);
    let low = 0, high = 256;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if (mid * mid <= squared) low = mid; else high = mid - 1;
    }
    nz = low;
  } else {
    const [a, b] = shade.axis!;
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const cross = dx * (y - a[1]) - dy * (x - a[0]);
    const sign = Math.sign(cross), length = Math.abs(dx) + Math.abs(dy);
    nx = Math.trunc(-dy * sign * 256 / length);
    ny = Math.trunc(dx * sign * 256 / length);
  }
  const score = Math.trunc((nx * lx + ny * ly + nz - 128) * shade.contrast / (Math.abs(lx) + Math.abs(ly)));
  return score <= -240 ? 0 : score <= -64 ? 1 : score < 64 ? 2 : score < 240 ? 3 : 4;
};
/** Fixed 2x2 clusters in part-local coordinates. The seed never affects base tone. */
export const grainDelta = (x: number, y: number, seed: number): number => {
  let v = (seed ^ Math.imul(Math.floor(x / 2) + 1, 0x9e3779b1) ^ Math.imul(Math.floor(y / 2) + 1, 0x85ebca6b)) >>> 0;
  v = Math.imul(v ^ (v >>> 16), 0x7feb352d) >>> 0;
  v = Math.imul(v ^ (v >>> 15), 0x846ca68b) >>> 0;
  v = (v ^ (v >>> 16)) >>> 0;
  return v < 536870912 ? -1 : v >= 3758096384 ? 1 : 0;
};
export const finalTone = (base: number, delta: number): number => clamp(base + delta, 4);
