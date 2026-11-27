import { add3, length3, normalize3, scale3, sub3 } from '../math/vec3';
import type { Vec3 } from '../model/identity';
import type {
  VfxBeamSpec,
  VfxPrimitiveMesh,
  VfxPrimitiveSpec,
  VfxRibbonSpec,
  VfxRingSpec,
  VfxSlashArcSpec,
} from './contract';
import { createSeededRng } from './noise';
import {
  addCrossedSegmentQuad,
  addFacetedQuad,
  buildDome,
  buildFrameFromTangent,
  createMeshDraft,
  finalizeMesh,
  type MeshDraft,
} from './primMesh';

const degToRad = (deg: number): number => (deg * Math.PI) / 180;

const slashRingPair = (
  spec: VfxSlashArcSpec,
  u: number,
  crossedTilt: boolean,
): { readonly inner: Vec3; readonly outer: Vec3 } => {
  const theta = degToRad(spec.thetaStartDeg + (spec.thetaEndDeg - spec.thetaStartDeg) * u);
  const midRadius = (spec.innerRadius + spec.outerRadius) * 0.5;
  const halfWidthBase = Math.max(0.02, (spec.outerRadius - spec.innerRadius) * 0.5);
  const taperAmt = spec.tipTaper ?? 0.65;
  const taper = Math.max(0.08, 1 - taperAmt * Math.pow(Math.abs(u - 0.5) * 2, 2));
  const halfW = halfWidthBase * taper;
  const twist = degToRad((spec.pitchTwistDeg ?? 0) * (u - 0.5)) + (crossedTilt ? Math.PI * 0.5 : 0);
  const cosT = Math.cos(theta);
  const sinT = Math.sin(theta);
  const radialX = cosT * Math.cos(twist);
  const radialZ = sinT * Math.cos(twist);
  const radialY = Math.sin(twist);
  const center: Vec3 = [midRadius * cosT, 0, midRadius * sinT];
  const offset: Vec3 = [radialX * halfW, radialY * halfW, radialZ * halfW];
  return { inner: sub3(center, offset), outer: add3(center, offset) };
};

const buildSlashArc = (spec: VfxSlashArcSpec): VfxPrimitiveMesh => {
  const draft = createMeshDraft();
  const segs = Math.max(4, Math.min(48, Math.round(spec.segments ?? 16)));
  const passes = spec.crossed ? [false, true] : [false];
  for (const tilt of passes) {
    for (let i = 0; i < segs; i += 1) {
      const u0 = i / segs;
      const u1 = (i + 1) / segs;
      const p0 = slashRingPair(spec, u0, tilt);
      const p1 = slashRingPair(spec, u1, tilt);
      addFacetedQuad(
        draft,
        p0.inner,
        p1.inner,
        p1.outer,
        p0.outer,
        [u0, 0],
        [u1, 0],
        [u1, 1],
        [u0, 1],
      );
    }
  }
  return finalizeMesh('slash_arc', draft);
};

const evalCatmullRom = (p0: Vec3, p1: Vec3, p2: Vec3, p3: Vec3, t: number): Vec3 => {
  const t2 = t * t;
  const t3 = t2 * t;
  const evalAxis = (a: number, b: number, c: number, d: number): number =>
    0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
  return [
    evalAxis(p0[0], p1[0], p2[0], p3[0]),
    evalAxis(p0[1], p1[1], p2[1], p3[1]),
    evalAxis(p0[2], p1[2], p2[2], p3[2]),
  ];
};

const sampleSplinePoints = (points: readonly Vec3[], segsPerSpan: number): readonly Vec3[] => {
  const pts = points.length >= 2 ? points : [[0, 0, 0] as Vec3, [1, 0, 0] as Vec3];
  const padded: Vec3[] = [
    sub3(scale3(pts[0]!, 2), pts[1]!),
    ...pts,
    sub3(scale3(pts[pts.length - 1]!, 2), pts[pts.length - 2]!),
  ];
  const samples: Vec3[] = [];
  const spans = pts.length - 1;
  for (let s = 0; s < spans; s += 1) {
    const steps = s === spans - 1 ? segsPerSpan + 1 : segsPerSpan;
    for (let k = 0; k < steps; k += 1) {
      samples.push(
        evalCatmullRom(padded[s]!, padded[s + 1]!, padded[s + 2]!, padded[s + 3]!, k / segsPerSpan),
      );
    }
  }
  return samples;
};

interface RibbonFrame {
  readonly pos: Vec3;
  readonly n: Vec3;
  readonly b: Vec3;
  readonly u: number;
  readonly halfW: number;
}

