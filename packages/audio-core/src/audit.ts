import type { SoundProduct, SoundProfile } from './contract';
import { analyzeSingleProduct, analyzeSoundProducts, type SoundMetrics } from './auditMetrics';

export type SoundQualityGrade = 'fail' | 'needs_work' | 'pass' | 'excellent';
export type SoundAuditPillarId = 'dynamics' | 'spectrum' | 'polish';
export type SoundGateId =
  | 'audible_headroom'
  | 'no_dc_offset'
  | 'bounded_silence'
  | 'spectral_non_trivial'
  | 'loop_continuity'
  | 'variant_distinctness';

export interface SoundAuditSubmetric {
  readonly id: string;
  readonly label: string;
  readonly score: number;
  readonly maxScore: number;
  readonly value: number;
  readonly target: number;
  readonly detail: string;
}

export interface SoundAuditGateResult {
  readonly id: SoundGateId;
  readonly passed: boolean;
  readonly message: string;
  readonly fix: string;
}

export interface SoundAuditPillarReport {
  readonly id: SoundAuditPillarId;
  readonly label: string;
  readonly score: number;
  readonly maxScore: number;
  readonly metrics: readonly SoundAuditSubmetric[];
}

export interface SoundAuditDeduction {
  readonly metricId: string;
  readonly pillar: SoundAuditPillarId | 'gate';
  readonly lostPoints: number;
  readonly summary: string;
  readonly fix: string;
}

export interface SoundAuditOptions {
  readonly profile?: SoundProfile;
  readonly threshold?: number;
}

export interface SoundAuditReport {
  readonly schemaVersion: 1;
  readonly profile: SoundProfile;
  readonly profileSource: 'authored' | 'override';
  readonly threshold: number;
  readonly passed: boolean;
  readonly score: number;
  readonly grade: SoundQualityGrade;
  readonly hardGates: readonly SoundAuditGateResult[];
  readonly pillars: readonly SoundAuditPillarReport[];
  readonly topDeductions: readonly SoundAuditDeduction[];
}

export const DEFAULT_SOUND_THRESHOLD = 75;

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));
const ramp = (v: number, lo: number, hi: number): number =>
  hi <= lo ? (v >= hi ? 1 : 0) : clamp01((v - lo) / (hi - lo));
const round2 = (v: number): number => Math.round(v * 100) / 100;
const round4 = (v: number): number => Math.round(v * 10000) / 10000;

const sub = (
  id: string,
  label: string,
  ratio: number,
  maxScore: number,
  value: number,
  target: number,
  detail: string,
): SoundAuditSubmetric => ({
  id,
  label,
  score: round2(clamp01(ratio) * maxScore),
  maxScore,
  value: round4(value),
  target,
  detail,
});

const gradeFor = (allGates: boolean, score: number, passed: boolean): SoundQualityGrade => {
  if (!allGates || score < 50) return 'fail';
  if (!passed || score < DEFAULT_SOUND_THRESHOLD) return 'needs_work';
  return score >= 85 ? 'excellent' : 'pass';
};

const gate = (
  id: SoundGateId,
  passed: boolean,
  okMessage: string,
  failMessage: string,
  fix: string,
): SoundAuditGateResult => ({
  id,
  passed,
  message: passed ? okMessage : failMessage,
  fix,
});

interface VariantSample {
  readonly product: SoundProduct;
  readonly metrics: SoundMetrics;
}

const findBadVariant = (
  samples: readonly VariantSample[],
  ok: (sample: VariantSample) => boolean,
): VariantSample | undefined => samples.find((sample) => !ok(sample));

const variantGate = (
  id: SoundGateId,
  bad: VariantSample | undefined,
  okMessage: string,
  failMessage: (sample: VariantSample) => string,
  fix: string,
): SoundAuditGateResult => gate(id, !bad, okMessage, bad ? failMessage(bad) : '', fix);

