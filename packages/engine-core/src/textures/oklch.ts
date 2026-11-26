export type RampPreset =
  'warm' | 'cool' | 'metal' | 'gem' | 'wood' | 'stone' | 'organic' | 'cloth' | 'emissive' | 'vivid';

export const RAMP_PRESETS: readonly RampPreset[] = Object.freeze([
  'warm',
  'cool',
  'metal',
  'gem',
  'wood',
  'stone',
  'organic',
  'cloth',
  'emissive',
  'vivid',
]);

export interface OklchColor {
  readonly l: number;
  readonly c: number;
  readonly h: number;
}

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

const srgbToLinear = (c: number): number =>
  c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;

const linearToSrgb = (c: number): number =>
  c <= 0.0031308 ? c * 12.92 : 1.055 * clamp01(c) ** (1 / 2.4) - 0.055;

const HEX_DIGITS = '0123456789abcdef';

const hexNibble = (code: number): number => {
  if (code >= 48 && code <= 57) return code - 48;
  if (code >= 97 && code <= 102) return code - 87;
  return code >= 65 && code <= 70 ? code - 55 : 0;
};

const parseHexChannels = (hex: string): readonly [number, number, number] => [
  ((hexNibble(hex.charCodeAt(1)) << 4) | hexNibble(hex.charCodeAt(2))) / 255,
  ((hexNibble(hex.charCodeAt(3)) << 4) | hexNibble(hex.charCodeAt(4))) / 255,
  ((hexNibble(hex.charCodeAt(5)) << 4) | hexNibble(hex.charCodeAt(6))) / 255,
];

const formatHexChannel = (v: number): string => {
  const n = Math.max(0, Math.min(255, Math.round(clamp01(v) * 255)));
  return HEX_DIGITS[n >>> 4]! + HEX_DIGITS[n & 15]!;
};

