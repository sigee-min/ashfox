import { auditSubmetric, ramp, round2 } from '@ashfox/internal-contracts';
import { deepFreeze } from '../immutable';
import { length3, scale3, sub3 } from '../math/vec3';
import type {
  BakedChannel,
  BakedClip,
  ChainSpec,
  MotionAuditMetric,
  MotionAuditReport,
  Quat,
  RigJoint,
  Vec3,
} from '../animation/contract';
import {
  IDENTITY_QUAT,
  conjugateQuat,
  mulQuat,
  quatAngleDeg,
  quatToRotVec,
  slerpQuat,
} from '../animation/quat';

const EPS = 1e-6;

export interface MotionAuditInput {
  readonly clips: readonly BakedClip[];
  readonly joints?: readonly RigJoint[];
  readonly chains?: readonly ChainSpec[];
  readonly footPositions?: Readonly<
    Record<
      string,
      readonly { readonly time: number; readonly pos: Vec3; readonly grounded: boolean }[]
    >
  >;
  readonly threshold?: number;
}

const sampleBakedVec3 = (ch: BakedChannel, time: number, fallback: Vec3): Vec3 => {
  const keys = ch.keys;
  if (keys.length === 0) return fallback;
  if (time <= keys[0]!.time + EPS) return keys[0]!.value as Vec3;
  if (time >= keys[keys.length - 1]!.time - EPS) return keys[keys.length - 1]!.value as Vec3;
  for (let i = 0; i < keys.length - 1; i += 1) {
    const a = keys[i]!;
    const b = keys[i + 1]!;
    if (time <= b.time + EPS) {
      if (a.interpolation === 'step' || b.time - a.time <= EPS) return a.value as Vec3;
      const u = (time - a.time) / (b.time - a.time);
      const va = a.value as Vec3;
      const vb = b.value as Vec3;
      return [
        va[0] + (vb[0] - va[0]) * u,
        va[1] + (vb[1] - va[1]) * u,
        va[2] + (vb[2] - va[2]) * u,
      ];
    }
  }
  return keys[keys.length - 1]!.value as Vec3;
};

const sampleBakedQuat = (ch: BakedChannel, time: number): Quat => {
  const keys = ch.keys;
  if (keys.length === 0) return IDENTITY_QUAT;
  if (time <= keys[0]!.time + EPS) return keys[0]!.value as Quat;
  if (time >= keys[keys.length - 1]!.time - EPS) return keys[keys.length - 1]!.value as Quat;
  for (let i = 0; i < keys.length - 1; i += 1) {
    const a = keys[i]!;
    const b = keys[i + 1]!;
    if (time <= b.time + EPS) {
      if (a.interpolation === 'step' || b.time - a.time <= EPS) return a.value as Quat;
      const u = (time - a.time) / (b.time - a.time);
      return slerpQuat(a.value as Quat, b.value as Quat, u);
    }
  }
  return keys[keys.length - 1]!.value as Quat;
};

const evaluateLoopContinuity = (
  clips: readonly BakedClip[],
): { readonly ratio: number; readonly maxVelDiff: number } => {
  const loops = clips.filter((c) => c.loop === 'loop');
  if (loops.length === 0) return { ratio: 1, maxVelDiff: 0 };
  let worstDiff = 0;
  for (const clip of loops) {
    const dt = Math.min(0.02, clip.duration * 0.05);
    for (const ch of clip.channels) {
      if (ch.property !== 'rotation' || ch.keys.length < 2) continue;
      const q0 = sampleBakedQuat(ch, 0);
      const q1 = sampleBakedQuat(ch, dt);
      const qPrev = sampleBakedQuat(ch, clip.duration - dt);
      const qEnd = sampleBakedQuat(ch, clip.duration);
      const poseGap = quatAngleDeg(q0, qEnd);
      const radToDegPerSec = 180 / Math.PI / Math.max(EPS, dt);
      const omegaStart = scale3(quatToRotVec(mulQuat(conjugateQuat(q0), q1)), radToDegPerSec);
      const omegaEnd = scale3(quatToRotVec(mulQuat(conjugateQuat(qPrev), qEnd)), radToDegPerSec);
      const velDiff = length3(sub3(omegaStart, omegaEnd)) + poseGap * 4;
      if (velDiff > worstDiff) worstDiff = velDiff;
    }
  }
  const ratio = worstDiff <= 8 ? 1 : Math.max(0, 1 - (worstDiff - 8) / 40);
  return { ratio, maxVelDiff: worstDiff };
};

