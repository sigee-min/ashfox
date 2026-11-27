import { freeze } from '../../../immutable';
import {
  GAIT_KINDS,
  type CombatOps,
  type CueEvent,
  type GaitKind,
  type GaitSpec,
  type HitstopOp,
  type RecoilOp,
  type SmearOp,
  type SquashOp,
} from '../../../animation/contract';
import type {
  AssetCombatOpDecl,
  AssetCueDecl,
  AssetMotionLayerDecl,
  AssetPropertyDecl,
  AssetValueType,
} from '../../../project/program/asset/contract';
import type { ProgramExpr } from '../../../project/program/syntax/contract';
import type { AssemblyContext, AssemblyState } from './assembly';
import { compileAndEvaluateHirExpression } from './hirValues';
import type { AssetValue } from './value/contract';
import type { TypedRigContract } from './contract';

const toFloat = (value: Extract<AssetValue, { readonly kind: 'number' }>): number =>
  Number(value.value.numerator) / Number(value.value.denominator);

const evalScalar = (
  context: AssemblyContext,
  state: AssemblyState,
  expr: ProgramExpr,
  expectedType: AssetValueType,
): number | null => {
  const val = compileAndEvaluateHirExpression(
    expr,
    expectedType,
    new Map(),
    new Map(),
    state.path,
    context.issue,
  );
  return val?.kind === 'number' ? toFloat(val) : null;
};

const evalOptional = (
  context: AssemblyContext,
  state: AssemblyState,
  prop: AssetPropertyDecl | undefined,
  types: readonly AssetValueType[],
): number | undefined => {
  if (!prop) return undefined;
  const val = compileAndEvaluateHirExpression(
    prop.value,
    types[0]!,
    new Map(),
    new Map(),
    state.path,
    () => {},
  );
  if (val?.kind === 'number') return toFloat(val);
  if (types.length > 1) return evalScalar(context, state, prop.value, types[1]!) ?? undefined;
  return evalScalar(context, state, prop.value, types[0]!) ?? undefined;
};

const propName = (prop: AssetPropertyDecl | undefined): string | null =>
  prop?.value.kind === 'name' ? prop.value.value : null;

const axisOr = (prop: AssetPropertyDecl | undefined): 'x' | 'y' | 'z' | undefined => {
  const v = propName(prop);
  return v === 'x' || v === 'y' || v === 'z' ? v : undefined;
};

const buildSquashOp = (
  context: AssemblyContext,
  state: AssemblyState,
  joint: string,
  map: Map<string, AssetPropertyDecl>,
): SquashOp => {
  const duration = evalOptional(context, state, map.get('duration'), ['second']);
  const pivotHeight = evalOptional(context, state, map.get('pivot'), ['unit']);
  return freeze({
    kind: 'squash',
    jointId: joint,
    at: evalOptional(context, state, map.get('at'), ['second']) ?? 0,
    ...(duration !== undefined ? { duration } : {}),
    axis: axisOr(map.get('axis')) ?? 'y',
    amount: evalOptional(context, state, map.get('amount'), ['ratio']) ?? -0.15,
    ...(pivotHeight !== undefined ? { pivotHeight } : {}),
  });
};

const buildSmearOp = (
  context: AssemblyContext,
  state: AssemblyState,
  joint: string,
  op: AssetCombatOpDecl,
  map: Map<string, AssetPropertyDecl>,
): SmearOp => {
  const start = op.timeRange ? (evalScalar(context, state, op.timeRange[0], 'second') ?? 0) : 0;
  const end = op.timeRange
    ? (evalScalar(context, state, op.timeRange[1], 'second') ?? start + 0.05)
    : start + 0.05;
  const axis = axisOr(map.get('axis'));
  return freeze({
    kind: 'smear',
    jointId: joint,
    start,
    end,
    stretch: evalOptional(context, state, map.get('stretch'), ['ratio']) ?? 1.5,
    ...(axis ? { axis } : {}),
  });
};