const emitRibbonSegment = (
  draft: MeshDraft,
  f0: RibbonFrame,
  f1: RibbonFrame,
  profile: 'crossed' | 'tube',
): void => {
  if (profile === 'crossed') {
    addCrossedSegmentQuad(
      draft,
      f0.pos,
      f1.pos,
      scale3(f0.n, f0.halfW),
      scale3(f1.n, f1.halfW),
      f0.u,
      f1.u,
    );
    addCrossedSegmentQuad(
      draft,
      f0.pos,
      f1.pos,
      scale3(f0.b, f0.halfW),
      scale3(f1.b, f1.halfW),
      f0.u,
      f1.u,
    );
    return;
  }
  const offs0: Vec3[] = [
    scale3(f0.n, f0.halfW),
    scale3(f0.b, f0.halfW),
    scale3(f0.n, -f0.halfW),
    scale3(f0.b, -f0.halfW),
  ];
  const offs1: Vec3[] = [
    scale3(f1.n, f1.halfW),
    scale3(f1.b, f1.halfW),
    scale3(f1.n, -f1.halfW),
    scale3(f1.b, -f1.halfW),
  ];
  for (let s = 0; s < 4; s += 1) {
    const ns = (s + 1) % 4;
    addFacetedQuad(
      draft,
      add3(f0.pos, offs0[s]!),
      add3(f1.pos, offs1[s]!),
      add3(f1.pos, offs1[ns]!),
      add3(f0.pos, offs0[ns]!),
      [f0.u, s / 4],
      [f1.u, s / 4],
      [f1.u, (s + 1) / 4],
      [f0.u, (s + 1) / 4],
    );
  }
};

const buildRibbon = (spec: VfxRibbonSpec): VfxPrimitiveMesh => {
  const draft = createMeshDraft();
  const samples = sampleSplinePoints(spec.points, Math.max(2, spec.segmentsPerSpan ?? 6));
  const frames: RibbonFrame[] = [];
  let prevN: Vec3 | undefined;
  for (let i = 0; i < samples.length; i += 1) {
    const u = i / Math.max(1, samples.length - 1);
    const prev = samples[Math.max(0, i - 1)]!;
    const next = samples[Math.min(samples.length - 1, i + 1)]!;
    const frame = buildFrameFromTangent(sub3(next, prev), prevN);
    prevN = frame.normal;
    const halfW = Math.max(0.01, (spec.widthStart + (spec.widthEnd - spec.widthStart) * u) * 0.5);
    frames.push({ pos: samples[i]!, n: frame.normal, b: frame.binormal, u, halfW });
  }
  for (let i = 0; i < frames.length - 1; i += 1) {
    emitRibbonSegment(draft, frames[i]!, frames[i + 1]!, spec.profile);
  }
  return finalizeMesh('ribbon', draft);
};

const ringPoint = (
  r: number,
  theta: number,
  yBase: number,
  rippleAmp: number,
  rippleFreq: number,
): Vec3 => [
  r * Math.cos(theta),
  yBase + rippleAmp * Math.sin(theta * rippleFreq),
  r * Math.sin(theta),
];

const ringUv = (radial: number, theta: number): readonly [number, number] => [
  0.5 + 0.5 * radial * Math.cos(theta),
  0.5 + 0.5 * radial * Math.sin(theta),
];

const emitRingSegment = (
  draft: MeshDraft,
  rIn: number,
  rMid: number,
  rOut: number,
  bevel: number,
  amp: number,
  freq: number,
  t0: number,
  t1: number,
): void => {
  const a0 = ringPoint(rIn, t0, 0, amp, freq);
  const a1 = ringPoint(rIn, t1, 0, amp, freq);
  const b0 = ringPoint(rOut, t0, 0, amp, freq);
  const b1 = ringPoint(rOut, t1, 0, amp, freq);
  if (bevel <= 0.001) {
    addFacetedQuad(
      draft,
      a0,
      a1,
      b1,
      b0,
      ringUv(0.36, t0),
      ringUv(0.36, t1),
      ringUv(0.92, t1),
      ringUv(0.92, t0),
    );
    return;
  }
  const m0 = ringPoint(rMid, t0, bevel, amp, freq);
  const m1 = ringPoint(rMid, t1, bevel, amp, freq);
  addFacetedQuad(
    draft,
    a0,
    a1,
    m1,
    m0,
    ringUv(0.36, t0),
    ringUv(0.36, t1),
    ringUv(0.66, t1),
    ringUv(0.66, t0),
  );
  addFacetedQuad(
    draft,
    m0,
    m1,
    b1,
    b0,
    ringUv(0.66, t0),
    ringUv(0.66, t1),
    ringUv(0.92, t1),
    ringUv(0.92, t0),
  );
};

const buildRing = (spec: VfxRingSpec): VfxPrimitiveMesh => {
  const draft = createMeshDraft();
  const segs = Math.max(8, Math.min(64, Math.round(spec.segments ?? 24)));
  const rIn = Math.max(0.05, spec.innerRadius);
  const rOut = Math.max(rIn + 0.05, spec.outerRadius);
  const bevel = spec.bevelHeight ?? 0;
  const rMid = (rIn + rOut) * 0.5;
  const amp = spec.rippleAmp ?? 0;
  const freq = spec.rippleFreq ?? 4;
  for (let i = 0; i < segs; i += 1) {
    emitRingSegment(
      draft,
      rIn,
      rMid,
      rOut,
      bevel,
      amp,
      freq,
      (i / segs) * Math.PI * 2,
      ((i + 1) / segs) * Math.PI * 2,
    );
  }
  return finalizeMesh('ring', draft);
};