const evaluateWeightAndRoot = (
  clips: readonly BakedClip[],
): { readonly ratio: number; readonly maxAmp: number } => {
  let maxAmp = 0;
  for (const clip of clips) {
    for (const ch of clip.channels) {
      if (ch.property !== 'position' || (ch.jointId !== 'root' && ch.jointId !== 'pelvis'))
        continue;
      let minY = Infinity;
      let maxY = -Infinity;
      let minX = Infinity;
      let maxX = -Infinity;
      let minZ = Infinity;
      let maxZ = -Infinity;
      for (const k of ch.keys) {
        const v = k.value as Vec3;
        minX = Math.min(minX, v[0]);
        maxX = Math.max(maxX, v[0]);
        minY = Math.min(minY, v[1]);
        maxY = Math.max(maxY, v[1]);
        minZ = Math.min(minZ, v[2]);
        maxZ = Math.max(maxZ, v[2]);
      }
      const amp = Math.max(maxY - minY, 0.5 * Math.hypot(maxX - minX, maxZ - minZ));
      if (amp > maxAmp) maxAmp = amp;
    }
  }
  return { ratio: ramp(maxAmp, 0.05, 0.4), maxAmp };
};

const sampleAngleSeries = (ch: BakedChannel, duration: number, count: number): number[] => {
  const qBase = sampleBakedQuat(ch, 0);
  const invBase = conjugateQuat(qBase);
  const vecs: Vec3[] = [];
  let maxVec: Vec3 = [1, 0, 0];
  let maxLen = 0;
  for (let i = 0; i < count; i += 1) {
    const t = (i / Math.max(1, count - 1)) * duration;
    const rv = quatToRotVec(mulQuat(invBase, sampleBakedQuat(ch, t)));
    vecs.push(rv);
    const l = length3(rv);
    if (l > maxLen) {
      maxLen = l;
      maxVec = rv;
    }
  }
  const norm = maxLen > 1e-6 ? maxLen : 1;
  return vecs.map((v) => (v[0] * maxVec[0] + v[1] * maxVec[1] + v[2] * maxVec[2]) / norm);
};

const bestCrossCorrelationLagMs = (
  a: readonly number[],
  b: readonly number[],
  dtMs: number,
): number => {
  const n = a.length;
  const meanA = a.reduce((s, v) => s + v, 0) / n;
  const meanB = b.reduce((s, v) => s + v, 0) / n;
  const da = a.map((v) => v - meanA);
  const db = b.map((v) => v - meanB);
  const normA = Math.sqrt(da.reduce((s, v) => s + v * v, 0));
  const normB = Math.sqrt(db.reduce((s, v) => s + v * v, 0));
  if (normA <= 1e-4 || normB <= 1e-4) return 0;

  let bestLag = 0;
  let bestCorr = -Infinity;
  const maxSteps = Math.min(Math.floor(n / 3), Math.round(260 / dtMs));
  for (let lag = 0; lag <= maxSteps; lag += 1) {
    let sum = 0;
    for (let i = 0; i + lag < n; i += 1) {
      sum += da[i]! * db[i + lag]!;
    }
    const corr = sum / (normA * normB);
    if (corr > bestCorr + 1e-5) {
      bestCorr = corr;
      bestLag = lag;
    }
  }
  return bestLag * dtMs;
};

