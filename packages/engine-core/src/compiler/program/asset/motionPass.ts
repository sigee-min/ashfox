import { freeze } from '../../../immutable';
import {
  CURVE_KINDS,
  WAVE_KINDS,
  type CurveKind,
  type CurveSpec,
  type SecondarySpec,
  type WaveKind,
  type WaveSpec,
} from '../../../animation/contract';
import { buildCombatOps, buildCues, buildGaitSpec } from './motionCombat';
export { buildCombatOps, buildCues };
import type {
  AssetCurveDecl,
  AssetMotionChannel,
  AssetMotionDecl,
  AssetMotionIkDecl,
  AssetMotionLayerDecl,
  AssetPoseDecl,
  AssetPoseKeyDecl,
  AssetPropertyDecl,
  AssetSecondaryDecl,
  AssetValueType,
  AssetWaveBindingDecl,
} from '../../../project/program/asset/contract';
import type { ProgramExpr } from '../../../project/program/syntax/contract';
import type { SourceSpan } from '../../../project/source/contract';
import type { AssemblyContext, AssemblyState } from './assembly';
import { compileAndEvaluateHirExpression } from './hirValues';
import type { AssetNumberValue } from './value/contract';
import type {
  AssetDegreeVectorValue,
  AssetRatioVectorValue,
  AssetUnitVectorValue,
  TypedMotionIk,
  TypedMotionLayer,
  TypedMotionTrack,
  TypedPose,
  TypedPoseEntry,
  TypedPoseKey,
  TypedRigContract,
  TypedWaveBinding,
} from './contract';

export const channelValueType = (property: AssetMotionChannel): AssetValueType => {
  if (property === 'position') return 'vec3<unit>';
  if (property === 'rotation') return 'vec3<degree>';
  return 'vec3<ratio>';
};

const toFloat = (number: AssetNumberValue): number =>
  Number(number.value.numerator) / Number(number.value.denominator);

export const evalScalar = (
  context: AssemblyContext,
  state: AssemblyState,
  expr: ProgramExpr,
  type: AssetValueType,
): number | null => {
  const val = compileAndEvaluateHirExpression(
    expr,
    type,
    new Map(),
    new Map(),
    state.path,
    context.issue,
  );
  return val?.kind === 'number' ? toFloat(val) : null;
};

const evalOptionalScalar = (
  context: AssemblyContext,
  state: AssemblyState,
  prop: AssetPropertyDecl | undefined,
  types: readonly AssetValueType[],
): number | undefined => {
  if (prop === undefined) return undefined;
  for (const type of types) {
    const res = compileAndEvaluateHirExpression(
      prop.value,
      type,
      new Map(),
      new Map(),
      state.path,
      () => {},
    );
    if (res?.kind === 'number') return toFloat(res);
  }
  const first = compileAndEvaluateHirExpression(
    prop.value,
    types[0]!,
    new Map(),
    new Map(),
    state.path,
    context.issue,
  );
  return first?.kind === 'number' ? toFloat(first) : undefined;
};

export const lowerCurveSpec = (
  context: AssemblyContext,
  state: AssemblyState,
  curve: AssetCurveDecl,
): CurveSpec => {
  if (curve.name === 'catmullrom') return freeze({ kind: 'smooth' as CurveKind });
  const kind = (CURVE_KINDS as readonly string[]).includes(curve.name)
    ? (curve.name as CurveKind)
    : 'linear';
  const params: number[] = [];
  for (const arg of curve.args) {
    const val = evalScalar(context, state, arg, 'ratio');
    if (val !== null) params.push(val);
  }
  return params.length > 0 ? freeze({ kind, params: freeze(params) }) : freeze({ kind });
};

const checkJointChannel = (
  context: AssemblyContext,
  state: AssemblyState,
  rig: TypedRigContract,
  target: string,
  property: AssetMotionChannel,
  span: SourceSpan,
): boolean => {
  const joint = rig.joints[target];
  if (joint === undefined) {
    context.issue(state.path, span, 'asset.motion-target', `Unknown rig joint "${target}".`);
    return false;
  }
  if (!joint.channels.includes(property)) {
    context.issue(
      state.path,
      span,
      'asset.motion-channel',
      `Rig joint "${target}" does not expose ${property}.`,
    );
  }
  return true;
};