const buildRecoilOp = (
  context: AssemblyContext,
  state: AssemblyState,
  joint: string,
  map: Map<string, AssetPropertyDecl>,
): RecoilOp => {
  const impProp = map.get('impulse');
  let impulseDeg: readonly [number, number, number] = [-10, 0, 0];
  if (impProp) {
    const vec = compileAndEvaluateHirExpression(
      impProp.value,
      'vec3<degree>',
      new Map(),
      new Map(),
      state.path,
      context.issue,
    );
    if (vec?.kind === 'vector' && vec.values.length === 3) {
      impulseDeg = [
        toFloat(vec.values[0]!),
        toFloat(vec.values[1]!),
        toFloat(vec.values[2]!),
      ] as const;
    }
  }
  return freeze({
    kind: 'recoil',
    jointId: joint,
    at: evalOptional(context, state, map.get('at'), ['second']) ?? 0,
    impulseDeg,
    decay: evalOptional(context, state, map.get('decay'), ['second']) ?? 0.18,
  });
};

interface CombatBuckets {
  readonly squashes: SquashOp[];
  readonly smears: SmearOp[];
  readonly hitstops: HitstopOp[];
  readonly recoils: RecoilOp[];
}

const appendCombatOp = (
  op: AssetCombatOpDecl,
  context: AssemblyContext,
  state: AssemblyState,
  rig: TypedRigContract,
  buckets: CombatBuckets,
): void => {
  const map = new Map(op.properties.map((p) => [p.name, p]));
  const joint = op.target ?? propName(map.get('joint'));
  if (joint !== null && rig.joints[joint] === undefined) {
    context.issue(state.path, op.span, 'asset.motion-target', `Unknown rig joint "${joint}".`);
  }
  if (op.kind === 'hitstop') {
    buckets.hitstops.push(
      freeze({
        kind: 'hitstop',
        at: evalOptional(context, state, map.get('at'), ['second']) ?? 0,
        hold: evalOptional(context, state, map.get('hold'), ['second']) ?? 0.06,
        shake: evalOptional(context, state, map.get('shake'), ['unit']) ?? 0.25,
        ...(joint ? { jointId: joint } : {}),
      }),
    );
    return;
  }
  if (!joint) return;
  if (op.kind === 'squash') buckets.squashes.push(buildSquashOp(context, state, joint, map));
  else if (op.kind === 'smear') buckets.smears.push(buildSmearOp(context, state, joint, op, map));
  else if (op.kind === 'recoil') buckets.recoils.push(buildRecoilOp(context, state, joint, map));
};

export const buildCombatOps = (
  context: AssemblyContext,
  state: AssemblyState,
  rig: TypedRigContract,
  ops: readonly AssetCombatOpDecl[],
): CombatOps => {
  const buckets: CombatBuckets = { squashes: [], smears: [], hitstops: [], recoils: [] };
  for (const op of ops) appendCombatOp(op, context, state, rig, buckets);
  return freeze({
    ...(buckets.squashes.length ? { squashes: freeze(buckets.squashes) } : {}),
    ...(buckets.smears.length ? { smears: freeze(buckets.smears) } : {}),
    ...(buckets.hitstops.length ? { hitstops: freeze(buckets.hitstops) } : {}),
    ...(buckets.recoils.length ? { recoils: freeze(buckets.recoils) } : {}),
  });
};

const evalCueProp = (
  state: AssemblyState,
  prop: AssetPropertyDecl,
): string | number | boolean | null => {
  const expr = prop.value;
  if (expr.kind === 'string' || expr.kind === 'boolean' || expr.kind === 'name') return expr.value;
  if (expr.kind === 'number') return Number(expr.numerator) / Number(expr.denominator);
  const val = compileAndEvaluateHirExpression(
    expr,
    'ratio',
    new Map(),
    new Map(),
    state.path,
    () => {},
  );
  if (val?.kind === 'number') return toFloat(val);
  if (val?.kind === 'boolean') return val.value;
  if (val?.kind === 'color') return val.value;
  return null;
};