const displacePolyline = (
  start: Vec3,
  end: Vec3,
  steps: number,
  amp: number,
  rng: () => number,
): Vec3[] => {
  let pts: Vec3[] = [start, end];
  let curAmp = amp;
  const rounds = Math.max(1, Math.min(4, Math.round(Math.log2(Math.max(2, steps)))));
  for (let r = 0; r < rounds; r += 1) {
    const next: Vec3[] = [pts[0]!];
    for (let i = 0; i < pts.length - 1; i += 1) {
      const a = pts[i]!;
      const b = pts[i + 1]!;
      const mid = scale3(add3(a, b), 0.5);
      const frame = buildFrameFromTangent(sub3(b, a));
      const jx = (rng() * 2 - 1) * curAmp;
      const jy = (rng() * 2 - 1) * curAmp;
      next.push(add3(mid, add3(scale3(frame.normal, jx), scale3(frame.binormal, jy))), b);
    }
    pts = next;
    curAmp *= 0.55;
  }
  return pts;
};

const emitCrossedChain = (draft: MeshDraft, pts: readonly Vec3[], halfWidth: number): void => {
  for (let i = 0; i < pts.length - 1; i += 1) {
    const u0 = i / (pts.length - 1);
    const u1 = (i + 1) / (pts.length - 1);
    const frame = buildFrameFromTangent(sub3(pts[i + 1]!, pts[i]!));
    const w0 = halfWidth * (1 - u0 * 0.25);
    const w1 = halfWidth * (1 - u1 * 0.25);
    addCrossedSegmentQuad(
      draft,
      pts[i]!,
      pts[i + 1]!,
      scale3(frame.normal, w0),
      scale3(frame.normal, w1),
      u0,
      u1,
    );
    addCrossedSegmentQuad(
      draft,
      pts[i]!,
      pts[i + 1]!,
      scale3(frame.binormal, w0),
      scale3(frame.binormal, w1),
      u0,
      u1,
    );
  }
};

const buildBeam = (spec: VfxBeamSpec): VfxPrimitiveMesh => {
  const draft = createMeshDraft();
  const halfW = Math.max(0.02, spec.width * 0.5);
  if (spec.style === 'column') {
    emitCrossedChain(draft, [spec.start, spec.end], halfW);
    return finalizeMesh('beam', draft);
  }
  const rng = createSeededRng(spec.seed ?? 701);
  const segs = Math.max(4, spec.segments ?? 8);
  const amp = spec.jaggedAmp ?? length3(sub3(spec.end, spec.start)) * 0.12;
  const mainChain = displacePolyline(spec.start, spec.end, segs, amp, rng);
  emitCrossedChain(draft, mainChain, halfW);
  const forks = Math.max(0, Math.min(6, spec.forks ?? 2));
  const forkDepth = Math.max(1, Math.min(2, spec.forkDepth ?? 1));
  for (let f = 0; f < forks; f += 1) {
    const anchorIdx = Math.max(
      1,
      Math.min(mainChain.length - 2, Math.floor((mainChain.length * (f + 1)) / (forks + 1))),
    );
    const origin = mainChain[anchorIdx]!;
    const dir = normalize3(sub3(spec.end, spec.start));
    const lateral = normalize3([(rng() - 0.5) * 2, (rng() - 0.5) * 0.6, (rng() - 0.5) * 2]);
    const forkLen = length3(sub3(spec.end, spec.start)) * (0.28 + rng() * 0.22);
    const forkEnd = add3(origin, scale3(normalize3(add3(dir, scale3(lateral, 1.1))), forkLen));
    const forkChain = displacePolyline(origin, forkEnd, Math.max(2, segs / 2), amp * 0.6, rng);
    emitCrossedChain(draft, forkChain, halfW * 0.55);
    if (forkDepth > 1 && forkChain.length > 2) {
      const subOrigin = forkChain[Math.floor(forkChain.length / 2)]!;
      const subEnd = add3(
        subOrigin,
        scale3(normalize3(add3(dir, scale3(lateral, -1.2))), forkLen * 0.45),
      );
      emitCrossedChain(draft, displacePolyline(subOrigin, subEnd, 2, amp * 0.3, rng), halfW * 0.35);
    }
  }
  return finalizeMesh('beam', draft);
};

/** Generate procedural low-poly voxel-harmonious VFX mesh with outward winding & UVs. */
export const buildVfxPrimitive = (spec: VfxPrimitiveSpec): VfxPrimitiveMesh => {
  switch (spec.kind) {
    case 'slash_arc':
      return buildSlashArc(spec);
    case 'ribbon':
      return buildRibbon(spec);
    case 'ring':
      return buildRing(spec);
    case 'beam':
      return buildBeam(spec);
    case 'dome':
      return buildDome(spec);
  }
};
