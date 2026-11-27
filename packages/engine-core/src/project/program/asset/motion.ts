import type { SourceSpan } from '../../source/contract';
import type { ProgramExpr } from '../syntax/contract';
import type {
  AssetCombatOpDecl,
  AssetCueDecl,
  AssetCurveDecl,
  AssetCurveName,
  AssetExpressionSlotTrackDecl,
  AssetGaitDecl,
  AssetKeyframeDecl,
  AssetMotionDecl,
  AssetMotionIkDecl,
  AssetMotionLayerDecl,
  AssetPoseDecl,
  AssetPoseEntryDecl,
  AssetPoseKeyDecl,
  AssetPropertyDecl,
  AssetSecondaryDecl,
  AssetTrackDecl,
  AssetWaveArgDecl,
  AssetWaveBindingDecl,
} from './contract';
import { docsHint, formatDidYouMean } from '../../source/suggest';
import { isOneOf, join, nameOr, readBraced, readProperty, type AssetReader } from './parserSupport';
import {
  CURVE_NAMES,
  readChannelName,
  readCombatOp,
  readCue,
  readExpressionTrack,
  readMotionIk,
  readSecondary,
  readTargetPath,
} from './motionStmt';

const readCurveArgs = (
  reader: AssetReader,
): { args: readonly ProgramExpr[]; end: SourceSpan | null } => {
  if (!reader.match('(')) return { args: Object.freeze([]), end: null };
  const args: ProgramExpr[] = [];
  if (!reader.check(')')) {
    do {
      args.push(reader.expression());
    } while (reader.match(','));
  }
  const close = reader.expect(')', 'Expected ) to close curve parameters.');
  return { args: Object.freeze(args), end: close.span };
};

const readOptionalCurve = (
  reader: AssetReader,
  fallbackSpan: SourceSpan,
  required: boolean,
): AssetCurveDecl => {
  const current = reader.current();
  if (current.kind === 'identifier' && isOneOf(CURVE_NAMES, current.value)) {
    const token = reader.take();
    const { args, end } = readCurveArgs(reader);
    return Object.freeze({
      kind: 'curve',
      name: token.value as AssetCurveName,
      args,
      span: join(token.span, end ?? token.span),
    });
  }
  if (required) {
    reader.failSpan(
      'asset.missing-interpolation',
      'Every motion key must declare an explicit curve or interpolation.',
      fallbackSpan,
      docsHint('animation'),
    );
  }
  return Object.freeze({
    kind: 'curve',
    name: 'smooth',
    args: Object.freeze([]),
    span: fallbackSpan,
  });
};

const keyInterpolation = (name: AssetCurveName): AssetKeyframeDecl['interpolation'] => {
  if (name === 'step') return 'step';
  if (name === 'catmullrom') return 'catmullrom';
  return 'linear';
};

const readKeyframe = (reader: AssetReader): AssetKeyframeDecl => {
  const keyStart = reader.expectWord('key', 'Tracks contain key declarations.');
  const time = reader.expression();
  reader.expect('=', 'Expected = in a key declaration.');
  const value = reader.expression();
  const curve = readOptionalCurve(reader, value.span, true);
  reader.finish();
  return Object.freeze({
    kind: 'keyframe',
    time,
    value,
    interpolation: keyInterpolation(curve.name),
    curve,
    span: join(keyStart.span, curve.span),
  });
};

const readTrack = (reader: AssetReader): AssetTrackDecl => {
  const start = reader.expectWord('track', 'Expected track.');
  const target = readTargetPath(reader, 'Expected a track target.');
  reader.expect('.', 'Tracks require .position, .rotation, or .scale.');
  const property = readChannelName(reader, 'track');
  const keyframes: AssetKeyframeDecl[] = [];
  const close = readBraced(
    reader,
    'Expected { to begin a track.',
    'Expected } to close a track.',
    () => {
      keyframes.push(readKeyframe(reader));
    },
  );
  return Object.freeze({
    kind: 'track',
    target,
    property,
    keyframes: Object.freeze(keyframes),
    span: join(start.span, close.span),
  });
};

