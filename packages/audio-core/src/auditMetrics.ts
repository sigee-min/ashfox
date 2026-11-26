import type { SoundProduct } from './contract';

export const FFT_SIZE = 1024;
export const HOP_SIZE = 512;

export interface BandEnergies {
  readonly sub: number;
  readonly low: number;
  readonly lowMid: number;
  readonly highMid: number;
  readonly presence: number;
  readonly air: number;
}

export interface SoundMetrics {
  readonly peakDb: number;
  readonly rmsDb: number;
  readonly crestDb: number;
  readonly leadingSilenceRatio: number;
  readonly trailingSilenceRatio: number;
  readonly attackSeconds: number;
  readonly activeRatio: number;
  readonly bands: BandEnergies;
  readonly spectralCentroidHz: number;
  readonly spectralEntropy: number;
  readonly spectralFlux: number;
  readonly loopSeamJump: number;
  readonly variantDistinctness: number;
  readonly spectrogram: readonly Float64Array[];
  readonly envelope: readonly number[];
}

const HANN = Float64Array.from(
  { length: FFT_SIZE },
  (_, i) => 0.5 * (1 - Math.cos((2 * Math.PI * i) / (FFT_SIZE - 1))),
);

export const decodeWavMono = (wav: Uint8Array, channels: 1 | 2): Float64Array => {
  const frames = Math.floor((wav.length - 44) / (2 * channels));
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  const mono = new Float64Array(frames);
  for (let i = 0; i < frames; i += 1) {
    let sum = 0;
    for (let ch = 0; ch < channels; ch += 1) {
      sum += view.getInt16(44 + (i * channels + ch) * 2, true) / 32767;
    }
    mono[i] = sum / channels;
  }
  return mono;
};

const bitReverse = (re: Float64Array, im: Float64Array): void => {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1;
    for (; (j & bit) !== 0; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j]!, re[i]!];
      [im[i], im[j]] = [im[j]!, im[i]!];
    }
  }
};

const fftInPlace = (re: Float64Array, im: Float64Array): void => {
  const n = re.length;
  bitReverse(re, im);
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1;
    const ang = (-2 * Math.PI) / len;
    const wRe = Math.cos(ang),
      wIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let curRe = 1,
        curIm = 0;
      for (let j = 0; j < half; j += 1) {
        const uRe = re[i + j]!,
          uIm = im[i + j]!;
        const vRe = re[i + j + half]! * curRe - im[i + j + half]! * curIm;
        const vIm = re[i + j + half]! * curIm + im[i + j + half]! * curRe;
        re[i + j] = uRe + vRe;
        im[i + j] = uIm + vIm;
        re[i + j + half] = uRe - vRe;
        im[i + j + half] = uIm - vIm;
        const nextRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = nextRe;
      }
    }
  }
};

const computeSpectrumFrame = (mono: Float64Array, start: number): Float64Array => {
  const re = new Float64Array(FFT_SIZE);
  const im = new Float64Array(FFT_SIZE);
  for (let i = 0; i < FFT_SIZE; i += 1) {
    re[i] = (mono[start + i] ?? 0) * HANN[i]!;
  }
  fftInPlace(re, im);
  const bins = FFT_SIZE / 2;
  const mag = new Float64Array(bins);
  for (let k = 0; k < bins; k += 1) mag[k] = Math.hypot(re[k]!, im[k]!) / (FFT_SIZE * 0.5);
  return mag;
};

const bandIndex = (hz: number): keyof BandEnergies | null => {
  if (hz < 20 || hz >= 16000) return null;
  if (hz < 80) return 'sub';
  if (hz < 250) return 'low';
  if (hz < 800) return 'lowMid';
  if (hz < 2500) return 'highMid';
  if (hz < 6000) return 'presence';
  return 'air';
};