const buildCuePayload = (
  state: AssemblyState,
  props: readonly AssetPropertyDecl[],
): Record<string, string | number | boolean> => {
  const entries: Record<string, string | number | boolean> = {};
  for (const prop of props) {
    const converted = evalCueProp(state, prop);
    if (converted !== null) entries[prop.name] = converted;
  }
  return entries;
};

const buildSingleCue = (
  cue: AssetCueDecl,
  context: AssemblyContext,
  state: AssemblyState,
  rig: TypedRigContract,
): CueEvent => {
  const time = evalScalar(context, state, cue.time, 'second') ?? 0;
  const endTime = cue.endTime
    ? (evalScalar(context, state, cue.endTime, 'second') ?? undefined)
    : undefined;
  const unknownAnchor =
    cue.anchor !== null &&
    rig.anchors[cue.anchor] === undefined &&
    rig.joints[cue.anchor] === undefined;
  if (unknownAnchor) {
    context.issue(
      state.path,
      cue.span,
      'asset.invalid-property',
      `Unknown cue anchor or joint "${cue.anchor}".`,
    );
  }
  const payload = buildCuePayload(state, cue.payload);
  return freeze({
    kind: cue.cueKind,
    time,
    ...(endTime !== undefined ? { endTime } : {}),
    name: cue.name,
    ...(cue.anchor !== null ? { anchor: cue.anchor } : {}),
    ...(Object.keys(payload).length > 0 ? { payload: freeze(payload) } : {}),
  });
};

export const buildCues = (
  context: AssemblyContext,
  state: AssemblyState,
  rig: TypedRigContract,
  cues: readonly AssetCueDecl[],
): readonly CueEvent[] => freeze(cues.map((cue) => buildSingleCue(cue, context, state, rig)));

const GAIT_SCALARS: ReadonlyArray<readonly [string, string, readonly AssetValueType[]]> = [
  ['stride', 'stride', ['unit', 'ratio']],
  ['lift', 'lift', ['unit', 'ratio']],
  ['bounce', 'bounce', ['unit', 'ratio']],
  ['hip_sway', 'hipSway', ['unit', 'ratio']],
  ['counter_twist', 'counterTwist', ['degree', 'ratio']],
  ['lean', 'lean', ['degree', 'ratio']],
  ['arm_swing', 'armSwing', ['degree', 'ratio']],
];

const GAIT_STRINGS: ReadonlyArray<readonly [string, string]> = [
  ['footstep_sound', 'footstepSound'],
  ['left_foot_anchor', 'leftFootAnchor'],
  ['right_foot_anchor', 'rightFootAnchor'],
];

export const buildGaitSpec = (
  context: AssemblyContext,
  state: AssemblyState,
  gait: NonNullable<AssetMotionLayerDecl['gait']>,
): GaitSpec | null => {
  if (!(GAIT_KINDS as readonly string[]).includes(gait.kind)) {
    context.issue(state.path, gait.span, 'asset.invalid-property', `Unknown gait "${gait.kind}".`);
    return null;
  }
  const map = new Map(gait.properties.map((p) => [p.name, p]));
  const fields: Record<string, string | number> = {};
  for (const [propKey, outKey, types] of GAIT_SCALARS) {
    const val = evalOptional(context, state, map.get(propKey), types);
    if (val !== undefined) fields[outKey] = val;
  }
  for (const [propKey, outKey] of GAIT_STRINGS) {
    const val = map.get(propKey)?.value;
    if (val?.kind === 'name' || val?.kind === 'string') fields[outKey] = val.value;
  }
  return freeze({ kind: gait.kind as GaitKind, ...fields } as GaitSpec);
};