const readWaveArgs = (reader: AssetReader): AssetWaveArgDecl[] => {
  const args: AssetWaveArgDecl[] = [];
  if (!reader.match('(')) return args;
  if (!reader.check(')')) {
    do {
      if (reader.assignment()) {
        const name = reader.id('Expected wave parameter name.');
        reader.expect('=', 'Expected =.');
        const value = reader.expression();
        args.push(Object.freeze({ name: name.value, value, span: join(name.span, value.span) }));
      } else {
        const value = reader.expression();
        args.push(Object.freeze({ name: null, value, span: value.span }));
      }
    } while (reader.match(','));
  }
  reader.expect(')', 'Expected ) to close wave arguments.');
  return args;
};

const readWaveBinding = (reader: AssetReader): AssetWaveBindingDecl => {
  const start = reader.expectWord('wave', 'Expected wave.');
  const target = readTargetPath(reader, 'Expected a joint target for wave.');
  reader.expect('.', 'Wave target requires .position, .rotation, or .scale.');
  const property = readChannelName(reader, 'wave');
  let axis: 'x' | 'y' | 'z' = 'x';
  if (reader.match('.')) {
    const axisTok = reader.id('Expected wave axis x, y, or z.');
    if (isOneOf(['x', 'y', 'z'] as const, axisTok.value)) axis = axisTok.value;
    else {
      reader.fail(
        'asset.invalid-property',
        `Unknown axis "${axisTok.value}".${formatDidYouMean(axisTok.value, ['x', 'y', 'z'])}`,
        axisTok,
        docsHint('animation'),
      );
    }
  }
  reader.expect('=', 'Expected = in wave declaration.');
  const first = reader.current();
  let waveKind: string | null = null;
  let args: AssetWaveArgDecl[] = [];
  let scale: ProgramExpr | null = null;
  let expression: ProgramExpr | null = null;
  let endSpan = first.span;
  if (first.kind === 'identifier') {
    const kindTok = reader.take();
    if (reader.check('(')) {
      waveKind = kindTok.value;
      args = readWaveArgs(reader);
      endSpan = reader.prevSpan();
      if (reader.match('*')) {
        scale = reader.expression();
        endSpan = scale.span;
      }
    } else {
      reader.fail(
        'asset.invalid-property',
        `Wave expression "${kindTok.value}" requires (...).`,
        kindTok,
        docsHint('animation'),
      );
    }
  } else {
    expression = reader.expression();
    endSpan = expression.span;
  }
  reader.finish();
  return Object.freeze({
    kind: 'wave-binding',
    target,
    property,
    axis,
    waveKind,
    args: Object.freeze(args),
    scale,
    expression,
    span: join(start.span, endSpan),
  });
};

const readPoseEntry = (reader: AssetReader): AssetPoseEntryDecl => {
  const start = reader.current();
  const target = readTargetPath(reader, 'Expected joint name in pose.');
  reader.expect('.', 'Pose entries require .position, .rotation, or .scale.');
  const property = readChannelName(reader, 'pose');
  reader.expect('=', 'Expected = in pose entry.');
  const value = reader.expression();
  reader.finish();
  return Object.freeze({ target, property, value, span: join(start.span, value.span) });
};

const readPose = (reader: AssetReader): AssetPoseDecl => {
  const start = reader.expectWord('pose', 'Expected pose.');
  const id = reader.id('Expected pose name.');
  const entries: AssetPoseEntryDecl[] = [];
  const close = readBraced(
    reader,
    'Expected { to begin a pose.',
    'Expected } to close a pose.',
    () => {
      entries.push(readPoseEntry(reader));
    },
  );
  return Object.freeze({
    kind: 'pose',
    id: id.value,
    entries: Object.freeze(entries),
    span: join(start.span, close.span),
  });
};

const readPoseKey = (reader: AssetReader): AssetPoseKeyDecl => {
  const start = reader.expectWord('at', 'Expected at.');
  const time = reader.expression();
  reader.expectWord('pose', 'Expected pose after at <time>.');
  const poseId = reader.id('Expected pose identifier.');
  const curve = readOptionalCurve(reader, poseId.span, false);
  reader.finish();
  return Object.freeze({
    kind: 'pose-key',
    time,
    poseId: poseId.value,
    curve,
    span: join(start.span, curve.span),
  });
};

