import { hexToOklch, lerpOklchHex } from '../textures/oklch';
import type { VfxBlendMode, VfxPalette, VfxPaletteRole } from './contract';

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const toByte = (v: number): number => Math.max(0, Math.min(255, Math.round(clamp01(v) * 255)));

/** Parse a #rrggbb hex string to normalized [0..1] RGB triple. */
export const hexToRgb01 = (hex: string): readonly [number, number, number] => [
  Number.parseInt(hex.slice(1, 3), 16) / 255,
  Number.parseInt(hex.slice(3, 5), 16) / 255,
  Number.parseInt(hex.slice(5, 7), 16) / 255,
];

/** Resolve a 4-role VFX palette color hex string. */
export const resolvePaletteHex = (palette: VfxPalette, role: VfxPaletteRole): string =>
  palette[role];

/** Sample a multi-stop palette role ramp in perceptual OKLCH space at normalized t in [0..1]. */
export const samplePaletteRampHex = (
  palette: VfxPalette,
  roles: readonly VfxPaletteRole[],
  t: number,
): string => {
  if (roles.length === 0) return palette.core;
  if (roles.length === 1) return palette[roles[0]!];
  const u = clamp01(t) * (roles.length - 1);
  const idx = Math.min(roles.length - 2, Math.floor(u));
  const localT = u - idx;
  return lerpOklchHex(palette[roles[idx]!], palette[roles[idx + 1]!], localT);
};

/**
 * Encode one RGBA pixel into an 8-bit Uint8Array with luminous premultiplied glow
 * for `additive` / `premul` blend modes (prevents dark fringes in vanilla glTF viewers).
 */
export const writeVfxRgbaPixel = (
  rgba: Uint8Array,
  offset: number,
  rgb01: readonly [number, number, number],
  alpha01: number,
  blendMode: VfxBlendMode,
): void => {
  const a = clamp01(alpha01);
  const alphaByte = toByte(a);
  if (blendMode === 'blend') {
    rgba[offset] = toByte(rgb01[0]);
    rgba[offset + 1] = toByte(rgb01[1]);
    rgba[offset + 2] = toByte(rgb01[2]);
    rgba[offset + 3] = alphaByte;
    return;
  }
  if (alphaByte === 0) {
    rgba[offset] = 0;
    rgba[offset + 1] = 0;
    rgba[offset + 2] = 0;
    rgba[offset + 3] = 0;
    return;
  }
  const glowBoost = blendMode === 'additive' ? Math.pow(a, 0.72) : a;
  rgba[offset] = toByte(rgb01[0] * glowBoost);
  rgba[offset + 1] = toByte(rgb01[1] * glowBoost);
  rgba[offset + 2] = toByte(rgb01[2] * glowBoost);
  rgba[offset + 3] = alphaByte;
};

export interface PaletteContrastMetrics {
  readonly coreL: number;
  readonly midL: number;
  readonly edgeL: number;
  readonly smokeL: number;
  readonly midChroma: number;
  readonly coreToMidDeltaL: number;
  readonly midToEdgeDeltaL: number;
}

/** Measure OKLCH perceptual lightness & chroma separation across a 4-role VFX palette. */
export const measurePaletteContrast = (palette: VfxPalette): PaletteContrastMetrics => {
  const core = hexToOklch(palette.core);
  const mid = hexToOklch(palette.mid);
  const edge = hexToOklch(palette.edge);
  const smoke = hexToOklch(palette.smoke);
  return {
    coreL: core.l,
    midL: mid.l,
    edgeL: edge.l,
    smokeL: smoke.l,
    midChroma: mid.c,
    coreToMidDeltaL: core.l - mid.l,
    midToEdgeDeltaL: mid.l - edge.l,
  };
};