export const relativeLuminance = (hex: string): number => {
  const [r, g, b] = parseHexChannels(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

export const hexToOklch = (hex: string): OklchColor => {
  const [sr, sg, sb] = parseHexChannels(hex);
  const r = srgbToLinear(sr),
    g = srgbToLinear(sg),
    b = srgbToLinear(sb);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bv = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const c = Math.hypot(a, bv);
  const h = c < 1e-6 ? 0 : ((Math.atan2(bv, a) * 180) / Math.PI + 360) % 360;
  return { l: L, c, h };
};

const oklchToLinearRgb = (color: OklchColor): readonly [number, number, number] => {
  const rad = (color.h * Math.PI) / 180;
  const a = color.c * Math.cos(rad);
  const bv = color.c * Math.sin(rad);
  const l_ = color.l + 0.3963377774 * a + 0.2158037573 * bv;
  const m_ = color.l - 0.1055613458 * a - 0.0638541728 * bv;
  const s_ = color.l - 0.0894841775 * a - 1.291485548 * bv;
  const l = l_ * l_ * l_,
    m = m_ * m_ * m_,
    s = s_ * s_ * s_;
  return [
    +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
};

const inGamut = (rgb: readonly [number, number, number]): boolean =>
  rgb[0] >= -1e-4 &&
  rgb[0] <= 1.0001 &&
  rgb[1] >= -1e-4 &&
  rgb[1] <= 1.0001 &&
  rgb[2] >= -1e-4 &&
  rgb[2] <= 1.0001;

export const oklchToHex = (color: OklchColor): string => {
  const l = clamp01(color.l);
  let low = 0;
  let high = Math.max(0, color.c);
  if (!inGamut(oklchToLinearRgb({ l, c: high, h: color.h }))) {
    for (let i = 0; i < 14; i += 1) {
      const mid = (low + high) * 0.5;
      if (inGamut(oklchToLinearRgb({ l, c: mid, h: color.h }))) low = mid;
      else high = mid;
    }
  } else {
    low = high;
  }
  const [r, g, b] = oklchToLinearRgb({ l, c: low, h: color.h });
  return (
    '#' +
    formatHexChannel(linearToSrgb(r)) +
    formatHexChannel(linearToSrgb(g)) +
    formatHexChannel(linearToSrgb(b))
  );
};

const shortestHueDelta = (from: number, to: number): number => {
  const diff = ((to - from + 540) % 360) - 180;
  return diff;
};

export const shiftHueToward = (hue: number, target: number, amount: number): number =>
  (hue + shortestHueDelta(hue, target) * amount + 360) % 360;

export const lerpOklchHex = (leftHex: string, rightHex: string, t: number): string => {
  const a = hexToOklch(leftHex);
  const b = hexToOklch(rightHex);
  const w = clamp01(t);
  const hue = a.c < 1e-4 ? b.h : b.c < 1e-4 ? a.h : shiftHueToward(a.h, b.h, w);
  return oklchToHex({ l: a.l + (b.l - a.l) * w, c: a.c + (b.c - a.c) * w, h: hue });
};

interface PresetProfile {
  readonly shadowHueTarget: number;
  readonly shadowHuePull: number;
  readonly lightHueTarget: number;
  readonly lightHuePull: number;
  readonly shadowDrop: number;
  readonly lightLift: number;
  readonly shadowChromaScale: number;
  readonly lightChromaScale: number;
}

const PRESET_PROFILES: Readonly<Record<RampPreset, PresetProfile>> = {
  warm: {
    shadowHueTarget: 355,
    shadowHuePull: 0.2,
    lightHueTarget: 78,
    lightHuePull: 0.24,
    shadowDrop: 0.24,
    lightLift: 0.2,
    shadowChromaScale: 1.04,
    lightChromaScale: 0.88,
  },
  cool: {
    shadowHueTarget: 260,
    shadowHuePull: 0.28,
    lightHueTarget: 195,
    lightHuePull: 0.22,
    shadowDrop: 0.23,
    lightLift: 0.2,
    shadowChromaScale: 1.08,
    lightChromaScale: 0.85,
  },
  metal: {
    shadowHueTarget: 252,
    shadowHuePull: 0.28,
    lightHueTarget: 205,
    lightHuePull: 0.18,
    shadowDrop: 0.27,
    lightLift: 0.26,
    shadowChromaScale: 1.15,
    lightChromaScale: 0.55,
  },
  gem: {
    shadowHueTarget: 270,
    shadowHuePull: 0.24,
    lightHueTarget: 190,
    lightHuePull: 0.22,
    shadowDrop: 0.26,
    lightLift: 0.24,
    shadowChromaScale: 1.15,
    lightChromaScale: 0.72,
  },
  wood: {
    shadowHueTarget: 38,
    shadowHuePull: 0.24,
    lightHueTarget: 82,
    lightHuePull: 0.22,
    shadowDrop: 0.24,
    lightLift: 0.19,
    shadowChromaScale: 0.96,
    lightChromaScale: 0.88,
  },
  stone: {
    shadowHueTarget: 250,
    shadowHuePull: 0.2,
    lightHueTarget: 215,
    lightHuePull: 0.14,
    shadowDrop: 0.23,
    lightLift: 0.18,
    shadowChromaScale: 1.05,
    lightChromaScale: 0.78,
  },
  organic: {
    shadowHueTarget: 210,
    shadowHuePull: 0.22,
    lightHueTarget: 98,
    lightHuePull: 0.24,
    shadowDrop: 0.24,
    lightLift: 0.2,
    shadowChromaScale: 1.05,
    lightChromaScale: 0.92,
  },
  cloth: {
    shadowHueTarget: 275,
    shadowHuePull: 0.22,
    lightHueTarget: 82,
    lightHuePull: 0.18,
    shadowDrop: 0.22,
    lightLift: 0.19,
    shadowChromaScale: 1.08,
    lightChromaScale: 0.86,
  },
  emissive: {
    shadowHueTarget: 285,
    shadowHuePull: 0.14,
    lightHueTarget: 88,
    lightHuePull: 0.24,
    shadowDrop: 0.23,
    lightLift: 0.22,
    shadowChromaScale: 1.1,
    lightChromaScale: 0.78,
  },
  vivid: {
    shadowHueTarget: 275,
    shadowHuePull: 0.24,
    lightHueTarget: 75,
    lightHuePull: 0.28,
    shadowDrop: 0.24,
    lightLift: 0.22,
    shadowChromaScale: 1.16,
    lightChromaScale: 0.92,
  },
};

const enforceSafeShadowFloor = (hex: string, color: OklchColor): string => {
  if (relativeLuminance(hex) >= 0.145) return hex;
  let l = color.l;
  for (let i = 0; i < 12; i += 1) {
    l = Math.min(0.95, l + 0.03);
    const candidate = oklchToHex({ l, c: color.c, h: color.h });
    if (relativeLuminance(candidate) >= 0.145) return candidate;
  }
  return oklchToHex({ l: 0.34, c: color.c, h: color.h });
};

const liftAboveLuminance = (color: OklchColor, minLum: number): string => {
  let l = color.l;
  for (let i = 0; i < 16; i += 1) {
    const candidate = oklchToHex({ l, c: color.c, h: color.h });
    if (relativeLuminance(candidate) >= minLum) return candidate;
    l = Math.min(0.98, l + 0.035);
  }
  return oklchToHex({ l: 0.96, c: color.c * 0.5, h: color.h });
};

/** Generate a hue-shifted 3-stop [shadow, base, light] ramp in OKLCH space. */
export const generateHueShiftedRamp = (
  baseHex: string,
  preset: RampPreset,
): readonly [string, string, string] => {
  const p = PRESET_PROFILES[preset];
  const raw = hexToOklch(baseHex);
  const clampedL = Math.max(
    0.4,
    Math.min(0.84, preset === 'emissive' ? Math.max(0.56, raw.l) : raw.l),
  );
  const shadowColor: OklchColor = {
    l: Math.max(0.24, Math.min(clampedL - p.shadowDrop, clampedL - 0.11)),
    c: Math.min(0.32, raw.c * p.shadowChromaScale + (raw.c < 0.03 ? 0.012 : 0)),
    h: raw.c < 0.02 ? p.shadowHueTarget : shiftHueToward(raw.h, p.shadowHueTarget, p.shadowHuePull),
  };
  const shadow = enforceSafeShadowFloor(oklchToHex(shadowColor), shadowColor);
  const shadowLum = relativeLuminance(shadow);
  const safeBase = liftAboveLuminance({ l: clampedL, c: raw.c, h: raw.h }, shadowLum + 0.09);
  const baseLum = relativeLuminance(safeBase);
  const lightColor: OklchColor = {
    l: Math.min(0.97, Math.max(clampedL + p.lightLift, hexToOklch(safeBase).l + 0.11)),
    c: Math.min(0.32, raw.c * p.lightChromaScale + (raw.c < 0.03 ? 0.008 : 0)),
    h: raw.c < 0.02 ? p.lightHueTarget : shiftHueToward(raw.h, p.lightHueTarget, p.lightHuePull),
  };
  const light = liftAboveLuminance(lightColor, Math.min(0.95, baseLum + 0.11));
  return Object.freeze([shadow, safeBase, light]);
};

/** Expand a 3-stop ramp into a smooth 5-stop perceptual ramp in OKLCH space. */
export const expandRampFive = (
  stops: readonly [string, string, string],
): readonly [string, string, string, string, string] =>
  Object.freeze([
    stops[0],
    lerpOklchHex(stops[0], stops[1], 0.5),
    stops[1],
    lerpOklchHex(stops[1], stops[2], 0.5),
    stops[2],
  ]);