const readArgProperties = (reader: AssetReader): AssetPropertyDecl[] => {
  const props: AssetPropertyDecl[] = [];
  if (!reader.match('(')) return props;
  if (!reader.check(')')) {
    do {
      const name = reader.id('Expected parameter name.');
      reader.expect('=', 'Expected = in argument.');
      const value = reader.expression();
      props.push(
        Object.freeze({
          kind: 'property',
          name: name.value,
          value,
          span: join(name.span, value.span),
        }),
      );
    } while (reader.match(','));
  }
  reader.expect(')', 'Expected ) to close parameters.');
  return props;
};

interface LayerBodyState {
  readonly properties: AssetPropertyDecl[];
  readonly tracks: AssetTrackDecl[];
  readonly waves: AssetWaveBindingDecl[];
  readonly poseKeys: AssetPoseKeyDecl[];
  readonly gaitProps: AssetPropertyDecl[];
  gaitKind: string | null;
  gaitSpan: SourceSpan;
}

const readGaitBlock = (reader: AssetReader, state: LayerBodyState): void => {
  const start = reader.expectWord('gait', 'Expected gait.');
  const kind = reader.id('Expected gait kind.');
  state.gaitKind = kind.value;
  state.gaitSpan = start.span;
  const close = readBraced(reader, 'Expected { to begin gait.', 'Expected } to close gait.', () => {
    if (reader.assignment()) state.gaitProps.push(readProperty(reader));
    else reader.scopeError('gait');
  });
  state.gaitSpan = join(start.span, close.span);
};

const readLayer = (reader: AssetReader): AssetMotionLayerDecl => {
  const start = reader.expectWord('layer', 'Expected layer.');
  const id = reader.id('Expected layer name.');
  let mode: AssetMotionLayerDecl['mode'] = isOneOf(
    ['base', 'override', 'additive'] as const,
    id.value,
  )
    ? id.value
    : 'base';
  let gaitKind: string | null = null;
  if (reader.match(':')) {
    const spec = reader.id('Expected layer mode or gait kind.');
    if (isOneOf(['base', 'override', 'additive'] as const, spec.value)) mode = spec.value;
    else gaitKind = spec.value;
  }
  const args = readArgProperties(reader);
  const state: LayerBodyState = {
    properties: [],
    tracks: [],
    waves: [],
    poseKeys: [],
    gaitProps: [...args],
    gaitKind,
    gaitSpan: id.span,
  };
  let endSpan = id.span;
  if (reader.check('{')) {
    endSpan = readBraced(reader, 'Expected { to begin layer.', 'Expected } to close layer.', () => {
      if (reader.checkWord('track')) state.tracks.push(readTrack(reader));
      else if (reader.checkWord('wave')) state.waves.push(readWaveBinding(reader));
      else if (reader.checkWord('at')) state.poseKeys.push(readPoseKey(reader));
      else if (reader.checkWord('gait')) readGaitBlock(reader, state);
      else if (reader.assignment()) state.properties.push(readProperty(reader));
      else reader.scopeError('motion layer');
    }).span;
  } else {
    reader.finish();
  }
  return buildLayerDecl(id.value, mode, state, join(start.span, endSpan));
};

const GAIT_PROP_NAMES = new Set([
  'stride',
  'lift',
  'bounce',
  'hip_sway',
  'counter_twist',
  'lean',
  'arm_swing',
  'frequency',
  'phase',
  'foot_l',
  'foot_r',
  'thigh_l',
  'thigh_r',
  'shin_l',
  'shin_r',
  'arm_l',
  'arm_r',
  'pelvis',
  'torso',
  'head',
]);

const classifyLayerProp = (
  prop: AssetPropertyDecl,
  state: LayerBodyState,
  layerProps: AssetPropertyDecl[],
): void => {
  if (prop.name === 'gait') {
    const name = nameOr(prop.value, '');
    if (name !== null && name.length > 0) state.gaitKind = name;
    return;
  }
  const isGaitScoped = GAIT_PROP_NAMES.has(prop.name) || state.gaitKind !== null;
  if (!isGaitScoped || prop.name === 'mask' || prop.name === 'weight' || prop.name === 'mirror') {
    layerProps.push(prop);
    return;
  }
  state.gaitProps.push(prop);
};

