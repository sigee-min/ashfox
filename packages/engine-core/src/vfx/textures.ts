import { clamp01, hexToRgb01, lerpOklchHex } from '../textures/oklch';
import type { VfxPalette, VfxTextureBuffer, VfxTextureSpec } from './contract';
import { fbm2D, noise2D } from './noise';
import { writeVfxRgbaPixel } from './oklch';

const smoothstep = (edge0: number, edge1: number, x: number): number => {
  const t = clamp01((x - edge0) / (edge1 - edge0 || 1e-6));
  return t * t * (3 - 2 * t);
};

const posterizeValue = (v: number, bands: number | undefined): number => {
  if (bands === undefined || bands < 2) return clamp01(v);
  const steps = Math.max(2, Math.min(8, Math.round(bands)));
  return Math.round(clamp01(v) * (steps - 1)) / (steps - 1);
};

interface SampleOutput {
  readonly rgb: readonly [number, number, number];
  readonly alpha: number;
}

const samplePaletteGradient = (
  palette: VfxPalette,
  energy: number,
): readonly [number, number, number] => {
  const e = clamp01(energy);
  if (e >= 0.55) {
    return hexToRgb01(lerpOklchHex(palette.mid, palette.core, (e - 0.55) / 0.45));
  }
  return hexToRgb01(lerpOklchHex(palette.edge, palette.mid, e / 0.55));
};

const evalSlashStreak = (
  u: number,
  v: number,
  spec: VfxTextureSpec,
  palette: VfxPalette,
): SampleOutput => {
  const bristles = spec.bristles ?? 0.6;
  const distFromCenter = Math.abs(v - 0.5) * 2;
  const headMask = smoothstep(0.0, 0.14, u);
  const tailTaper = Math.pow(clamp01(1 - Math.max(0, u - 0.1) / 0.9), 0.72);
  const widthAtU = 0.25 + 0.75 * headMask * tailTaper;
  const radial = clamp01(1 - distFromCenter / Math.max(0.08, widthAtU));
  const brush = fbm2D(u * 6.5, v * 22, spec.seed, 3);
  const bristleMod = 1 - bristles * 0.65 * (1 - brush);
  const rawEnergy = radial * bristleMod * (0.45 + 0.55 * tailTaper);
  const energy = posterizeValue(rawEnergy, spec.posterize);
  const coreBoost = smoothstep(0.55, 0.95, radial) * (1 - u * 0.45);
  const rgb = samplePaletteGradient(palette, clamp01(energy * 0.8 + coreBoost * 0.5));
  const alpha = smoothstep(0.04, 0.28, energy) * headMask;
  return { rgb, alpha };
};

const evalRadialFlare = (
  u: number,
  v: number,
  spec: VfxTextureSpec,
  palette: VfxPalette,
  isStarburst: boolean,
): SampleOutput => {
  const dx = (u - 0.5) * 2;
  const dy = (v - 0.5) * 2;
  const r = Math.hypot(dx, dy);
  const theta = Math.atan2(dy, dx);
  const spikeCount = spec.spikes ?? (isStarburst ? 8 : 4);
  const spikeWave = Math.pow(Math.abs(Math.cos(theta * spikeCount * 0.5)), isStarburst ? 6 : 4);
  const anisoScale = 1 + (isStarburst ? 0.55 : 0.75) * spikeWave;
  const radialFalloff = clamp01(1 - r / anisoScale);
  const halo = Math.exp(-r * r * 5.2);
  const rimBand = smoothstep(0.45, 0.72, r) * (1 - smoothstep(0.72, 0.96, r));
  const noiseBreak = 0.85 + 0.15 * noise2D(dx * 5, dy * 5, spec.seed);
  const rawEnergy = clamp01((halo * 0.75 + radialFalloff * 0.55 * spikeWave) * noiseBreak);
  const energy = posterizeValue(rawEnergy, spec.posterize);
  const baseHex = lerpOklchHex(palette.mid, palette.core, smoothstep(0.35, 0.9, energy));
  const rimHex = lerpOklchHex(baseHex, palette.edge, rimBand * 0.85);
  const alpha = clamp01(energy + halo * 0.4) * (1 - smoothstep(0.88, 1.0, r));
  return { rgb: hexToRgb01(rimHex), alpha };
};