const evaluateSignalGates = (
  samples: readonly VariantSample[],
  m: SoundMetrics,
  isLoop: boolean,
): readonly SoundAuditGateResult[] => [
  variantGate(
    'audible_headroom',
    findBadVariant(samples, (s) => s.metrics.rmsDb >= -34 && s.metrics.peakDb <= -0.5),
    `RMS ${m.rmsDb.toFixed(1)} dBFS, peak ${m.peakDb.toFixed(1)} dBFS.`,
    (s) =>
      `Variant "${s.product.variant}" weak or over-hot (RMS ${s.metrics.rmsDb.toFixed(1)} dBFS, peak ${s.metrics.peakDb.toFixed(1)} dBFS).`,
    'Adjust output.gainDb (and softClip if needed) so every variant RMS is >= -34 dBFS with clean headroom.',
  ),
  variantGate(
    'no_dc_offset',
    findBadVariant(samples, (s) => Math.abs(s.product.dc) <= 0.025),
    `DC offset ${samples[0]!.product.dc.toFixed(4)} <= 0.025.`,
    (s) => `Variant "${s.product.variant}" excessive DC offset ${s.product.dc.toFixed(4)}.`,
    'Add a voice highpass filter (>= 25 Hz) to remove sub-sonic DC drift.',
  ),
  variantGate(
    'bounded_silence',
    findBadVariant(
      samples,
      (s) => isLoop || (s.metrics.leadingSilenceRatio <= 0.35 && s.metrics.activeRatio >= 0.15),
    ),
    `Active audio ${(m.activeRatio * 100).toFixed(0)}%, lead ${(m.leadingSilenceRatio * 100).toFixed(0)}%.`,
    (s) =>
      `Variant "${s.product.variant}" excessive dead silence (active ${(s.metrics.activeRatio * 100).toFixed(0)}%).`,
    'Trim excess silent padding or move sequence start closer to 0.',
  ),
];

const evaluateGates = (
  products: readonly SoundProduct[],
  m: SoundMetrics,
): readonly SoundAuditGateResult[] => {
  const samples: readonly VariantSample[] = products.map((product, i) => ({
    product,
    metrics: i === 0 ? m : analyzeSingleProduct(product, m.variantDistinctness),
  }));
  const isLoop = products[0]!.playback.kind === 'loop';
  return [
    ...evaluateSignalGates(samples, m, isLoop),
    variantGate(
      'spectral_non_trivial',
      findBadVariant(
        samples,
        (s) => s.metrics.spectralEntropy >= 0.14 || s.metrics.spectralFlux >= 0.06,
      ),
      `Entropy ${m.spectralEntropy.toFixed(2)}, flux ${m.spectralFlux.toFixed(2)}.`,
      (s) =>
        `Variant "${s.product.variant}" trivial static tone (entropy=${s.metrics.spectralEntropy.toFixed(2)}, flux=${s.metrics.spectralFlux.toFixed(2)}).`,
      'Layer harmonics, SVF filter sweep, drive, or textured noise rather than a bare static sine.',
    ),
    variantGate(
      'loop_continuity',
      findBadVariant(samples, (s) => !isLoop || s.metrics.loopSeamJump <= 0.35),
      `Loop seam jump ${m.loopSeamJump.toFixed(3)}.`,
      (s) =>
        `Variant "${s.product.variant}" loop seam discontinuity (${s.metrics.loopSeamJump.toFixed(3)} > 0.35).`,
      'Increase loop crossfade or ensure continuous voices span the loop boundaries.',
    ),
    gate(
      'variant_distinctness',
      products.length < 2 || m.variantDistinctness >= 0.002,
      `Variant delta ${m.variantDistinctness.toFixed(3)}.`,
      'Declared variants produce identical waveforms.',
      'Add pitch/timing/gain/duration vary or noise/breath/excitation randomness.',
    ),
  ];
};

const TARGET_CREST: Readonly<Record<SoundProfile, readonly [number, number]>> = {
  impact: [8, 22],
  foley: [6, 20],
  creature: [5, 18],
  magic: [4, 16],
  ui: [5, 16],
  ambient: [3, 14],
};

