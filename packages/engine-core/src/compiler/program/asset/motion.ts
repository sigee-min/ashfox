import { freeze } from '../../../immutable';
import { docsHint, formatDidYouMean } from '../../../project/source/suggest';
import type {
  AssetMotionDecl,
  AssetPropertyDecl,
  AssetValueType,
} from '../../../project/program/asset/contract';
import {
  assetBooleanValue,
  type AssetBooleanValue,
  type AssetNumberValue,
  type AssetValue,
} from './value/contract';
import type {
  AssetDegreeVectorValue,
  AssetIntegerValue,
  AssetRatioVectorValue,
  AssetUnitVectorValue,
  TypedMotion,
  TypedMotionKey,
  TypedMotionTrack,
  TypedRigContract,
} from './contract';
import { buildMotionExpressions as buildExpressions } from './motionExpr';
import type { AssemblyContext, AssemblyEntry, AssemblyState } from './assembly';
import { compileAndEvaluateHirExpression } from './hirValues';
import { ASSET_BUDGET } from './budgets';
import {
  buildCombatOps,
  buildCues,
  buildLayers,
  buildMotionIks,
  buildPoseKeys,
  buildPoses,
  buildSecondaries,
  buildWaves,
  channelValueType,
  lowerCurveSpec,
} from './motionPass';

const properties = (
  context: AssemblyContext,
  state: AssemblyState,
  declaration: AssetMotionDecl,
): ReadonlyMap<string, AssetPropertyDecl> => {
  const result = new Map<string, AssetPropertyDecl>();
  const allowed = new Set(['duration', 'fps', 'loop', 'rest_relative']);
  for (const property of declaration.properties) {
    if (!allowed.has(property.name)) {
      context.issue(
        state.path,
        property.span,
        'asset.invalid-motion-property',
        `Unknown motion property "${property.name}".${formatDidYouMean(property.name, [...allowed])}`,
        docsHint('motion'),
      );
    }
    if (result.has(property.name)) {
      context.issue(
        state.path,
        property.span,
        'asset.duplicate-motion-property',
        `Motion property "${property.name}" is declared more than once.`,
      );
    }
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
): AssetUnitVectorValue | AssetDegreeVectorValue | AssetRatioVectorValue | null => {
  if (source?.kind !== 'vector') return null;
  if (property === 'position' && source.type === 'vec3<unit>') {
    return source as AssetUnitVectorValue;
  }
  if (property === 'rotation' && source.type === 'vec3<degree>') {
    return source as AssetDegreeVectorValue;
  }
  if (property === 'scale' && source.type === 'vec3<ratio>') {
    return source as AssetRatioVectorValue;
  }
  return null;
};

const positiveScale = (
  value: AssetUnitVectorValue | AssetDegreeVectorValue | AssetRatioVectorValue,
): boolean =>
  value.type === 'vec3<ratio>' && value.values.every((component) => component.value.numerator > 0n);

const withinFrameBudget = (duration: AssetNumberValue, fps: AssetNumberValue): boolean =>
  duration.value.numerator * fps.value.numerator <=
  BigInt(ASSET_BUDGET.motionFrames) * duration.value.denominator * fps.value.denominator;

const validateKeyframeOrder = (
  context: AssemblyContext,
  state: AssemblyState,
  span: AssetMotionDecl['tracks'][number]['keyframes'][number]['time']['span'],
  time: AssetNumberValue,
  duration: AssetNumberValue,
  previous: AssetNumberValue | null,
): void => {
  if (time.value.numerator < 0n || exactGreater(time, duration)) {
    context.issue(
      state.path,
      span,
      'asset.invalid-motion-key',
      'Motion key time must lie within the declared duration.',
    );
  }
  if (previous !== null && !exactLess(previous, time)) {
    context.issue(
      state.path,
      span,
      'asset.invalid-motion-key',
      'Motion key times must be strictly increasing.',
    );
  }
};

const buildKeyframe = (
  context: AssemblyContext,
  state: AssemblyState,
  key: AssetMotionDecl['tracks'][number]['keyframes'][number],
  property: TypedMotionTrack['property'],
  expected: AssetValueType,
  duration: AssetNumberValue,
  previous: AssetNumberValue | null,
): TypedMotionKey | null => {
  const timeVal = compileAndEvaluateHirExpression(
    key.time,
    'second',
    new Map(),
    new Map(),
    state.path,
    context.issue,
  );
  const motionVal = compileAndEvaluateHirExpression(
    key.value,
    expected,
    new Map(),
    new Map(),
    state.path,
    context.issue,
  );
  const time = timeVal?.kind === 'number' && timeVal.type === 'second' ? timeVal : null;
  const typedVector = vector(motionVal, property);
  if (time === null || typedVector === null) return null;
  if (property === 'scale' && !positiveScale(typedVector)) {
    context.issue(
      state.path,
      key.value.span,
      'asset.invalid-motion-scale',
      'Motion scale keys require strictly positive ratio components.',
    );
    return null;
  }
  validateKeyframeOrder(context, state, key.time.span, time, duration, previous);
  return freeze({
    time: time as TypedMotionKey['time'],
    value: typedVector,
    interpolation: key.interpolation,
    curve: lowerCurveSpec(context, state, key.curve),
    span: key.span,
  });
};

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
  if (!joint.channels.includes(track.property)) {
    context.issue(
      state.path,
      track.span,
      'asset.motion-channel',
      `Rig joint "${track.target}" does not expose ${track.property}.`,
    );
  }
  const expected = channelValueType(track.property);
  const keys: TypedMotionKey[] = [];
  let previous: AssetNumberValue | null = null;
  for (const key of track.keyframes) {
    const typedKey = buildKeyframe(
      context,
      state,
      key,
      track.property,
      expected,
      duration,
      previous,
    );
    if (typedKey === null) continue;
    previous = typedKey.time;
    keys.push(typedKey);
  }
  if (keys.length === 0) {
    context.issue(
      state.path,
      track.span,
      'asset.invalid-motion-key',
      'Every motion track requires at least one valid key.',
    );
  }
  return freeze({
    target: track.target,
    property: track.property,
    keyframes: freeze(keys),
    span: track.span,
  });
};