const measureOnsetAttack = (
  mono: Float64Array,
  firstActive: number,
  lastActive: number,
  peak: number,
  rate: number,
): number => {
  const highThresh = peak * 0.5;
  let crossing = firstActive;
  while (crossing < lastActive && Math.abs(mono[crossing]!) < highThresh) crossing += 1;
  const searchEnd = Math.min(lastActive, crossing + Math.round(rate * 0.06));
  let peakIdx = firstActive;
  let peakAbs = 0;
  for (let i = firstActive; i <= searchEnd; i += 1) {
    if (Math.abs(mono[i]!) > peakAbs) {
      peakAbs = Math.abs(mono[i]!);
      peakIdx = i;
    }
  }
  let rise10 = firstActive;
  while (rise10 < peakIdx && Math.abs(mono[rise10]!) < peakAbs * 0.1) rise10 += 1;
  return Math.max(0, peakIdx - rise10) / rate;
};

const computeEnvelopeStats = (mono: Float64Array, peak: number, rate: number) => {
  const win = 240;
  const count = Math.max(1, Math.floor(mono.length / win));
  const envelope: number[] = [];
  for (let b = 0; b < count; b += 1) {
    let sum = 0;
    const start = b * win,
      end = Math.min(mono.length, start + win);
    for (let i = start; i < end; i += 1) sum += mono[i]! * mono[i]!;
    envelope.push(Math.sqrt(sum / Math.max(1, end - start)));
  }
  const thresh = Math.max(1e-4, peak * 0.02);
  let firstActive = 0,
    lastActive = mono.length - 1;
  while (firstActive < mono.length && Math.abs(mono[firstActive]!) < thresh) firstActive += 1;
  while (lastActive > firstActive && Math.abs(mono[lastActive]!) < thresh) lastActive -= 1;
  return {
    envelope,
    leadingSilenceRatio: firstActive / Math.max(1, mono.length),
    trailingSilenceRatio: (mono.length - 1 - lastActive) / Math.max(1, mono.length),
    activeRatio: Math.max(0, lastActive - firstActive + 1) / Math.max(1, mono.length),
    attackSeconds: measureOnsetAttack(mono, firstActive, lastActive, peak, rate),
  };
};

const frameMagSum = (frame: Float64Array, bins: number): number => {
  let sum = 0;
  for (let k = 1; k < bins; k += 1) sum += frame[k]!;
  return sum;
};

const frameShapeDiff = (
  cur: Float64Array,
  prev: Float64Array,
  curSum: number,
  prevSum: number,
  bins: number,
): number => {
  let diff = 0;
  for (let k = 1; k < bins; k += 1) {
    diff += Math.abs(cur[k]! / curSum - prev[k]! / prevSum);
  }
  return Math.min(1, diff * 0.5);
};

const accumulateFlux = (
  frames: readonly Float64Array[],
  bins: number,
): { readonly meanPower: Float64Array; readonly fluxSum: number; readonly fluxCount: number } => {
  const meanPower = new Float64Array(bins);
  let fluxSum = 0;
  let fluxCount = 0;
  let prevSum = 0;
  for (let f = 0; f < frames.length; f += 1) {
    const cur = frames[f]!;
    for (let k = 1; k < bins; k += 1) meanPower[k] += cur[k]! * cur[k]!;
    const curSum = frameMagSum(cur, bins);
    if (f > 0 && curSum > 1e-5 && prevSum > 1e-5) {
      fluxSum += frameShapeDiff(cur, frames[f - 1]!, curSum, prevSum, bins);
      fluxCount += 1;
    }
    prevSum = curSum;
  }
  return { meanPower, fluxSum, fluxCount };
};

const accumulateBands = (
  meanPower: Float64Array,
  frameCount: number,
  bins: number,
  rate: number,
) => {
  const bands = { sub: 0, low: 0, lowMid: 0, highMid: 0, presence: 0, air: 0 };
  const logBins = new Float64Array(24);
  const logMin = Math.log(40);
  const logRange = Math.log(16000) - logMin;
  let totalPower = 0;
  let weightedHz = 0;
  for (let k = 1; k < bins; k += 1) {
    const p = meanPower[k]! / Math.max(1, frameCount);
    const hz = (k * rate) / FFT_SIZE;
    totalPower += p;
    weightedHz += p * hz;
    const b = bandIndex(hz);
    if (b) bands[b] += p;
    if (hz >= 40 && hz < 16000) {
      const li = Math.min(23, Math.floor(((Math.log(hz) - logMin) / logRange) * 24));
      logBins[li] += p;
    }
  }
  return { bands, logBins, totalPower, weightedHz };
};

