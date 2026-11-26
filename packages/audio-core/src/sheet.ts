import { evaluateSoundQuality, type SoundAuditReport } from './audit';
import { analyzeSoundProducts, decodeWavMono, FFT_SIZE, type SoundMetrics } from './auditMetrics';
import type { SoundProduct } from './contract';

const W = 800;
const H = 520;
const PW = 400;
const PH = 260;

type Rgba = readonly [number, number, number, number];

const FONT: Readonly<Record<string, readonly number[]>> = {
  ' ': [0, 0, 0, 0, 0, 0, 0],
  '+': [0, 4, 4, 31, 4, 4, 0],
  '-': [0, 0, 0, 31, 0, 0, 0],
  '.': [0, 0, 0, 0, 0, 12, 12],
  '/': [1, 2, 2, 4, 8, 8, 16],
  ':': [0, 12, 12, 0, 12, 12, 0],
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
  K: [17, 18, 20, 24, 20, 18, 17],
  L: [16, 16, 16, 16, 16, 16, 31],
  M: [17, 27, 21, 21, 17, 17, 17],
  N: [17, 25, 21, 19, 17, 17, 17],
  O: [14, 17, 17, 17, 17, 17, 14],
  P: [30, 17, 17, 30, 16, 16, 16],
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

const fill = (buf: Uint8Array, x: number, y: number, w: number, h: number, c: Rgba): void => {
  const x0 = Math.max(0, Math.floor(x)),
    y0 = Math.max(0, Math.floor(y));
  const x1 = Math.min(W, Math.floor(x + w)),
    y1 = Math.min(H, Math.floor(y + h));
  for (let py = y0; py < y1; py += 1) {
    for (let px = x0; px < x1; px += 1) {
      const i = (py * W + px) * 4;
      buf[i] = c[0];
      buf[i + 1] = c[1];
      buf[i + 2] = c[2];
      buf[i + 3] = c[3];
    }
  }
};

const drawText = (
  buf: Uint8Array,
  text: string,
  x: number,
  y: number,
  c: Rgba,
  scale = 1,
): void => {
  const s = text.toUpperCase();
  for (let i = 0; i < s.length; i += 1) {
    const g = FONT[s[i]!] ?? FONT[' '];
    for (let r = 0; r < 7; r += 1) {
      for (let col = 0; col < 5; col += 1) {
        if ((g[r]! & (16 >> col)) !== 0)
          fill(buf, x + (i * 6 + col) * scale, y + r * scale, scale, scale, c);
      }
    }
  }
};

const drawBadge = (buf: Uint8Array, x: number, y: number, label: string): void => {
  fill(buf, x, y, label.length * 6 + 11, 15, [14, 18, 26, 255]);
  drawText(buf, label, x + 6, y + 4, [240, 244, 248, 255]);
};

const magmaColor = (norm: number): Rgba => {
  const t = Math.max(0, Math.min(1, norm));
  if (t < 0.35) {
    const u = t / 0.35;
    return [Math.round(18 + u * 105), Math.round(16 + u * 18), Math.round(32 + u * 96), 255];
  }
  if (t < 0.72) {
    const u = (t - 0.35) / 0.37;
    return [Math.round(123 + u * 112), Math.round(34 + u * 96), Math.round(128 - u * 75), 255];
  }
  const u = (t - 0.72) / 0.28;
  return [Math.round(235 + u * 20), Math.round(130 + u * 115), Math.round(53 + u * 150), 255];
};

const drawWaveformPanel = (buf: Uint8Array, mono: Float64Array, m: SoundMetrics): void => {
  const plotX = 18,
    plotY = 36,
    plotW = PW - 36,
    plotH = PH - 68;
  const midY = plotY + plotH / 2;
  fill(buf, plotX, midY, plotW, 1, [48, 56, 70, 255]);
  for (let x = 0; x < plotW; x += 1) {
    const a = Math.floor((x * mono.length) / plotW);
    const b = Math.max(a + 1, Math.floor(((x + 1) * mono.length) / plotW));
    let min = 0,
      max = 0,
      sq = 0;
    for (let i = a; i < b; i += 1) {
      const s = mono[i]!;
      if (s < min) min = s;
      if (s > max) max = s;
      sq += s * s;
    }
    const yTop = midY - max * (plotH * 0.48);
    const yBot = midY - min * (plotH * 0.48);
    fill(buf, plotX + x, yTop, 1, Math.max(1, yBot - yTop), [220, 163, 95, 255]);
    const rmsH = Math.sqrt(sq / (b - a)) * (plotH * 0.48);
    fill(buf, plotX + x, midY - rmsH, 1, Math.max(1, rmsH * 2), [250, 212, 138, 255]);
  }
  drawText(
    buf,
    `PK ${m.peakDb.toFixed(1)}DB  RMS ${m.rmsDb.toFixed(1)}DB  CREST ${m.crestDb.toFixed(1)}DB`,
    18,
    PH - 20,
    [185, 198, 214, 255],
  );
};

const drawSpectrogramPanel = (buf: Uint8Array, m: SoundMetrics, rate: number): void => {
  const plotX = PW + 18,
    plotY = 36,
    plotW = PW - 36,
    plotH = PH - 68;
  const frames = m.spectrogram;
  const minLog = Math.log(45),
    maxLog = Math.log(16000);
  for (let y = 0; y < plotH; y += 2) {
    const hz = Math.exp(maxLog - (y / plotH) * (maxLog - minLog));
    const bin = Math.min(FFT_SIZE / 2 - 1, Math.max(1, Math.round((hz * FFT_SIZE) / rate)));
    for (let x = 0; x < plotW; x += 2) {
      const fIdx = Math.min(frames.length - 1, Math.floor((x / plotW) * frames.length));
      const db = 20 * Math.log10(Math.max(1e-5, frames[fIdx]![bin]!));
      const norm = (db + 78) / 72;
      fill(buf, plotX + x, plotY + y, 2, 2, magmaColor(norm));
    }
  }
  drawText(
    buf,
    `CENTROID ${Math.round(m.spectralCentroidHz)}HZ  ENT ${m.spectralEntropy.toFixed(2)}  FLUX ${m.spectralFlux.toFixed(2)}`,
    PW + 18,
    PH - 20,
    [185, 198, 214, 255],
  );
};

const drawSpectrumBarsPanel = (buf: Uint8Array, m: SoundMetrics): void => {
  const entries: readonly (readonly [string, number])[] = [
    ['SUB', m.bands.sub],
    ['LOW', m.bands.low],
    ['LMID', m.bands.lowMid],
    ['HMID', m.bands.highMid],
    ['PRES', m.bands.presence],
    ['AIR', m.bands.air],
  ];
  entries.forEach(([label, val], idx) => {
    const y = PH + 48 + idx * 32;
    drawText(buf, label, 20, y + 6, [195, 208, 222, 255]);
    fill(buf, 64, y + 2, 270, 16, [28, 34, 46, 255]);
    const barW = Math.round(Math.min(1, val * 1.45) * 268);
    fill(buf, 65, y + 3, barW, 14, [96, 185, 232, 255]);
    drawText(buf, `${Math.round(val * 100)}`, 344, y + 6, [225, 232, 240, 255]);
  });
};

const drawLoopSeam = (
  buf: Uint8Array,
  mono: Float64Array,
  ox: number,
  oy: number,
  pw: number,
  ph: number,
): void => {
  const midY = oy + ph / 2;
  const span = Math.min(960, Math.floor(mono.length / 2));
  fill(buf, ox + pw / 2, oy, 1, ph, [240, 100, 100, 255]);
  for (let x = 0; x < pw; x += 1) {
    const idx =
      x < pw / 2
        ? mono.length - span + Math.floor((x / (pw / 2)) * span)
        : Math.floor(((x - pw / 2) / (pw / 2)) * span);
    const s = mono[Math.max(0, Math.min(mono.length - 1, idx))]!;
    const y = midY - s * (ph * 0.45);
    fill(buf, ox + x, Math.min(midY, y), 1, Math.max(1, Math.abs(y - midY)), [120, 220, 175, 255]);
  }
};

const drawVariantEnvelopes = (
  buf: Uint8Array,
  products: readonly SoundProduct[],
  ox: number,
  oy: number,
  pw: number,
  ph: number,
): void => {
  const colors: readonly Rgba[] = [
    [220, 163, 95, 255],
    [96, 185, 232, 255],
    [140, 220, 150, 255],
  ];
  products.slice(0, 3).forEach((p, idx) => {
    const pm = analyzeSoundProducts([p]);
    const peak = Math.max(1e-6, ...pm.envelope);
    for (let x = 0; x < pw; x += 1) {
      const ei = Math.min(pm.envelope.length - 1, Math.floor((x / pw) * pm.envelope.length));
      const h = (pm.envelope[ei]! / peak) * (ph * 0.8);
      fill(buf, ox + x, oy + ph - h, 1, Math.max(1, h), colors[idx % colors.length]!);
    }
  });
};

const drawSeamOrAuditPanel = (
  buf: Uint8Array,
  products: readonly SoundProduct[],
  mono: Float64Array,
  m: SoundMetrics,
  audit: SoundAuditReport,
): void => {
  const primary = products[0]!;
  if (primary.playback.kind === 'loop') drawLoopSeam(buf, mono, PW + 18, PH + 40, PW - 36, 128);
  else drawVariantEnvelopes(buf, products, PW + 18, PH + 40, PW - 36, 128);
  drawText(
    buf,
    `SCORE ${audit.score} ${audit.grade} (${audit.profile})`,
    PW + 18,
    PH + 184,
    audit.passed ? [130, 230, 150, 255] : [245, 110, 110, 255],
    2,
  );
  drawText(
    buf,
    `${primary.channels}CH ${primary.frames}F VAR ${m.variantDistinctness.toFixed(3)}`,
    PW + 18,
    PH + 216,
    [185, 198, 214, 255],
  );
};

/** Pure-CPU 4-panel 800x520 inspection sheet RGBA buffer for Sound v2 products. */
export const renderSoundInspectSheet = (
  products: readonly SoundProduct[],
  audit: SoundAuditReport = evaluateSoundQuality(products),
): { readonly width: number; readonly height: number; readonly rgba: Uint8Array } => {
  const buf = new Uint8Array(W * H * 4);
  fill(buf, 0, 0, W, H, [18, 22, 30, 255]);
  const primary = products[0]!;
  const mono = decodeWavMono(primary.wav, primary.channels);
  const metrics = analyzeSoundProducts(products);
  drawWaveformPanel(buf, mono, metrics);
  drawSpectrogramPanel(buf, metrics, primary.sampleRate);
  drawSpectrumBarsPanel(buf, metrics);
  drawSeamOrAuditPanel(buf, products, mono, metrics, audit);
  drawBadge(buf, 8, 8, `WAVEFORM + ENV (${primary.variant})`);
  drawBadge(buf, PW + 8, 8, 'SPECTROGRAM (LOG)');
  drawBadge(buf, 8, PH + 8, '6-BAND SPECTRUM');
  drawBadge(
    buf,
    PW + 8,
    PH + 8,
    primary.playback.kind === 'loop' ? 'LOOP SEAM + AUDIT' : 'VARIANTS + AUDIT',
  );
  fill(buf, PW - 1, 0, 2, H, [42, 48, 60, 255]);
  fill(buf, 0, PH - 1, W, 2, [42, 48, 60, 255]);
  return { width: W, height: H, rgba: buf };
};
