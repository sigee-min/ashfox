import { compareText } from '../../../stableOrder';
import { deepFreeze, freeze } from '../../../immutable';
import type {
  AnimationClip,
  AnimationLoopMode,
  TransformChannel,
  TransformKeyframe,
} from '../../../model/motion';
import type { EntityId } from '../../../model/identity';
import type { ExpressionMotionSlotSpec } from '../../../model/expression';
import { lowerMotionExpressions } from './canonicalExpr';
import type { BoneNode } from '../../../model/scene';
import type { AssetDiagnostic } from '../../../project/program/asset/contract';
import type { AssetExactNumber } from './value/contract';
import { lowerBones } from './canonicalBones';
import { bakeInstantiatedMotion, shouldUseMotionBake } from './canonicalBake';
import { compareDiagnostics } from './diagnostics';
import {
  INTEGER_BOUNDARY,
  MAX_MOTION_FRAMES,
  NUMBER_BOUNDARY,
  addIssue,
  canonicalNumber,
  exactCompare,
  exactValue,
  hashId,
  keyVector,
  registerId,
  type Location,
} from './canonicalSupport';
import type {
  InstantiatedAssetIr,
  InstantiatedMotion,
  InstantiatedMotionChannel,
  InstantiatedMotionKey,
} from './ir';

export type CanonicalRigLoweringResult =
  | Readonly<{
      readonly ok: true;
      readonly bones: readonly BoneNode[];
      readonly roots: readonly EntityId[];
      readonly animations: Readonly<Record<string, AnimationClip>>;
      readonly expressionSpecsByClipId: Readonly<
        Record<string, readonly ExpressionMotionSlotSpec[]>
      >;
    }>
  | Readonly<{
      readonly ok: false;
      readonly diagnostics: readonly AssetDiagnostic[];
    }>;

interface MotionTiming {
  readonly duration: number;
  readonly durationExact: AssetExactNumber;
  readonly fps: number;
  readonly loop: AnimationLoopMode;
}

interface KeyCursor {
  previousExact: AssetExactNumber | null;
  previousTime: number;
}

const motionLocation = (motion: InstantiatedMotion): Location => ({
  path: motion.sourcePath,
  span: motion.span,
});

const isLoopMode = (loop: unknown): loop is AnimationLoopMode =>
  loop === 'once' || loop === 'loop' || loop === 'hold_on_last_frame';

const withinFrameBudget = (
  durationExact: AssetExactNumber | null,
  fpsExact: AssetExactNumber | null,
) =>
  durationExact !== null &&
  fpsExact !== null &&
  durationExact.unit === 'second' &&
  fpsExact.unit === 'plain' &&
  durationExact.numerator * fpsExact.numerator <=
    BigInt(MAX_MOTION_FRAMES) * durationExact.denominator * fpsExact.denominator;

const isRestRelative = (motion: InstantiatedMotion): boolean =>
  motion.restRelative?.kind === 'boolean' &&
  motion.restRelative.type === 'bool' &&
  motion.restRelative.value === true;

const readMotionTiming = (
  motion: InstantiatedMotion,
  location: Location,
  diagnostics: AssetDiagnostic[],
): MotionTiming | null => {
  const durationExact = exactValue(motion.duration);
  const fpsExact = exactValue(motion.fps);
  const duration = canonicalNumber(
    motion.duration,
    'second',
    NUMBER_BOUNDARY,
    location,
    diagnostics,
  );
  const fps = canonicalNumber(motion.fps, 'plain', INTEGER_BOUNDARY, location, diagnostics);
  if (duration === null || fps === null || duration <= 0 || !isRestRelative(motion)) {
    if (duration !== null && duration <= 0) {
      addIssue(
        diagnostics,
        location,
        'asset.motion-duration',
        'Motion duration must be strictly positive.',
      );
    }
    if (motion.restRelative?.value !== true) {
      addIssue(
        diagnostics,
        location,
        'asset.motion-space',
        'Canonical rig motion must be rest-space relative.',
      );
    }
    return null;
  }
  if (!isLoopMode(motion.loop)) {
    addIssue(
      diagnostics,
      location,
      'asset.motion-loop',
      'Motion loop must be once, loop, or hold_on_last_frame.',
    );
    return null;
  }
  if (durationExact === null || !withinFrameBudget(durationExact, fpsExact)) {
    addIssue(
      diagnostics,
      location,
      'asset.motion-frame-limit',
      `Motion duration at its fps must not exceed ${MAX_MOTION_FRAMES} frames.`,
    );
    return null;
  }
  return { duration, durationExact, fps, loop: motion.loop };
};

