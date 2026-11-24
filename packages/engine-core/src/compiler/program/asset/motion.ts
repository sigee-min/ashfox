import { freeze } from '../../../immutable';
import type {
  AssetMotionDecl,
  AssetPropertyDecl,
  AssetValueType,
} from '../../../project/program/asset/contract';
import type { AssetBooleanValue, AssetNumberValue, AssetValue } from './value/contract';
import type {
  AssetDegreeVectorValue,
  AssetIntegerValue,
  AssetRatioVectorValue,
  TypedMotion,
  TypedMotionKey,
  TypedMotionTrack,
  TypedRigContract,
} from './contract';
import type { AssemblyContext, AssemblyEntry, AssemblyState } from './assembly';
import { compileAndEvaluateHirExpression } from './hirValues';
import { ASSET_BUDGET } from './budgets';

const properties = (
  context: AssemblyContext,
  state: AssemblyState,
  declaration: AssetMotionDecl,
): ReadonlyMap<string, AssetPropertyDecl> => {
  const result = new Map<string, AssetPropertyDecl>();
  const allowed = new Set(['duration', 'fps', 'loop', 'rest-relative']);
  for (const property of declaration.properties) {
    if (!allowed.has(property.name))
      context.issue(
        state.path,
        property.span,
        'asset.invalid-motion-property',
        `Unknown motion property "${property.name}".`,
      );
    if (result.has(property.name))
      context.issue(
        state.path,
        property.span,
        'asset.duplicate-motion-property',
        `Motion property "${property.name}" is declared more than once.`,
      );
    result.set(property.name, property);
  }
  return result;
};

const value = (
  context: AssemblyContext,
  state: AssemblyState,
  property: AssetPropertyDecl | undefined,
  type: AssetValueType,
  owner: AssetMotionDecl,
): AssetValue | null => {
  if (property === undefined) {
    context.issue(
      state.path,
      owner.span,
      'asset.missing-motion-property',
      `Motion requires an explicit ${type} property.`,
    );
    return null;
  }
  return compileAndEvaluateHirExpression(
    property.value,
    type,
    new Map(),
    new Map(),
    state.path,
    context.issue,
  );
};

const exactLess = (left: AssetNumberValue, right: AssetNumberValue): boolean =>
  left.value.numerator * right.value.denominator < right.value.numerator * left.value.denominator;

const exactGreater = (left: AssetNumberValue, right: AssetNumberValue): boolean =>
  left.value.numerator * right.value.denominator > right.value.numerator * left.value.denominator;

const positive = (number: AssetNumberValue | null): number is AssetNumberValue =>
  number !== null && number.value.numerator > 0n;

const vector = (
  source: AssetValue | null,
  property: TypedMotionTrack['property'],
): AssetDegreeVectorValue | AssetRatioVectorValue | null => {
  if (source?.kind !== 'vector') return null;
  if (property === 'rotation' && source.type === 'vec3<degree>') {
    return source as AssetDegreeVectorValue;
  }
  if (property === 'scale' && source.type === 'vec3<ratio>') {
    return source as AssetRatioVectorValue;
  }
  return null;
};

const positiveScale = (value: AssetDegreeVectorValue | AssetRatioVectorValue): boolean =>
  value.type === 'vec3<ratio>' && value.values.every((component) => component.value.numerator > 0n);

const withinFrameBudget = (duration: AssetNumberValue, fps: AssetNumberValue): boolean =>
  duration.value.numerator * fps.value.numerator <=
  BigInt(ASSET_BUDGET.motionFrames) * duration.value.denominator * fps.value.denominator;

const buildTrack = (
  context: AssemblyContext,
  state: AssemblyState,
  rig: TypedRigContract,
  duration: AssetNumberValue,
  track: AssetMotionDecl['tracks'][number],
): TypedMotionTrack | null => {
  const joint = rig.joints[track.target];
  if (track.target.includes('/') || joint === undefined) {
    context.issue(
      state.path,
      track.span,
      'asset.motion-target',
      'Reusable motions target one semantic joint in their nominal rig.',
    );
    return null;
  }
  if (!joint.channels.includes(track.property))
    context.issue(
      state.path,
      track.span,
      'asset.motion-channel',
      `Rig joint "${track.target}" does not expose ${track.property}.`,
    );
  const expected: AssetValueType = track.property === 'rotation' ? 'vec3<degree>' : 'vec3<ratio>';
  const keys: TypedMotionKey[] = [];
  let previous: AssetNumberValue | null = null;
  for (const key of track.keyframes) {
    const timeValue = compileAndEvaluateHirExpression(
      key.time,
      'second',
      new Map(),
      new Map(),
      state.path,
      context.issue,
    );
    const motionValue = compileAndEvaluateHirExpression(
      key.value,
      expected,
      new Map(),
      new Map(),
      state.path,
      context.issue,
    );
    const time = timeValue?.kind === 'number' && timeValue.type === 'second' ? timeValue : null;
    const typedVector = vector(motionValue, track.property);
    if (time === null || typedVector === null) continue;
    if (track.property === 'scale' && !positiveScale(typedVector)) {
      context.issue(
        state.path,
        key.value.span,
        'asset.invalid-motion-scale',
        'Motion scale keys require strictly positive ratio components.',
      );
      continue;
    }
    if (time.value.numerator < 0n || exactGreater(time, duration))
      context.issue(
        state.path,
        key.time.span,
        'asset.invalid-motion-key',
        'Motion key time must lie within the declared duration.',
      );
    if (previous !== null && !exactLess(previous, time))
      context.issue(
        state.path,
        key.time.span,
        'asset.invalid-motion-key',
        'Motion key times must be strictly increasing.',
      );
    previous = time;
    keys.push(
      freeze({
        time: time as TypedMotionKey['time'],
        value: typedVector,
        interpolation: key.interpolation,
        span: key.span,
      }),
    );
  }
  if (keys.length === 0)
    context.issue(
      state.path,
      track.span,
      'asset.invalid-motion-key',
      'Every motion track requires at least one valid key.',
    );
  return freeze({
    target: track.target,
    property: track.property,
    keyframes: freeze(keys),
    span: track.span,
  });
};