interface ValidatedMotionHeader {
  readonly duration: AssetNumberValue;
  readonly fps: AssetIntegerValue;
  readonly loop: TypedMotion['loop'];
  readonly restRelative: AssetBooleanValue;
}

const readMotionLoop = (
  context: AssemblyContext,
  state: AssemblyState,
  declaration: AssetMotionDecl,
  fields: ReadonlyMap<string, AssetPropertyDecl>,
): TypedMotion['loop'] | null => {
  const loopExpr = fields.get('loop')?.value;
  const loopName = loopExpr?.kind === 'name' ? loopExpr.value : null;
  if (loopName === 'once' || loopName === 'loop' || loopName === 'hold_on_last_frame') {
    return loopName;
  }
  const suggestion = loopName
    ? formatDidYouMean(loopName, ['once', 'loop', 'hold_on_last_frame'])
    : '';
  context.issue(
    state.path,
    loopExpr?.span ?? declaration.span,
    'asset.invalid-motion-loop',
    `Motion loop must be once, loop, or hold_on_last_frame.${suggestion}`,
    docsHint('motion'),
  );
  return null;
};

const validateMotionScalars = (
  context: AssemblyContext,
  state: AssemblyState,
  declaration: AssetMotionDecl,
  duration: AssetNumberValue | null,
  fps: AssetNumberValue | null,
  restRelative: AssetBooleanValue | null,
): void => {
  if (!positive(duration)) {
    context.issue(
      state.path,
      declaration.span,
      'asset.invalid-motion-duration',
      'Motion duration must be positive.',
    );
  }
  if (!positive(fps) || fps.value.denominator !== 1n || fps.value.numerator > 240n) {
    context.issue(
      state.path,
      declaration.span,
      'asset.invalid-motion-fps',
      'Motion fps must be an integer from 1 through 240.',
    );
  }
  if (restRelative?.value !== true) {
    context.issue(
      state.path,
      declaration.span,
      'asset.motion-space',
      'Reusable rig motion must explicitly be rest-space relative.',
    );
  }
};