const pickWaveArg = (
  named: Map<string, ProgramExpr>,
  positional: readonly ProgramExpr[],
  name: string,
  idx: number,
): ProgramExpr | undefined => named.get(name) ?? positional[idx];

const buildBreathFlapWave = (
  context: AssemblyContext,
  state: AssemblyState,
  kind: 'breath' | 'flap',
  named: Map<string, ProgramExpr>,
  positional: readonly ProgramExpr[],
): WaveSpec => {
  if (kind === 'breath') {
    const periodExpr = pickWaveArg(named, positional, 'period', 0);
    const inhaleExpr = pickWaveArg(named, positional, 'inhale', 1);
    return freeze({
      kind: 'breath',
      period: periodExpr ? (evalScalar(context, state, periodExpr, 'second') ?? 2.5) : 2.5,
      inhale: inhaleExpr ? (evalScalar(context, state, inhaleExpr, 'ratio') ?? 0.42) : 0.42,
    });
  }
  const periodExpr = pickWaveArg(named, positional, 'period', 0);
  const downExpr = pickWaveArg(named, positional, 'down_ratio', 1);
  const liftExpr = pickWaveArg(named, positional, 'com_lift', 2);
  const comLiftAmp = liftExpr
    ? (evalScalar(context, state, liftExpr, 'unit') ?? undefined)
    : undefined;
  return freeze({
    kind: 'flap',
    period: periodExpr ? (evalScalar(context, state, periodExpr, 'second') ?? 0.42) : 0.42,
    downRatio: downExpr ? (evalScalar(context, state, downExpr, 'ratio') ?? 0.38) : 0.38,
    ...(comLiftAmp !== undefined ? { comLiftAmp } : {}),
  });
};

const collectWaveArgs = (args: AssetWaveBindingDecl['args']) => {
  const named = new Map<string, ProgramExpr>();
  const positional: ProgramExpr[] = [];
  for (const arg of args) {
    if (arg.name !== null) named.set(arg.name, arg.value);
    else positional.push(arg.value);
  }
  return { named, positional };
};

const buildSimplexWave = (
  context: AssemblyContext,
  state: AssemblyState,
  property: AssetWaveBindingDecl['property'],
  named: Map<string, ProgramExpr>,
  positional: readonly ProgramExpr[],
): WaveSpec => {
  const freqExpr = pickWaveArg(named, positional, 'freq', 0);
  const ampExpr = pickWaveArg(named, positional, 'amp', 1);
  const seedExpr = pickWaveArg(named, positional, 'seed', 2);
  const periodExpr = pickWaveArg(named, positional, 'period', 3);
  const ampType: AssetValueType = property === 'position' ? 'unit' : 'degree';
  return freeze({
    kind: 'simplex',
    period: periodExpr ? (evalScalar(context, state, periodExpr, 'second') ?? 1) : 1,
    freq: freqExpr ? (evalScalar(context, state, freqExpr, 'ratio') ?? 1.5) : 1.5,
    amp: ampExpr ? (evalScalar(context, state, ampExpr, ampType) ?? 1) : 1,
    seed: seedExpr ? (evalScalar(context, state, seedExpr, 'integer') ?? 1) : 1,
  });
};

const buildWaveSpec = (
  context: AssemblyContext,
  state: AssemblyState,
  decl: AssetWaveBindingDecl,
  scaleFallback: number,
): { readonly spec: WaveSpec; readonly scale: number } | null => {
  const rawKind = decl.waveKind ?? 'breath';
  if (!(WAVE_KINDS as readonly string[]).includes(rawKind)) {
    context.issue(
      state.path,
      decl.span,
      'asset.invalid-property',
      `Unknown wave kind "${rawKind}".`,
    );
    return null;
  }
  const kind = rawKind as WaveKind;
  const { named, positional } = collectWaveArgs(decl.args);
  const spec =
    kind === 'breath' || kind === 'flap'
      ? buildBreathFlapWave(context, state, kind, named, positional)
      : buildSimplexWave(context, state, decl.property, named, positional);
  return { spec, scale: scaleFallback };
};