export const buildMotion = (
  context: AssemblyContext,
  state: AssemblyState,
  entry: AssemblyEntry,
  rigs: Readonly<Record<string, TypedRigContract>>,
): TypedMotion | null => {
  const declaration = entry.declaration as AssetMotionDecl;
  const rigEntry = context.resolve(state, declaration.rig, 'rig-contract');
  const rig = rigEntry === null ? null : rigs[rigEntry.symbol.key];
  if (rigEntry === null) return null;
  if (rig === null || rig === undefined) {
    context.issue(
      state.path,
      declaration.rig.span,
      'asset.internal-reference',
      'Resolved rig contract is missing from the typed HIR index.',
    );
    return null;
  }
  const fields = properties(context, state, declaration);
  const durationValue = value(context, state, fields.get('duration'), 'second', declaration);
  const fpsValue = value(context, state, fields.get('fps'), 'integer', declaration);
  const restValue = value(context, state, fields.get('rest-relative'), 'bool', declaration);
  const duration =
    durationValue?.kind === 'number' && durationValue.type === 'second' ? durationValue : null;
  const fps = fpsValue?.kind === 'number' && fpsValue.type === 'integer' ? fpsValue : null;
  const restRelative = restValue?.kind === 'boolean' ? restValue : null;
  if (!positive(duration))
    context.issue(
      state.path,
      declaration.span,
      'asset.invalid-motion-duration',
      'Motion duration must be positive.',
    );
  if (!positive(fps) || fps.value.denominator !== 1n || fps.value.numerator > 240n) {
    context.issue(
      state.path,
      declaration.span,
      'asset.invalid-motion-fps',
      'Motion fps must be an integer from 1 through 240.',
    );
  }
  if (restRelative?.value !== true)
    context.issue(
      state.path,
      declaration.span,
      'asset.motion-space',
      'Reusable rig motion must explicitly be rest-relative.',
    );
  const loopExpr = fields.get('loop')?.value;
  const loopName = loopExpr?.kind === 'name' ? loopExpr.value : null;
  const loop =
    loopName === 'once' || loopName === 'loop' || loopName === 'hold_on_last_frame'
      ? loopName
      : null;
  if (loop === null)
    context.issue(
      state.path,
      loopExpr?.span ?? declaration.span,
      'asset.invalid-motion-loop',
      'Motion loop must be once, loop, or hold_on_last_frame.',
    );
  if (duration === null || fps === null || restRelative === null || loop === null) return null;
  if (!withinFrameBudget(duration, fps)) {
    context.issue(
      state.path,
      fields.get('duration')?.span ?? declaration.span,
      'asset.motion-frame-limit',
      `Motion duration at its fps must not exceed ${ASSET_BUDGET.motionFrames} frames.`,
    );
    return null;
  }
  const tracks: TypedMotionTrack[] = [];
  const ids = new Set<string>();
  for (const track of declaration.tracks) {
    const id = `${track.target}\u0000${track.property}`;
    if (ids.has(id))
      context.issue(
        state.path,
        track.span,
        'asset.duplicate-motion-track',
        'A motion may define a semantic joint channel only once.',
      );
    ids.add(id);
    const typed = buildTrack(context, state, rig, duration, track);
    if (typed !== null) tracks.push(typed);
  }
  return freeze({
    symbol: entry.symbol,
    rig: rig.symbol,
    duration: duration as TypedMotion['duration'],
    fps: fps as AssetIntegerValue,
    loop,
    restRelative: restRelative as AssetBooleanValue,
    tracks: freeze(tracks),
    span: declaration.span,
  });
};