const evaluateDynamics = (
  profile: SoundProfile,
  m: SoundMetrics,
): {
  readonly pillar: SoundAuditPillarReport;
  readonly deductions: readonly SoundAuditDeduction[];
} => {
  const [cLo, cHi] = TARGET_CREST[profile];
  const crestRatio =
    m.crestDb < cLo ? ramp(m.crestDb, 1.5, cLo) : 1 - 0.5 * ramp(m.crestDb, cHi, cHi + 10);
  const attackRatio =
    profile === 'impact' || profile === 'ui' || profile === 'foley'
      ? 1 - ramp(m.attackSeconds, 0.025, 0.14)
      : profile === 'ambient' || profile === 'magic'
        ? 1
        : 1 - ramp(m.attackSeconds, 0.12, 0.6);
  const activeHi = profile === 'impact' || profile === 'foley' || profile === 'ui' ? 0.36 : 0.65;
  const shapeRatio =
    ramp(m.activeRatio, 0.14, activeHi) * (1 - ramp(m.leadingSilenceRatio, 0.12, 0.4));
  const metrics = [
    sub(
      'sound.crest',
      'Transient & Dynamic Range',
      crestRatio,
      13,
      m.crestDb,
      (cLo + cHi) * 0.5,
      `crest=${m.crestDb.toFixed(1)}dB`,
    ),
    sub(
      'sound.attack',
      'Profile Attack Fit',
      attackRatio,
      11,
      m.attackSeconds,
      0.02,
      `attack=${(m.attackSeconds * 1000).toFixed(0)}ms`,
    ),
    sub(
      'sound.envelope',
      'Active Envelope Framing',
      shapeRatio,
      11,
      m.activeRatio,
      0.7,
      `active=${(m.activeRatio * 100).toFixed(0)}%`,
    ),
  ];
  const score = round2(metrics.reduce((s, x) => s + x.score, 0));
  return {
    pillar: { id: 'dynamics', label: 'Dynamics & Envelope Craft', score, maxScore: 35, metrics },
    deductions: buildDeductions('dynamics', metrics, [
      'Shape punchy transients or controlled dynamics to match profile.',
      'Tighten attack curve/envelope for crisp impact/UI or natural swells.',
      'Reduce leading/trailing dead silence relative to total duration.',
    ]),
  };
};

const evaluateSpectrum = (
  m: SoundMetrics,
): {
  readonly pillar: SoundAuditPillarReport;
  readonly deductions: readonly SoundAuditDeduction[];
} => {
  const b = m.bands;
  const activeBands = [b.sub, b.low, b.lowMid, b.highMid, b.presence, b.air].filter(
    (v) => v >= 0.015,
  ).length;
  const balanceRatio =
    ramp(activeBands, 2, 4.5) * (1 - 0.7 * ramp(b.lowMid + b.highMid, 0.85, 0.99));
  const richnessRatio = ramp(m.spectralEntropy, 0.16, 0.5);
  const motionRatio = ramp(m.spectralFlux, 0.04, 0.24);
  const metrics = [
    sub(
      'sound.balance',
      '6-Band Spectral Spread',
      balanceRatio,
      14,
      activeBands,
      5,
      `${activeBands}/6 active bands`,
    ),
    sub(
      'sound.richness',
      'Harmonic & Texture Density',
      richnessRatio,
      14,
      m.spectralEntropy,
      0.5,
      `entropy=${m.spectralEntropy.toFixed(2)}`,
    ),
    sub(
      'sound.flux',
      'Temporal Spectral Motion',
      motionRatio,
      12,
      m.spectralFlux,
      0.35,
      `flux=${m.spectralFlux.toFixed(2)}`,
    ),
  ];
  const score = round2(metrics.reduce((s, x) => s + x.score, 0));
  return {
    pillar: { id: 'spectrum', label: 'Spectral Balance & Richness', score, maxScore: 40, metrics },
    deductions: buildDeductions('spectrum', metrics, [
      'Spread energy across low body, mid presence, and air rather than one narrow band.',
      'Layer osc/fm/resonator with filtered noise, crackle, or drive saturation.',
      'Modulate filter cutoff, pitch curves, or brightness over time for living motion.',
    ]),
  };
};