export const buildWaves = (
  context: AssemblyContext,
  state: AssemblyState,
  rig: TypedRigContract,
  waves: readonly AssetWaveBindingDecl[],
): readonly TypedWaveBinding[] => {
  const result: TypedWaveBinding[] = [];
  for (const decl of waves) {
    if (!checkJointChannel(context, state, rig, decl.target, decl.property, decl.span)) continue;
    const scaleType: AssetValueType =
      decl.property === 'position' ? 'unit' : decl.property === 'rotation' ? 'degree' : 'ratio';
    const scale = decl.scale ? (evalScalar(context, state, decl.scale, scaleType) ?? 1) : 1;
    const built = buildWaveSpec(context, state, decl, scale);
    if (built === null) continue;
    result.push(
      freeze({
        target: decl.target,
        property: decl.property,
        axis: decl.axis,
        spec: built.spec,
        scale: built.scale,
        span: decl.span,
      }),
    );
  }
  return freeze(result);
};

export const buildPoses = (
  context: AssemblyContext,
  state: AssemblyState,
  rig: TypedRigContract,
  poses: readonly AssetPoseDecl[],
): readonly TypedPose[] => {
  const result: TypedPose[] = [];
  const seen = new Set<string>();
  for (const pose of poses) {
    if (seen.has(pose.id)) {
      context.issue(
        state.path,
        pose.span,
        'asset.duplicate-property',
        `Duplicate pose "${pose.id}".`,
      );
    }
    seen.add(pose.id);
    const entries: TypedPoseEntry[] = [];
    for (const entry of pose.entries) {
      if (!checkJointChannel(context, state, rig, entry.target, entry.property, entry.span))
        continue;
      const val = compileAndEvaluateHirExpression(
        entry.value,
        channelValueType(entry.property),
        new Map(),
        new Map(),
        state.path,
        context.issue,
      );
      if (val?.kind === 'vector') {
        entries.push(
          freeze({
            target: entry.target,
            property: entry.property,
            value: val as AssetUnitVectorValue | AssetDegreeVectorValue | AssetRatioVectorValue,
            span: entry.span,
          }),
        );
      }
    }
    result.push(freeze({ id: pose.id, entries: freeze(entries), span: pose.span }));
  }
  return freeze(result);
};

export const buildPoseKeys = (
  context: AssemblyContext,
  state: AssemblyState,
  poseIds: ReadonlySet<string>,
  duration: AssetNumberValue,
  keys: readonly AssetPoseKeyDecl[],
): readonly TypedPoseKey[] => {
  const result: TypedPoseKey[] = [];
  for (const pk of keys) {
    const t = compileAndEvaluateHirExpression(
      pk.time,
      'second',
      new Map(),
      new Map(),
      state.path,
      context.issue,
    );
    if (!poseIds.has(pk.poseId)) {
      context.issue(state.path, pk.span, 'asset.invalid-property', `Unknown pose "${pk.poseId}".`);
    }
    if (t?.kind !== 'number' || t.type !== 'second') continue;
    if (toFloat(t) < 0 || toFloat(t) > toFloat(duration)) {
      context.issue(
        state.path,
        pk.time.span,
        'asset.invalid-motion-key',
        'Pose key time must lie within duration.',
      );
    }
    result.push(
      freeze({
        time: t as TypedPoseKey['time'],
        poseId: pk.poseId,
        curve: lowerCurveSpec(context, state, pk.curve),
        span: pk.span,
      }),
    );
  }
  return freeze(result);
};

const readLayerMask = (expr: ProgramExpr | undefined): readonly string[] | null => {
  if (expr?.kind === 'vector')
    return freeze(expr.values.flatMap((v) => (v.kind === 'name' ? [v.value] : [])));
  if (expr?.kind === 'name') return freeze([expr.value]);
  return null;
};