const collectChainPairs = (
  chains: readonly ChainSpec[] | undefined,
  joints: readonly RigJoint[] | undefined,
): readonly [string, string][] => {
  const pairs: [string, string][] = [];
  for (const chain of chains ?? []) {
    for (let i = 0; i + 1 < chain.joints.length; i += 1) {
      pairs.push([chain.joints[i]!, chain.joints[i + 1]!]);
    }
  }
  if (pairs.length > 0 || !joints) return pairs;
  for (const j of joints) {
    if (j.parentId) pairs.push([j.parentId, j.id]);
  }
  return pairs;
};

const evaluatePairLagMs = (
  clip: BakedClip,
  pId: string,
  cId: string,
  sampleCount: number,
): number | null => {
  const pCh = clip.channels.find((c) => c.jointId === pId && c.property === 'rotation');
  const cCh = clip.channels.find((c) => c.jointId === cId && c.property === 'rotation');
  if (!pCh || !cCh) return null;
  const dtMs = (clip.duration * 1000) / (sampleCount - 1);
  return bestCrossCorrelationLagMs(
    sampleAngleSeries(pCh, clip.duration, sampleCount),
    sampleAngleSeries(cCh, clip.duration, sampleCount),
    dtMs,
  );
};

const collectAllPairLags = (
  clips: readonly BakedClip[],
  pairs: readonly [string, string][],
): readonly number[] => {
  const lags: number[] = [];
  for (const clip of clips) {
    for (const [pId, cId] of pairs) {
      const lag = evaluatePairLagMs(clip, pId, cId, 60);
      if (lag !== null) lags.push(lag);
    }
  }
  return lags;
};

const evaluateSecondaryOverlap = (
  clips: readonly BakedClip[],
  chains: readonly ChainSpec[] | undefined,
  joints: readonly RigJoint[] | undefined,
): { readonly ratio: number; readonly lagMs: number } => {
  const pairs = collectChainPairs(chains, joints);
  if (pairs.length === 0) return { ratio: 0.6, lagMs: 0 };
  const lags = collectAllPairLags(clips, pairs);
  if (lags.length === 0) return { ratio: 0.4, lagMs: 0 };
  const inBand = lags.find((lag) => lag >= 30 && lag <= 180);
  if (inBand !== undefined) return { ratio: 1, lagMs: inBand };
  const bestLag = Math.max(...lags);
  return { ratio: bestLag > 0 ? Math.min(1, bestLag / 30) * 0.8 : 0.15, lagMs: bestLag };
};

const collectChannelSpeeds = (ch: BakedChannel, duration: number, out: number[]): boolean => {
  if (ch.property !== 'rotation' || ch.keys.length < 2) return false;
  const hasStep = ch.keys.some((k) => k.interpolation === 'step');
  const steps = 24;
  const dt = duration / steps;
  for (let i = 0; i < steps; i += 1) {
    out.push(
      quatAngleDeg(sampleBakedQuat(ch, i * dt), sampleBakedQuat(ch, (i + 1) * dt)) /
        Math.max(EPS, dt),
    );
  }
  return hasStep;
};

const evaluateTimingContrast = (
  clips: readonly BakedClip[],
): { readonly ratio: number; readonly cv: number } => {
  const speeds: number[] = [];
  let hasStep = false;
  for (const clip of clips) {
    for (const ch of clip.channels) {
      if (collectChannelSpeeds(ch, clip.duration, speeds)) hasStep = true;
    }
  }
  if (speeds.length === 0) return { ratio: 0, cv: 0 };
  const mean = speeds.reduce((s, v) => s + v, 0) / speeds.length;
  if (mean <= 1e-3) return { ratio: 0, cv: 0 };
  const variance = speeds.reduce((s, v) => s + (v - mean) * (v - mean), 0) / speeds.length;
  const cv = Math.sqrt(variance) / mean;
  const base = ramp(cv, 0.12, 0.45);
  return { ratio: hasStep ? Math.min(1, base + 0.1) : base, cv };
};