const buildLayerDecl = (
  id: string,
  mode: AssetMotionLayerDecl['mode'],
  state: LayerBodyState,
  span: SourceSpan,
): AssetMotionLayerDecl => {
  const layerProps: AssetPropertyDecl[] = [];
  for (const prop of state.properties) classifyLayerProp(prop, state, layerProps);
  const gait: AssetGaitDecl | null =
    state.gaitKind === null
      ? null
      : Object.freeze({
          kind: state.gaitKind,
          properties: Object.freeze(state.gaitProps),
          span: state.gaitSpan,
        });
  if (state.gaitKind === null) layerProps.push(...state.gaitProps);
  return Object.freeze({
    kind: 'layer',
    id,
    mode,
    properties: Object.freeze(layerProps),
    gait,
    tracks: Object.freeze(state.tracks),
    waves: Object.freeze(state.waves),
    poseKeys: Object.freeze(state.poseKeys),
    span,
  });
};

interface MotionParseState {
  readonly properties: AssetPropertyDecl[];
  readonly tracks: AssetTrackDecl[];
  readonly expressions: AssetExpressionSlotTrackDecl[];
  readonly layers: AssetMotionLayerDecl[];
  readonly waves: AssetWaveBindingDecl[];
  readonly poses: AssetPoseDecl[];
  readonly poseKeys: AssetPoseKeyDecl[];
  readonly iks: AssetMotionIkDecl[];
  readonly secondaries: AssetSecondaryDecl[];
  readonly combatOps: AssetCombatOpDecl[];
  readonly cues: AssetCueDecl[];
}

const readMotionStatement = (reader: AssetReader, state: MotionParseState): void => {
  if (reader.checkWord('track')) state.tracks.push(readTrack(reader));
  else if (reader.checkWord('expression')) state.expressions.push(readExpressionTrack(reader));
  else if (reader.checkWord('layer')) state.layers.push(readLayer(reader));
  else if (reader.checkWord('wave')) state.waves.push(readWaveBinding(reader));
  else if (reader.checkWord('pose')) state.poses.push(readPose(reader));
  else if (reader.checkWord('at')) state.poseKeys.push(readPoseKey(reader));
  else if (reader.checkWord('ik')) state.iks.push(readMotionIk(reader));
  else if (reader.checkWord('secondary')) state.secondaries.push(readSecondary(reader));
  else if (reader.checkWord('squash')) state.combatOps.push(readCombatOp(reader, 'squash'));
  else if (reader.checkWord('smear')) state.combatOps.push(readCombatOp(reader, 'smear'));
  else if (reader.checkWord('hitstop')) state.combatOps.push(readCombatOp(reader, 'hitstop'));
  else if (reader.checkWord('recoil')) state.combatOps.push(readCombatOp(reader, 'recoil'));
  else if (reader.checkWord('cue')) state.cues.push(readCue(reader));
  else if (reader.assignment()) state.properties.push(readProperty(reader));
  else reader.scopeError('motion');
};

export const parseMotion = (reader: AssetReader, exported: boolean): AssetMotionDecl => {
  const start = reader.expectWord('motion', 'Expected motion.');
  const id = reader.id('Expected motion name.');
  reader.expectWord('for', 'Motion requires for <rig-contract>.');
  const rig = reader.qualified('Expected rig contract name.');
  const state: MotionParseState = {
    properties: [],
    tracks: [],
    expressions: [],
    layers: [],
    waves: [],
    poses: [],
    poseKeys: [],
    iks: [],
    secondaries: [],
    combatOps: [],
    cues: [],
  };
  const close = readBraced(
    reader,
    'Expected { to begin a motion.',
    'Expected } to close a motion.',
    () => readMotionStatement(reader, state),
  );
  return Object.freeze({
    kind: 'motion',
    exported,
    id: id.value,
    rig,
    properties: Object.freeze(state.properties),
    tracks: Object.freeze(state.tracks),
    ...(state.expressions.length > 0 ? { expressions: Object.freeze(state.expressions) } : {}),
    layers: Object.freeze(state.layers),
    waves: Object.freeze(state.waves),
    poses: Object.freeze(state.poses),
    poseKeys: Object.freeze(state.poseKeys),
    iks: Object.freeze(state.iks),
    secondaries: Object.freeze(state.secondaries),
    combatOps: Object.freeze(state.combatOps),
    cues: Object.freeze(state.cues),
    span: join(start.span, close.span),
  });
};