const validateMotionHeader = (
  context: AssemblyContext,
  state: AssemblyState,
  declaration: AssetMotionDecl,
): ValidatedMotionHeader | null => {
  const fields = properties(context, state, declaration);
  const durationValue = value(context, state, fields.get('duration'), 'second', declaration);
  const fpsValue = value(context, state, fields.get('fps'), 'integer', declaration);
  const restField = fields.get('rest_relative');
  const restValue =
    restField === undefined
      ? assetBooleanValue(true)
      : value(context, state, restField, 'bool', declaration);
  const duration =
    durationValue?.kind === 'number' && durationValue.type === 'second' ? durationValue : null;
  const fps = fpsValue?.kind === 'number' && fpsValue.type === 'integer' ? fpsValue : null;
  const restRelative = restValue?.kind === 'boolean' ? restValue : null;
  validateMotionScalars(context, state, declaration, duration, fps, restRelative);
  const loop = readMotionLoop(context, state, declaration, fields);
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
  return {
    duration,
    fps: fps as AssetIntegerValue,
    loop,
    restRelative: restRelative as AssetBooleanValue,
  };
};

const collectMotionTracks = (
  context: AssemblyContext,
  state: AssemblyState,
  declaration: AssetMotionDecl,
  buildTrackFn: (track: AssetMotionDecl['tracks'][number]) => TypedMotionTrack | null,
): readonly TypedMotionTrack[] => {
  const tracks: TypedMotionTrack[] = [];
  const ids = new Set<string>();
  for (const track of declaration.tracks) {
    const id = `${track.target}\u0000${track.property}`;
    if (ids.has(id)) {
      context.issue(
        state.path,
        track.span,
        'asset.duplicate-motion-track',
        'A motion may define a semantic joint channel only once.',
      );
    }
    ids.add(id);
    const typed = buildTrackFn(track);
    if (typed !== null) tracks.push(typed);
  }
  return freeze(tracks);
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
  if (!rig) {
    context.issue(
      state.path,
      declaration.rig.span,
      'asset.internal-reference',
      'Resolved rig contract is missing from the typed HIR index.',
    );
    return null;
  }
  const header = validateMotionHeader(context, state, declaration);
  if (header === null) return null;
  const buildTrackFn = (track: AssetMotionDecl['tracks'][number]) =>
    buildTrack(context, state, rig, header.duration, track);
  const poses = buildPoses(context, state, rig, declaration.poses);
  const poseIds = new Set(poses.map((p) => p.id));
  const expressions = buildExpressions(context, state, header.duration, declaration);
  return freeze({
    symbol: entry.symbol,
    rig: rig.symbol,
    duration: header.duration as TypedMotion['duration'],
    fps: header.fps,
    loop: header.loop,
    restRelative: header.restRelative,
    tracks: collectMotionTracks(context, state, declaration, buildTrackFn),
    layers: buildLayers(
      context,
      state,
      rig,
      poseIds,
      header.duration,
      declaration.layers,
      buildTrackFn,
    ),
    waves: buildWaves(context, state, rig, declaration.waves),
    poses,
    poseKeys: buildPoseKeys(context, state, poseIds, header.duration, declaration.poseKeys),
    iks: buildMotionIks(context, state, rig, declaration.iks),
    secondaries: buildSecondaries(context, state, rig, declaration.secondaries),
    combat: buildCombatOps(context, state, rig, declaration.combatOps),
    cues: buildCues(context, state, rig, declaration.cues),
    ...(expressions.length > 0 ? { expressions } : {}),
    span: declaration.span,
  });
};