const isInterpolation = (value: unknown): value is TransformKeyframe['interpolation'] =>
  value === 'linear' || value === 'step' || value === 'catmullrom';

const validateKeyTiming = (
  time: number,
  timeExact: AssetExactNumber,
  timing: MotionTiming,
  cursor: KeyCursor,
  keyLocation: Location,
  diagnostics: AssetDiagnostic[],
): void => {
  const endCmp = exactCompare(timeExact, timing.durationExact);
  if (time < 0 || time > timing.duration || endCmp === null || endCmp > 0) {
    addIssue(
      diagnostics,
      keyLocation,
      'asset.motion-key-range',
      'Motion key time must lie within the declared duration.',
    );
  }
  if (cursor.previousExact !== null && exactCompare(cursor.previousExact, timeExact)! >= 0) {
    addIssue(
      diagnostics,
      keyLocation,
      'asset.motion-key-order',
      'Motion key times must be strictly increasing.',
    );
  }
  if (cursor.previousTime !== -Infinity && time <= cursor.previousTime) {
    addIssue(
      diagnostics,
      keyLocation,
      'asset.motion-key-precision',
      'Motion key times cannot collapse at the canonical numeric boundary.',
    );
  }
  cursor.previousExact = timeExact;
  cursor.previousTime = time;
};

const lowerMotionKey = (
  key: InstantiatedMotionKey,
  index: number,
  channelOwner: string,
  property: 'position' | 'rotation' | 'scale',
  timing: MotionTiming,
  cursor: KeyCursor,
  path: string,
  seenIds: Map<string, string>,
  diagnostics: AssetDiagnostic[],
): TransformKeyframe | null => {
  const keyLocation: Location = { path, span: key.span };
  const timeExact = exactValue(key.time);
  const time = canonicalNumber(key.time, 'second', NUMBER_BOUNDARY, keyLocation, diagnostics);
  const value = keyVector(key, property, keyLocation, diagnostics);
  if (timeExact === null || time === null || value === null) return null;
  validateKeyTiming(time, timeExact, timing, cursor, keyLocation, diagnostics);
  const keyOwner = `${channelOwner}\u0000${index}`;
  const keyId = hashId('key', keyOwner);
  if (!registerId(seenIds, keyId, keyOwner, keyLocation, 'key', diagnostics)) return null;
  if (!isInterpolation(key.interpolation)) {
    addIssue(
      diagnostics,
      keyLocation,
      'asset.motion-interpolation',
      'Motion key interpolation must be linear, step, or catmullrom.',
    );
  }
  return freeze({ id: keyId, timeSeconds: time, value, interpolation: key.interpolation });
};

const validateChannelMeta = (
  channel: InstantiatedMotionChannel,
  symbolKey: string,
  channelLocation: Location,
  semanticToId: ReadonlyMap<string, string>,
  seenIds: Map<string, string>,
  diagnostics: AssetDiagnostic[],
): Readonly<{
  readonly target: string;
  readonly property: 'position' | 'rotation' | 'scale';
  readonly channelOwner: string;
  readonly channelId: string;
}> | null => {
  const target =
    typeof channel.targetBoneId === 'string' ? semanticToId.get(channel.targetBoneId) : undefined;
  if (target === undefined) {
    addIssue(
      diagnostics,
      channelLocation,
      'asset.motion-target-missing',
      `Motion channel targets missing semantic joint "${channel.targetBoneId}".`,
    );
    return null;
  }
  const property = channel.property;
  if (property !== 'position' && property !== 'rotation' && property !== 'scale') {
    addIssue(
      diagnostics,
      channelLocation,
      'asset.motion-channel',
      'Canonical motion channels may only translate, rotate, or scale bones.',
    );
    return null;
  }
  const channelOwner = `${symbolKey}\u0000${channel.targetBoneId}\u0000${property}`;
  const channelId = hashId('channel', channelOwner);
  if (!registerId(seenIds, channelId, channelOwner, channelLocation, 'channel', diagnostics))
    return null;
  if (!Array.isArray(channel.keys) || channel.keys.length === 0) {
    addIssue(
      diagnostics,
      channelLocation,
      'asset.motion-keys',
      'Every canonical motion channel requires at least one key.',
    );
    return null;
  }
  return { target, property, channelOwner, channelId };
};