const scanFootSamples = (
  samples: readonly { readonly time: number; readonly pos: Vec3; readonly grounded: boolean }[],
): { readonly minY: number; readonly maxSlide: number } => {
  let minY = 0;
  let maxSlide = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const curr = samples[i]!;
    if (curr.pos[1] < minY) minY = curr.pos[1];
    if (i === 0 || !curr.grounded || !samples[i - 1]!.grounded) continue;
    const dt = Math.max(EPS, curr.time - samples[i - 1]!.time);
    const dist = Math.hypot(
      curr.pos[0] - samples[i - 1]!.pos[0],
      curr.pos[2] - samples[i - 1]!.pos[2],
    );
    maxSlide = Math.max(maxSlide, dist / dt);
  }
  return { minY, maxSlide };
};

const evaluateGroundContact = (
  footPositions: MotionAuditInput['footPositions'],
): { readonly ratio: number; readonly minPenetration: number; readonly maxSlide: number } => {
  if (!footPositions || Object.keys(footPositions).length === 0) {
    return { ratio: 1, minPenetration: 0, maxSlide: 0 };
  }
  let minY = 0;
  let maxSlide = 0;
  for (const samples of Object.values(footPositions)) {
    const res = scanFootSamples(samples);
    minY = Math.min(minY, res.minY);
    maxSlide = Math.max(maxSlide, res.maxSlide);
  }
  const penPenalty = minY < -0.2 ? Math.min(1, (-minY - 0.2) / 1.5) : 0;
  const slidePenalty = maxSlide > 0.5 ? Math.min(1, (maxSlide - 0.5) / 4.0) : 0;
  return {
    ratio: Math.max(0, 1 - 0.5 * penPenalty - 0.5 * slidePenalty),
    minPenetration: minY,
    maxSlide,
  };
};

const channelRotSpan = (ch: BakedChannel): number => {
  const q0 = ch.keys[0]!.value as Quat;
  let chMax = 0;
  for (const k of ch.keys) chMax = Math.max(chMax, quatAngleDeg(q0, k.value as Quat));
  return chMax;
};

const channelPosSpan = (ch: BakedChannel): number => {
  const p0 = sampleBakedVec3(ch, 0, [0, 0, 0]);
  let chMax = 0;
  for (const k of ch.keys) chMax = Math.max(chMax, length3(sub3(k.value as Vec3, p0)));
  return chMax;
};

const evaluateSilhouetteDelta = (
  clips: readonly BakedClip[],
): { readonly ratio: number; readonly maxDeg: number } => {
  let maxDeg = 0;
  let maxPosSpan = 0;
  const activeJoints = new Set<string>();
  for (const ch of clips.flatMap((c) => c.channels)) {
    if (ch.keys.length < 2) continue;
    if (ch.property === 'rotation') {
      const span = channelRotSpan(ch);
      if (span >= 8) activeJoints.add(ch.jointId);
      maxDeg = Math.max(maxDeg, span);
    } else if (ch.property === 'position') {
      maxPosSpan = Math.max(maxPosSpan, channelPosSpan(ch));
    }
  }
  const rotRatio = ramp(maxDeg, 6, 28);
  const jointRatio = ramp(activeJoints.size, 1, 4);
  const posRatio = ramp(maxPosSpan, 0.2, 2.0);
  return { ratio: 0.5 * rotRatio + 0.35 * jointRatio + 0.15 * posRatio, maxDeg };
};

const evaluateCueSync = (
  clips: readonly BakedClip[],
): { readonly ratio: number; readonly cueCount: number } => {
  const totalCues = clips.reduce((s, c) => s + c.cues.length, 0);
  const hasIdle = clips.some((c) => c.name.toLowerCase().includes('idle'));
  const hasAction = clips.some((c) => !c.name.toLowerCase().includes('idle'));
  const coverage = (hasIdle ? 0.25 : 0) + (hasAction ? 0.25 : 0);
  const cueRatio = ramp(totalCues, 0, 2);
  const validCues = clips.every((c) =>
    c.cues.every((cue) => cue.time >= 0 && cue.time <= c.duration + EPS),
  );
  return {
    ratio: (coverage + 0.5 * cueRatio) * (validCues ? 1 : 0.5),
    cueCount: totalCues,
  };
};

