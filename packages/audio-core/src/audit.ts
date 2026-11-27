import {
  DEFAULT_AUDIT_THRESHOLD,
  gradeForAudit,
  rankTopAuditDeductions,
} from '@ashfox/internal-contracts';
import type { SoundProduct, SoundProfile } from './contract';
import { analyzeSingleProduct, analyzeSoundProducts, type SoundMetrics } from './auditMetrics';
import {
  evaluateDynamics,
  evaluatePolish,
  evaluateSpectrum,
  type SoundAuditDeduction,
  type SoundAuditPillarId,
  type SoundAuditPillarReport,
  type SoundAuditSubmetric,
} from './auditScoring';

export type {
  SoundAuditDeduction,
  SoundAuditPillarId,
  SoundAuditPillarReport,
  SoundAuditSubmetric,
};

export type SoundQualityGrade = 'fail' | 'needs_work' | 'pass' | 'excellent';
export type SoundGateId =
  | 'audible_headroom'
  | 'no_dc_offset'
  | 'bounded_silence'
  | 'spectral_non_trivial'
  | 'loop_continuity'
  | 'stereo_phase'
  | 'variant_distinctness';

export interface SoundAuditGateResult {
  readonly id: SoundGateId;
  readonly passed: boolean;
  readonly message: string;
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

export const DEFAULT_SOUND_THRESHOLD = DEFAULT_AUDIT_THRESHOLD;

const gate = (
  id: SoundGateId,
  passed: boolean,
  okMessage: string,
  failMessage: string,
  fix: string,
): SoundAuditGateResult => ({ id, passed, message: passed ? okMessage : failMessage, fix });

interface VariantSample {
  readonly product: SoundProduct;
  readonly metrics: SoundMetrics;
}

const variantGate = (
  id: SoundGateId,
  samples: readonly VariantSample[],
  ok: (sample: VariantSample) => boolean,
  okMessage: string,
  failMessage: (sample: VariantSample) => string,
  fix: string,
): SoundAuditGateResult => {
  const bad = samples.find((s) => !ok(s));
  return gate(id, !bad, okMessage, bad ? failMessage(bad) : '', fix);
};

const evaluateSignalGates = (
  samples: readonly VariantSample[],
  m: SoundMetrics,
  isLoop: boolean,
): readonly SoundAuditGateResult[] => [
  variantGate(
    'audible_headroom',
    samples,
    (s) => s.metrics.rmsDb >= -34 && s.metrics.peakDb <= -0.5,
    `RMS ${m.rmsDb.toFixed(1)} dBFS, peak ${m.peakDb.toFixed(1)} dBFS.`,
    (s) =>
      `Variant "${s.product.variant}" weak or over-hot (RMS ${s.metrics.rmsDb.toFixed(1)} dBFS, peak ${s.metrics.peakDb.toFixed(1)} dBFS).`,
    'Adjust master gain/lufs/limit so every variant RMS is >= -34 dBFS with clean headroom.',
  ),
  variantGate(
    'no_dc_offset',
    samples,
    (s) => Math.abs(s.product.dc) <= 0.025,
    `DC offset ${samples[0]!.product.dc.toFixed(4)} <= 0.025.`,
    (s) => `Variant "${s.product.variant}" excessive DC offset ${s.product.dc.toFixed(4)}.`,
    'Add a voice highpass filter (>= 25 Hz) to remove sub-sonic DC drift.',
  ),
  variantGate(
    'bounded_silence',
    samples,
    (s) => isLoop || (s.metrics.leadingSilenceRatio <= 0.35 && s.metrics.activeRatio >= 0.15),
    `Active audio ${(m.activeRatio * 100).toFixed(0)}%, lead ${(m.leadingSilenceRatio * 100).toFixed(0)}%.`,
    (s) =>
      `Variant "${s.product.variant}" excessive dead silence (active ${(s.metrics.activeRatio * 100).toFixed(0)}%).`,
    'Trim excess silent padding or move timeline start closer to 0.',
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
      samples,
      (s) => s.metrics.spectralEntropy >= 0.14 || s.metrics.spectralFlux >= 0.06,
      `Entropy ${m.spectralEntropy.toFixed(2)}, flux ${m.spectralFlux.toFixed(2)}.`,
      (s) =>
        `Variant "${s.product.variant}" trivial static tone (entropy=${s.metrics.spectralEntropy.toFixed(2)}, flux=${s.metrics.spectralFlux.toFixed(2)}).`,
      'Layer harmonics, SVF filter sweep, drive, or textured noise rather than a bare static sine.',
    ),
    variantGate(
      'loop_continuity',
      samples,
      (s) => !isLoop || s.metrics.loopSeamJump <= 0.35,
      `Loop seam jump ${m.loopSeamJump.toFixed(3)}.`,
      (s) =>
        `Variant "${s.product.variant}" loop seam discontinuity (${s.metrics.loopSeamJump.toFixed(3)} > 0.35).`,
      'Increase loop xfade or ensure continuous voices span the loop boundaries.',
    ),
    variantGate(
      'stereo_phase',
      samples,
      (s) => s.product.channels === 1 || s.metrics.stereoCorrelation >= -0.25,
      `Stereo correlation ${m.stereoCorrelation.toFixed(2)}, IACC ${m.stereoIacc.toFixed(2)}.`,
      (s) =>
        `Variant "${s.product.variant}" out-of-phase stereo (${s.metrics.stereoCorrelation.toFixed(2)} < -0.25).`,
      'Reduce extreme stereo width or pan inversion so L/R sum cleanly in mono.',
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

export const evaluateSoundQuality = (
  products: readonly SoundProduct[],
  options: SoundAuditOptions = {},
): SoundAuditReport => {
  const primary = products[0]!;
  const profile = options.profile ?? primary.profile;
  const profileSource = options.profile !== undefined ? 'override' : 'authored';
  const threshold = options.threshold ?? DEFAULT_AUDIT_THRESHOLD;
  const metrics = analyzeSoundProducts(products);
  const hardGates = evaluateGates(products, metrics);
  const dyn = evaluateDynamics(profile, metrics);
  const spec = evaluateSpectrum(profile, metrics);
  const pol = evaluatePolish(products, profile, metrics);
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
  return Object.freeze({
    schemaVersion: 1 as const,
    profile,
    profileSource,
    threshold,
    passed,
    score,
    grade: gradeForAudit(allGates, score, passed),
    hardGates,
    pillars: [dyn.pillar, spec.pillar, pol.pillar],
    topDeductions: rankTopAuditDeductions(gateDeductions, [
      ...dyn.deductions,
      ...spec.deductions,
      ...pol.deductions,
    ]),
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