export const buildLayers = (
  context: AssemblyContext,
  state: AssemblyState,
  rig: TypedRigContract,
  poseIds: ReadonlySet<string>,
  duration: AssetNumberValue,
  layers: readonly AssetMotionLayerDecl[],
  buildTrackFn: (track: AssetMotionDecl['tracks'][number]) => TypedMotionTrack | null,
): readonly TypedMotionLayer[] =>
  freeze(
    layers.map((layer) => {
      const props = new Map(layer.properties.map((p) => [p.name, p]));
      const mirrorExpr = props.get('mirror')?.value;
      const mirrorRaw = mirrorExpr?.kind === 'name' ? mirrorExpr.value : null;
      const mirrorMode = mirrorRaw === 'antiphase' || mirrorRaw === 'sync' ? mirrorRaw : null;
      const tracks = layer.tracks.flatMap((t) => buildTrackFn(t) ?? []);
      return freeze({
        id: layer.id,
        mode: layer.mode,
        weight: evalOptionalScalar(context, state, props.get('weight'), ['ratio']) ?? 1,
        mask: readLayerMask(props.get('mask')?.value),
        mirrorMode,
        gait: layer.gait ? buildGaitSpec(context, state, layer.gait) : null,
        tracks: freeze(tracks),
        waves: buildWaves(context, state, rig, layer.waves),
        poseKeys: buildPoseKeys(context, state, poseIds, duration, layer.poseKeys),
        span: layer.span,
      });
    }),
  );

export const buildMotionIks = (
  context: AssemblyContext,
  state: AssemblyState,
  rig: TypedRigContract,
  iks: readonly AssetMotionIkDecl[],
): readonly TypedMotionIk[] =>
  freeze(
    iks.map((ik) => {
      if (rig.ikLimbs[ik.limb] === undefined) {
        context.issue(
          state.path,
          ik.span,
          'asset.invalid-property',
          `Unknown ik_limb "${ik.limb}" on rig.`,
        );
      }
      const footLocks = ik.footLocks.flatMap(([sExpr, eExpr]) => {
        const s = evalScalar(context, state, sExpr, 'second');
        const e = evalScalar(context, state, eExpr, 'second');
        return s !== null && e !== null ? [freeze({ start: s, end: e })] : [];
      });
      return freeze({ limb: ik.limb, footLocks: freeze(footLocks), span: ik.span });
    }),
  );

export const buildSecondaries = (
  context: AssemblyContext,
  state: AssemblyState,
  rig: TypedRigContract,
  secondaries: readonly AssetSecondaryDecl[],
): readonly SecondarySpec[] => {
  const result: SecondarySpec[] = [];
  for (const sec of secondaries) {
    if (sec.targetKind === 'chain' && rig.chains[sec.targetId] === undefined) {
      context.issue(
        state.path,
        sec.span,
        'asset.invalid-property',
        `Unknown rig chain "${sec.targetId}".`,
      );
    } else if (sec.targetKind === 'joint' && rig.joints[sec.targetId] === undefined) {
      context.issue(
        state.path,
        sec.span,
        'asset.motion-target',
        `Unknown rig joint "${sec.targetId}".`,
      );
    }
    const map = new Map(sec.properties.map((p) => [p.name, p]));
    const stiffness = evalOptionalScalar(context, state, map.get('stiffness'), ['ratio']) ?? 16;
    const damping = evalOptionalScalar(context, state, map.get('damping'), ['ratio']) ?? 0.35;
    const gravity = evalOptionalScalar(context, state, map.get('gravity'), ['ratio']);
    const drag = evalOptionalScalar(context, state, map.get('drag'), ['ratio']);
    const lagSeconds = evalOptionalScalar(context, state, map.get('lag'), ['second']);
    result.push(
      freeze({
        id: `${sec.targetKind}:${sec.targetId}`,
        targetKind: sec.targetKind,
        targetId: sec.targetId,
        stiffness,
        damping,
        ...(gravity !== undefined ? { gravity } : {}),
        ...(drag !== undefined ? { drag } : {}),
        ...(lagSeconds !== undefined ? { lagSeconds } : {}),
      }),
    );
  }
  return freeze(result);
};
