import { auditSubmetric, ramp, round2 } from '@ashfox/internal-contracts';
import type { SoundProduct, SoundProfile } from './contract';
import type { SoundMetrics } from './auditMetrics';

export type SoundAuditPillarId = 'dynamics' | 'spectrum' | 'polish';

export interface SoundAuditSubmetric {
  readonly id: string;
  readonly label: string;
  readonly score: number;
  readonly maxScore: number;
  readonly value: number;
  readonly target: number;
  readonly detail: string;
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

export interface PillarEvaluation {
  readonly pillar: SoundAuditPillarReport;
  readonly deductions: readonly SoundAuditDeduction[];
}

type SubmetricSpec = readonly [string, string, number, number, number, number, string, string];

const buildPillarResult = (
  id: SoundAuditPillarId,
  label: string,
  maxScore: number,
  specs: readonly SubmetricSpec[],
): PillarEvaluation => {
  const metrics = specs.map(([mId, mLabel, ratio, max, val, target, detail]) =>
    auditSubmetric(mId, mLabel, ratio, max, val, target, detail),
  );
  return {
    pillar: {
      id,
      label,
      score: round2(metrics.reduce((s, x) => s + x.score, 0)),
      maxScore,
      metrics,
    },
    deductions: metrics.flatMap((m, i) => {
      const lost = round2(m.maxScore - m.score);
      return lost < 0.5
        ? []
        : [
            {
              metricId: m.id,
              pillar: id,
              lostPoints: lost,
              summary: `${m.label} (${m.detail})`,
              fix: specs[i]![7],
            },
          ];
    }),
  };
};

const TARGET_CREST: Readonly<Record<SoundProfile, readonly [number, number]>> = {
  impact: [8, 22],
  foley: [6, 20],
  creature: [5, 18],
  magic: [4, 16],
  ui: [5, 16],
  ambient: [3, 14],
};

/** Score the dynamics & envelope craft pillar for a sound profile. */
export const evaluateDynamics = (profile: SoundProfile, m: SoundMetrics): PillarEvaluation => {
  const [cLo, cHi] = TARGET_CREST[profile];
  const percussive = profile === 'impact' || profile === 'foley' || profile === 'ui';
  const crestRatio =
    m.crestDb < cLo ? ramp(m.crestDb, 1.5, cLo) : 1 - 0.5 * ramp(m.crestDb, cHi, cHi + 10);
  const dynRatio = crestRatio * (0.75 + 0.25 * (percussive ? ramp(m.onsetPunchDb, 3.5, 10) : 1));
  const attackRatio = percussive
    ? 1 - ramp(m.attackSeconds, 0.025, 0.14)
    : profile === 'ambient' || profile === 'magic'
      ? 1
      : 1 - ramp(m.attackSeconds, 0.12, 0.6);
  const shapeRatio =
    ramp(m.activeRatio, 0.14, percussive ? 0.36 : 0.65) *
    (1 - ramp(m.leadingSilenceRatio, 0.12, 0.4));
  return buildPillarResult('dynamics', 'Dynamics & Envelope Craft', 35, [
    [
      'sound.crest',
      'Transient & Dynamic Range',
      dynRatio,
      13,
      m.crestDb,
      (cLo + cHi) * 0.5,
      `crest=${m.crestDb.toFixed(1)}dB punch=${m.onsetPunchDb.toFixed(1)}dB`,
      'Shape punchy transients (or master punch / material splash / duck) to match profile.',
    ],
    [
      'sound.attack',
      'Profile Attack Fit',
      attackRatio,
      11,
      m.attackSeconds,
      0.02,
      `attack=${(m.attackSeconds * 1000).toFixed(0)}ms`,
      'Tighten attack envelope for crisp impact/UI or natural swells.',
    ],
    [
      'sound.envelope',
      'Active Envelope Framing',
      shapeRatio,
      11,
      m.activeRatio,
      0.7,
      `active=${(m.activeRatio * 100).toFixed(0)}%`,
      'Reduce leading/trailing dead silence relative to total duration.',
    ],
  ]);
};

const PROFILE_CENTROID: Readonly<Record<SoundProfile, readonly [number, number]>> = {
  impact: [180, 4800],
  foley: [220, 5800],
  creature: [160, 4500],
  magic: [320, 7200],
  ui: [300, 6200],
  ambient: [120, 4800],
};

const PROFILE_SHAPE_FIT: Readonly<
  Record<SoundProfile, (b: SoundMetrics['bands'], harsh: number) => number>
> = {
  impact: (b) =>
    0.5 * ramp(b.sub + b.low + b.lowMid, 0.08, 0.25) +
    0.5 * ramp(b.highMid + b.presence + b.air, 0.04, 0.14),
  foley: (b) =>
    ramp(b.lowMid + b.highMid + b.presence, 0.15, 0.35) * (1 - 0.6 * ramp(b.sub, 0.55, 0.85)),
  creature: (b) =>
    ramp(b.low + b.lowMid + b.highMid, 0.2, 0.45) * (1 - 0.6 * ramp(b.air, 0.45, 0.78)),
  magic: (b) => ramp(b.highMid + b.presence + b.air, 0.1, 0.25),
  ui: (b) =>
    ramp(b.lowMid + b.highMid + b.presence, 0.15, 0.35) * (1 - 0.6 * ramp(b.sub, 0.35, 0.65)),
  ambient: (b, harsh) =>
    ramp(b.sub + b.low + b.lowMid, 0.08, 0.24) * (1 - 0.5 * ramp(harsh, 0.34, 0.65)),
};

const profileSpectralFit = (profile: SoundProfile, m: SoundMetrics): number => {
  const [cMin, cMax] = PROFILE_CENTROID[profile];
  let centroidFit = 1;
  if (m.spectralCentroidHz < cMin) centroidFit = ramp(m.spectralCentroidHz, cMin * 0.4, cMin);
  else if (m.spectralCentroidHz > cMax)
    centroidFit = 1 - 0.6 * ramp(m.spectralCentroidHz, cMax, cMax * 1.8);
  return 0.5 * centroidFit + 0.5 * PROFILE_SHAPE_FIT[profile](m.bands, m.harshnessRatio);
};

/** Score the spectral balance & harmonic richness pillar for a sound profile. */
export const evaluateSpectrum = (profile: SoundProfile, m: SoundMetrics): PillarEvaluation => {
  const b = m.bands;
  const activeBands = Object.values(b).filter((v) => v >= 0.015).length;
  const harshPenalty = 1 - 0.65 * ramp(m.harshnessRatio, 0.42, 0.75);
  const envFit = profileSpectralFit(profile, m);
  const balanceRatio =
    ramp(activeBands, 2, 4.5) *
    (1 - 0.7 * ramp(b.lowMid + b.highMid, 0.85, 0.99)) *
    harshPenalty *
    (0.7 + 0.3 * envFit);
  return buildPillarResult('spectrum', 'Spectral Balance & Richness', 40, [
    [
      'sound.balance',
      'Profile Spectral Balance',
      balanceRatio,
      14,
      activeBands,
      5,
      `${activeBands}/6 bands fit=${Math.round(envFit * 100)}% harsh=${(m.harshnessRatio * 100).toFixed(0)}%`,
      'Shape EQ/filters to match profile band energy without 2.5-5 kHz harshness.',
    ],
    [
      'sound.richness',
      'Harmonic & Texture Density',
      ramp(m.spectralEntropy, 0.16, 0.5),
      14,
      m.spectralEntropy,
      0.5,
      `entropy=${m.spectralEntropy.toFixed(2)}`,
      'Layer material, granular, waveguide, whoosh, or osc/fm/vocal with drive and fx.',
    ],
    [
      'sound.flux',
      'Temporal Spectral Motion',
      ramp(m.spectralFlux, 0.04, 0.24),
      12,
      m.spectralFlux,
      0.35,
      `flux=${m.spectralFlux.toFixed(2)}`,
      'Modulate filter cutoff, pitch curves, or brightness over time for living motion.',
    ],
  ]);
};

const computePolishSeamRatio = (
  primary: SoundProduct,
  profile: SoundProfile,
  m: SoundMetrics,
): number => {
  const isLoop = primary.playback.kind === 'loop';
  const phaseScale =
    primary.channels === 2 && m.stereoCorrelation < 0 ? ramp(m.stereoCorrelation, -0.25, 0) : 1;
  const stereoWidthScale =
    primary.channels === 2 && m.stereoSideRatio < 0.004 && m.stereoIacc > 0.99
      ? 0.85 + 0.15 * ramp(1 - m.stereoIacc, 0.005, 0.08)
      : 1;
  const periodLo = profile === 'ambient' ? 0.72 : 0.88;
  const periodHi = profile === 'ambient' ? 0.94 : 0.98;
  const periodScale = isLoop ? 1 - 0.55 * ramp(m.loopPeriodicity, periodLo, periodHi) : 1;
  const baseSeam = isLoop
    ? 1 - ramp(m.loopSeamJump, 0.02, 0.25)
    : 1 - ramp(m.trailingSilenceRatio, 0.58, 0.85);
  return baseSeam * phaseScale * stereoWidthScale * periodScale;
};

/** Score the delivery & variation polish pillar across rendered sound variants. */
export const evaluatePolish = (
  products: readonly SoundProduct[],
  profile: SoundProfile,
  m: SoundMetrics,
): PillarEvaluation => {
  const primary = products[0]!;
  const isLoop = primary.playback.kind === 'loop';
  const loudnessRatio = 0.5 * ramp(m.rmsDb, -30, -14) + 0.5 * ramp(m.lufs, -28, -12);
  const seamRatio = computePolishSeamRatio(primary, profile, m);
  const varRatio = products.length < 2 ? 0.7 : ramp(m.variantDistinctness, 0.01, 0.15);
  return buildPillarResult('polish', 'Delivery & Variation Polish', 25, [
    [
      'sound.loudness',
      'Perceptual Loudness',
      loudnessRatio,
      9,
      m.lufs,
      -14,
      `lufs=${m.lufs.toFixed(1)} rms=${m.rmsDb.toFixed(1)}dBFS`,
      'Adjust master gain/lufs and limit toward -18..-12 LUFS.',
    ],
    [
      'sound.tail',
      isLoop ? 'Loop Continuity & Spatial Depth' : 'Tail & Stereo Image',
      seamRatio,
      8,
      m.loopSeamJump,
      0,
      `seam=${m.loopSeamJump.toFixed(3)} iacc=${m.stereoIacc.toFixed(2)} rep=${m.loopPeriodicity.toFixed(2)}`,
      'Add Perlin drift / organic variation to avoid periodic loop swells, refine xfade, or widen stereo fx/pan.',
    ],
    [
      'sound.variants',
      'Variant Cohesion',
      varRatio,
      8,
      m.variantDistinctness,
      0.12,
      `varDiff=${m.variantDistinctness.toFixed(3)}`,
      'Use 2+ variants with subtle pitch/timing/gain vary.',
    ],
  ]);
};