const makeMotionMetric = (
  id: string,
  label: string,
  ratio: number,
  maxScore: number,
  value: number,
  target: number,
  detail: string,
): MotionAuditMetric => auditSubmetric(id, label, ratio, maxScore, value, target, detail);

const buildDynamicsMetrics = (input: MotionAuditInput): MotionAuditMetric[] => {
  const loop = evaluateLoopContinuity(input.clips);
  const weight = evaluateWeightAndRoot(input.clips);
  const sec = evaluateSecondaryOverlap(input.clips, input.chains, input.joints);
  const timing = evaluateTimingContrast(input.clips);
  return [
    makeMotionMetric(
      'motion.loopContinuity',
      'Loop Pose & C1 Velocity Continuity',
      loop.ratio,
      15,
      round2(loop.maxVelDiff),
      8,
      `maxLoopVelocityDiff=${round2(loop.maxVelDiff)}deg/s`,
    ),
    makeMotionMetric(
      'motion.weightAndRoot',
      'Root/Pelvis Weight & Bounce',
      weight.ratio,
      15,
      round2(weight.maxAmp),
      0.4,
      `rootBounceAmp=${round2(weight.maxAmp)}u`,
    ),
    makeMotionMetric(
      'motion.secondaryOverlap',
      'Secondary Follow-Through Phase Lag',
      sec.ratio,
      15,
      round2(sec.lagMs),
      60,
      `crossCorrLag=${round2(sec.lagMs)}ms`,
    ),
    makeMotionMetric(
      'motion.timingContrast',
      'Easing & Velocity Contrast (CV)',
      timing.ratio,
      15,
      round2(timing.cv),
      0.35,
      `velocityCV=${round2(timing.cv)}`,
    ),
  ];
};

const buildGroundingAndCueMetrics = (input: MotionAuditInput): MotionAuditMetric[] => {
  const ground = evaluateGroundContact(input.footPositions);
  const sil = evaluateSilhouetteDelta(input.clips);
  const cue = evaluateCueSync(input.clips);
  return [
    makeMotionMetric(
      'motion.groundContact',
      'Foot Ground Pin & Zero Slide',
      ground.ratio,
      15,
      round2(ground.maxSlide),
      0.5,
      `minY=${round2(ground.minPenetration)}u, maxSlide=${round2(ground.maxSlide)}u/s`,
    ),
    makeMotionMetric(
      'motion.silhouetteDelta',
      'Extreme Pose Silhouette Readability',
      sil.ratio,
      15,
      round2(sil.maxDeg),
      28,
      `maxRotationSpan=${round2(sil.maxDeg)}deg`,
    ),
    makeMotionMetric(
      'motion.cueSync',
      'Audio/VFX Cue Sync & Clip Coverage',
      cue.ratio,
      10,
      cue.cueCount,
      2,
      `cues=${cue.cueCount}, clips=${input.clips.length}`,
    ),
  ];
};

const buildMotionMetrics = (input: MotionAuditInput): MotionAuditMetric[] => [
  ...buildDynamicsMetrics(input),
  ...buildGroundingAndCueMetrics(input),
];

/**
 * Motion Quality Audit evaluating all 7 animation craft metrics:
 * loopContinuity, weightAndRoot, secondaryOverlap, timingContrast,
 * groundContact, silhouetteDelta, cueSync.
 */
export const evaluateMotionQuality = (input: MotionAuditInput): MotionAuditReport => {
  const threshold = input.threshold ?? 75;
  const metrics = buildMotionMetrics(input);

  const score = round2(metrics.reduce((sum, m) => sum + m.score, 0));
  const deductions = metrics
    .filter((m) => m.score < m.maxScore * 0.85)
    .map((m) => `${m.id}: ${round2(m.score)}/${m.maxScore} (${m.detail})`);
  return deepFreeze({
    schemaVersion: 1 as const,
    passed: score >= threshold,
    score,
    metrics,
    deductions,
  });
};