const computeSpectralEntropy = (logBins: Float64Array, safeTotal: number): number => {
  let entropy = 0;
  for (let li = 0; li < 24; li += 1) {
    const prob = logBins[li]! / safeTotal;
    if (prob > 1e-9) entropy -= prob * Math.log2(prob);
  }
  return Math.min(1, entropy / Math.log2(24));
};

const summarizeSpectra = (frames: readonly Float64Array[], rate: number) => {
  const bins = FFT_SIZE / 2;
  const { meanPower, fluxSum, fluxCount } = accumulateFlux(frames, bins);
  const { bands, logBins, totalPower, weightedHz } = accumulateBands(
    meanPower,
    frames.length,
    bins,
    rate,
  );
  const safeTotal = Math.max(1e-18, totalPower);
  return {
    bands: {
      sub: bands.sub / safeTotal,
      low: bands.low / safeTotal,
      lowMid: bands.lowMid / safeTotal,
      highMid: bands.highMid / safeTotal,
      presence: bands.presence / safeTotal,
      air: bands.air / safeTotal,
    },
    spectralCentroidHz: weightedHz / safeTotal,
    spectralEntropy: computeSpectralEntropy(logBins, safeTotal),
    spectralFlux: fluxCount > 0 ? Math.min(1, fluxSum / fluxCount) : 0,
  };
};

const computeVariantDistinctness = (products: readonly SoundProduct[]): number => {
  if (products.length < 2) return 1;
  const a = decodeWavMono(products[0]!.wav, products[0]!.channels);
  let sumDiff = 0;
  let comparisons = 0;
  for (let p = 1; p < products.length; p += 1) {
    const b = decodeWavMono(products[p]!.wav, products[p]!.channels);
    const len = Math.min(a.length, b.length);
    let diffSq = 0,
      energy = 0;
    for (let i = 0; i < len; i += 1) {
      diffSq += (a[i]! - b[i]!) ** 2;
      energy += a[i]! * a[i]! + b[i]! * b[i]!;
    }
    sumDiff += energy > 1e-12 ? Math.sqrt(diffSq / energy) : 0;
    comparisons += 1;
  }
  return comparisons > 0 ? sumDiff / comparisons : 1;
};

export const analyzeSingleProduct = (
  product: SoundProduct,
  variantDistinctness = 1,
): SoundMetrics => {
  const mono = decodeWavMono(product.wav, product.channels);
  const env = computeEnvelopeStats(mono, product.peak, product.sampleRate);
  const frames: Float64Array[] = [];
  for (let start = 0; start + FFT_SIZE <= mono.length; start += HOP_SIZE) {
    frames.push(computeSpectrumFrame(mono, start));
  }
  if (frames.length === 0) frames.push(computeSpectrumFrame(mono, 0));
  const spec = summarizeSpectra(frames, product.sampleRate);
  const peakDb = 20 * Math.log10(Math.max(1e-8, product.peak));
  const rmsDb = 20 * Math.log10(Math.max(1e-8, product.rms));
  return {
    peakDb,
    rmsDb,
    crestDb: peakDb - rmsDb,
    ...env,
    ...spec,
    loopSeamJump: product.rms > 1e-6 ? product.seamDelta / Math.max(0.15, product.peak) : 0,
    variantDistinctness,
    spectrogram: frames,
  };
};

export const analyzeSoundProducts = (products: readonly SoundProduct[]): SoundMetrics =>
  analyzeSingleProduct(products[0]!, computeVariantDistinctness(products));