const evaluatePolish = (
  products: readonly SoundProduct[],
  m: SoundMetrics,
): {
  readonly pillar: SoundAuditPillarReport;
  readonly deductions: readonly SoundAuditDeduction[];
} => {
  const loudnessRatio = ramp(m.rmsDb, -30, -14);
  const seamRatio =
    products[0]!.playback.kind === 'loop'
      ? 1 - ramp(m.loopSeamJump, 0.02, 0.25)
      : 1 - ramp(m.trailingSilenceRatio, 0.58, 0.85);
  const varRatio = products.length < 2 ? 0.7 : ramp(m.variantDistinctness, 0.01, 0.15);
  const metrics = [
    sub(
      'sound.loudness',
      'Perceptual Loudness',
      loudnessRatio,
      9,
      m.rmsDb,
      -16,
      `rms=${m.rmsDb.toFixed(1)}dBFS`,
    ),
    sub(
      'sound.tail',
      products[0]!.playback.kind === 'loop' ? 'Loop Seam Continuity' : 'Tail Efficiency',
      seamRatio,
      8,
      m.loopSeamJump,
      0,
      `seam=${m.loopSeamJump.toFixed(3)}`,
    ),
    sub(
      'sound.variants',
      'Variant Cohesion',
      varRatio,
      8,
      m.variantDistinctness,
      0.12,
      `varDiff=${m.variantDistinctness.toFixed(3)}`,
    ),
  ];
  const score = round2(metrics.reduce((s, x) => s + x.score, 0));
  return {
    pillar: { id: 'polish', label: 'Delivery & Variation Polish', score, maxScore: 25, metrics },
    deductions: buildDeductions('polish', metrics, [
      'Raise output.gainDb (using softClip = true if needed) toward -18..-12 dBFS RMS.',
      'Clean up loop wrap crossfade or trim unused trailing silence.',
      'Use 2+ variants with subtle pitch/timing/gain vary.',
    ]),
  };
};

const buildDeductions = (
  pillar: SoundAuditPillarId,
  metrics: readonly SoundAuditSubmetric[],
  fixes: readonly string[],
): readonly SoundAuditDeduction[] =>
  metrics.flatMap((m, i) => {
    const lost = round2(m.maxScore - m.score);
    return lost < 0.5
      ? []
      : [
          {
            metricId: m.id,
            pillar,
            lostPoints: lost,
            summary: `${m.label} (${m.detail})`,
            fix: fixes[i]!,
          },
        ];
  });

export const evaluateSoundQuality = (
  products: readonly SoundProduct[],
  options: SoundAuditOptions = {},
): SoundAuditReport => {
  const primary = products[0]!;
  const profile = options.profile ?? primary.profile;
  const profileSource = options.profile !== undefined ? 'override' : 'authored';
  const threshold = options.threshold ?? DEFAULT_SOUND_THRESHOLD;
  const metrics = analyzeSoundProducts(products);
  const hardGates = evaluateGates(products, metrics);
  const dyn = evaluateDynamics(profile, metrics);
  const spec = evaluateSpectrum(metrics);
  const pol = evaluatePolish(products, metrics);
  const score = Math.max(
    0,
    Math.min(100, Math.round(dyn.pillar.score + spec.pillar.score + pol.pillar.score)),
  );
  const allGates = hardGates.every((g) => g.passed);
  const passed = allGates && score >= threshold;
  const gateDeductions: SoundAuditDeduction[] = hardGates
    .filter((g) => !g.passed)
    .map((g) => ({
      metricId: `gate.${g.id}`,
      pillar: 'gate',
      lostPoints: 100,
      summary: g.message,
      fix: g.fix,
    }));
  const sorted = [...dyn.deductions, ...spec.deductions, ...pol.deductions].sort(
    (a, b) => b.lostPoints - a.lostPoints || a.metricId.localeCompare(b.metricId),
  );
  return Object.freeze({
    schemaVersion: 1 as const,
    profile,
    profileSource,
    threshold,
    passed,
    score,
    grade: gradeFor(allGates, score, passed),
    hardGates,
    pillars: [dyn.pillar, spec.pillar, pol.pillar],
    topDeductions: [...gateDeductions, ...sorted].slice(0, 5),
  });
};

export const formatSoundGateFailure = (name: string, report: SoundAuditReport): string => {
  const failedGates = report.hardGates.filter((g) => !g.passed).map((g) => g.id);
  const topFixes = report.topDeductions
    .slice(0, 3)
    .map((d) => `${d.metricId}: ${d.summary} -> ${d.fix}`)
    .join(' | ');
  const gateText = failedGates.length > 0 ? ` failedGates=[${failedGates.join(', ')}]` : '';
  return `Sound "${name}" failed quality gate (${report.score}/${report.threshold}, ${report.grade})${gateText}. ${topFixes}`;
};