const lowerChannel = (
  channel: InstantiatedMotionChannel,
  symbolKey: string,
  timing: MotionTiming,
  path: string,
  semanticToId: ReadonlyMap<string, string>,
  seenIds: Map<string, string>,
  diagnostics: AssetDiagnostic[],
): TransformChannel | null => {
  const channelLocation: Location = { path, span: channel.span };
  const meta = validateChannelMeta(
    channel,
    symbolKey,
    channelLocation,
    semanticToId,
    seenIds,
    diagnostics,
  );
  if (meta === null) return null;
  const keys: TransformKeyframe[] = [];
  const cursor: KeyCursor = { previousExact: null, previousTime: -Infinity };
  for (let index = 0; index < channel.keys.length; index += 1) {
    const lowered = lowerMotionKey(
      channel.keys[index]!,
      index,
      meta.channelOwner,
      meta.property,
      timing,
      cursor,
      path,
      seenIds,
      diagnostics,
    );
    if (lowered !== null) keys.push(lowered);
  }
  return freeze({
    id: meta.channelId,
    targetNodeId: meta.target,
    property: meta.property,
    ...(meta.property === 'rotation' ? { rotationSpace: 'bone' as const } : {}),
    keys: freeze(keys),
  });
};

const lowerStaticChannels = (
  motion: InstantiatedMotion,
  symbolKey: string,
  timing: NonNullable<ReturnType<typeof readMotionTiming>>,
  location: Location,
  semanticToId: ReadonlyMap<string, string>,
  seenIds: Map<string, string>,
  diagnostics: AssetDiagnostic[],
): TransformChannel[] | null => {
  const exprCount = motion.expressions?.length ?? 0;
  if ((!Array.isArray(motion.channels) || motion.channels.length === 0) && exprCount === 0) {
    addIssue(
      diagnostics,
      location,
      'asset.motion-channels',
      'A motion requires at least one channel.',
    );
    return null;
  }
  if (!Array.isArray(motion.channels) || motion.channels.length === 0) return [];
  const channelIds = new Map<string, TransformChannel>();
  for (const channel of motion.channels) {
    const lowered = lowerChannel(
      channel,
      symbolKey,
      timing,
      location.path,
      semanticToId,
      seenIds,
      diagnostics,
    );
    if (lowered !== null) channelIds.set(lowered.id, lowered);
  }
  return [...channelIds.values()].sort((left, right) => compareText(left.id, right.id));
};

const buildStaticMotionClip = (
  motion: InstantiatedMotion,
  clipId: string,
  timing: NonNullable<ReturnType<typeof readMotionTiming>>,
  location: Location,
  semanticToId: ReadonlyMap<string, string>,
  seenIds: Map<string, string>,
  diagnostics: AssetDiagnostic[],
  initialDiagnostics: number,
): AnimationClip | null => {
  const channels = lowerStaticChannels(
    motion,
    motion.symbol.key,
    timing,
    location,
    semanticToId,
    seenIds,
    diagnostics,
  );
  if (!channels || diagnostics.length !== initialDiagnostics) return null;
  return freeze({
    id: clipId,
    name: motion.symbol.name,
    durationSeconds: timing.duration,
    fps: timing.fps,
    loop: timing.loop,
    channels: deepFreeze(Object.fromEntries(channels.map((channel) => [channel.id, channel]))),
    triggers: deepFreeze({}),
    ...(motion.cues && motion.cues.length > 0 ? { cues: deepFreeze(motion.cues) } : {}),
  });
};