const evalRingWave = (
  u: number,
  v: number,
  spec: VfxTextureSpec,
  palette: VfxPalette,
  isMagicCircle: boolean,
): SampleOutput => {
  const dx = (u - 0.5) * 2;
  const dy = (v - 0.5) * 2;
  const r = Math.hypot(dx, dy);
  const theta = (Math.atan2(dy, dx) + Math.PI) / (Math.PI * 2);
  const ringFreq = spec.rings ?? (isMagicCircle ? 3 : 2);
  const mainRing = Math.exp(-Math.pow((r - 0.66) / 0.1, 2));
  const outerDust = Math.exp(-Math.pow((r - 0.84) / 0.08, 2)) * 0.55;
  const ripple = 0.5 + 0.5 * Math.sin(r * Math.PI * 2 * ringFreq + spec.seed);
  const ticks = isMagicCircle
    ? Math.pow(Math.max(0, Math.cos(theta * Math.PI * 2 * (spec.runes ?? 12))), 8)
    : 0;
  const runeRing = isMagicCircle
    ? Math.exp(-Math.pow((r - 0.46) / 0.07, 2)) * (0.35 + 0.65 * ticks)
    : 0;
  const rawEnergy = clamp01(mainRing + runeRing + outerDust * ripple);
  const energy = posterizeValue(rawEnergy, spec.posterize);
  const alpha = clamp01(energy) * (1 - smoothstep(0.92, 1.0, r));
  return { rgb: samplePaletteGradient(palette, energy), alpha };
};

const evalStylizedSmoke = (
  u: number,
  v: number,
  spec: VfxTextureSpec,
  palette: VfxPalette,
): SampleOutput => {
  const curlScale = spec.curlScale ?? 2.8;
  const dx = (u - 0.5) * 2;
  const dy = (v - 0.5) * 2;
  const warpX = (noise2D(dx * curlScale, dy * curlScale, spec.seed) - 0.5) * 0.42;
  const warpY = (noise2D(dx * curlScale + 7.1, dy * curlScale + 3.7, spec.seed + 59) - 0.5) * 0.42;
  const r = Math.hypot(dx + warpX, dy + warpY);
  const lobeDist = r - 0.16 * Math.sin(Math.atan2(dy + warpY, dx + warpX) * 3 + spec.seed);
  const contour = 1 - smoothstep(0.56, 0.72, lobeDist);
  const rimHighlight = smoothstep(0.32, 0.56, lobeDist) * contour;
  const celLit = dx * -0.45 + dy * -0.65 + 0.5 > 0.42 ? 1 : 0;
  const toneHex = celLit
    ? lerpOklchHex(palette.edge, palette.mid, 0.48 + rimHighlight * 0.35)
    : lerpOklchHex(palette.smoke, palette.edge, 0.55);
  return { rgb: hexToRgb01(toneHex), alpha: contour };
};

const sampleTexturePixel = (
  u: number,
  v: number,
  spec: VfxTextureSpec,
  palette: VfxPalette,
): SampleOutput => {
  switch (spec.kind) {
    case 'slash_streak':
      return evalSlashStreak(u, v, spec, palette);
    case 'radial_flare':
      return evalRadialFlare(u, v, spec, palette, false);
    case 'starburst':
      return evalRadialFlare(u, v, spec, palette, true);
    case 'ring_wave':
      return evalRingWave(u, v, spec, palette, false);
    case 'magic_circle':
      return evalRingWave(u, v, spec, palette, true);
    case 'stylized_smoke':
      return evalStylizedSmoke(u, v, spec, palette);
  }
};

/**
 * Synthesize a deterministic 8-bit soft-alpha (0..255) painterly VFX RGBA buffer
 * with premultiplied luminous glow encoding compatible with vanilla glTF viewers.
 */
export const synthesizeVfxTexture = (
  spec: VfxTextureSpec,
  palette: VfxPalette,
): VfxTextureBuffer => {
  const width = Math.max(8, Math.min(512, Math.round(spec.width)));
  const height = Math.max(8, Math.min(512, Math.round(spec.height)));
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const v = (y + 0.5) / height;
    for (let x = 0; x < width; x += 1) {
      const u = (x + 0.5) / width;
      const sample = sampleTexturePixel(u, v, spec, palette);
      writeVfxRgbaPixel(rgba, (y * width + x) * 4, sample.rgb, sample.alpha, spec.blendMode);
    }
  }
  return Object.freeze({
    kind: spec.kind,
    width,
    height,
    rgba,
    alphaMode: 'soft',
    blendMode: spec.blendMode,
    premultiplied: spec.blendMode !== 'blend',
    extras: Object.freeze({
      ashfoxBlendMode: spec.blendMode,
      ashfoxUnlit: true as const,
    }),
  });
};