const lowerMotion = (
  ir: InstantiatedAssetIr,
  bones: readonly BoneNode[],
  motion: InstantiatedMotion,
  semanticToId: ReadonlyMap<string, string>,
  seenIds: Map<string, string>,
  diagnostics: AssetDiagnostic[],
  expressionSpecsByClipId: Record<string, readonly ExpressionMotionSlotSpec[]>,
): AnimationClip | null => {
  const initialDiagnostics = diagnostics.length;
  const location = motionLocation(motion);
  const symbol = motion.symbol;
  if (
    typeof symbol.key !== 'string' ||
    symbol.key.length === 0 ||
    typeof symbol.name !== 'string' ||
    symbol.name.length === 0 ||
    symbol.kind !== 'motion'
  ) {
    addIssue(
      diagnostics,
      location,
      'asset.motion-symbol',
      'Motion output requires a complete nominal symbol identity.',
    );
    return null;
  }
  const clipId = hashId('clip', symbol.key);
  if (!registerId(seenIds, clipId, symbol.key, location, 'clip', diagnostics)) return null;
  const timing = readMotionTiming(motion, location, diagnostics);
  if (timing === null) return null;
  const exprSpecs = lowerMotionExpressions(motion, location, diagnostics);
  if (exprSpecs.length > 0) expressionSpecsByClipId[clipId] = exprSpecs;
  if (shouldUseMotionBake(motion)) {
    const baked = bakeInstantiatedMotion(
      ir,
      bones,
      motion,
      clipId,
      timing.duration,
      timing.fps,
      timing.loop,
      semanticToId,
      seenIds,
      diagnostics,
    );
    return diagnostics.length !== initialDiagnostics ? null : baked;
  }
  return buildStaticMotionClip(
    motion,
    clipId,
    timing,
    location,
    semanticToId,
    seenIds,
    diagnostics,
    initialDiagnostics,
  );
};

/** Lower the canonical skeleton and its already-retargeted rest-space relative motions. */
export const lowerAssetRigAndMotions = (ir: InstantiatedAssetIr): CanonicalRigLoweringResult => {
  const diagnostics: AssetDiagnostic[] = [];
  try {
    const plan = lowerBones(ir.bones, diagnostics);
    if (plan === null) return deepFreeze({ ok: false, diagnostics });
    const seenIds = new Map<string, string>();
    const clips: AnimationClip[] = [];
    const expressionSpecsByClipId: Record<string, readonly ExpressionMotionSlotSpec[]> =
      Object.create(null);
    for (const motion of [...ir.motions].sort((left, right) =>
      compareText(left.symbol.key, right.symbol.key),
    )) {
      const clip = lowerMotion(
        ir,
        plan.bones,
        motion,
        plan.semanticToId,
        seenIds,
        diagnostics,
        expressionSpecsByClipId,
      );
      if (clip !== null) clips.push(clip);
    }
    if (diagnostics.length > 0) {
      return deepFreeze({
        ok: false,
        diagnostics: deepFreeze([...diagnostics].sort(compareDiagnostics)),
      });
    }
    const entries = clips
      .sort((left, right) => compareText(left.id, right.id))
      .map((clip) => [clip.id, clip] as const);
    return deepFreeze({
      ok: true,
      bones: plan.bones,
      roots: plan.roots,
      animations: deepFreeze(Object.fromEntries(entries)),
      expressionSpecsByClipId: deepFreeze(expressionSpecsByClipId),
    });
  } catch {
    const first = ir.bones[0];
    if (first !== undefined) {
      addIssue(
        diagnostics,
        { path: first.sourcePath, span: first.span },
        'asset.canonical-lowering',
        'Canonical rig lowering failed closed.',
      );
    }
    return deepFreeze({
      ok: false,
      diagnostics: deepFreeze([...diagnostics].sort(compareDiagnostics)),
    });
  }
};
