import type { SourceSpan } from '../../../project/source/contract';
import { deepFreeze } from '../../../immutable';
import type { AnimationClip, AnimationLoopMode, TransformChannel,
  TransformKeyframe } from '../../../model/motion';
import type { EntityId, Vec3 } from '../../../model/identity';
import { boneTransformMatchesCanonicalFrame, sealCanonicalBoneFrame,
  type BoneNode } from '../../../model/scene';
import { sha256Digest } from '../../../provenance/digest';
import type { AssetDiagnostic } from '../../../project/program/asset/contract';
import {
  isAssetNumberValueShape,
  type AssetExactNumber,
  type AssetNumberValue,
  type AssetVectorValue
} from './value/contract';
import { toAssetCanonicalNumber } from './valueEvaluate';
import type { AssetExactFrame } from './frame';
import { createBoneLayouts } from './canonicalLayout';
import { lowerAssetFrameToBoneTransform } from './frameLower';
import type {
  InstantiatedAssetIr,
  InstantiatedBone,
  InstantiatedMotion,
  InstantiatedMotionKey
} from './ir';

const MAX_SAFE = Number.MAX_SAFE_INTEGER;
const MAX_MOTION_FPS = 240;
const MAX_MOTION_FRAMES = 300;
const NUMBER_BOUNDARY = Object.freeze({
  minimum: -MAX_SAFE,
  maximum: MAX_SAFE,
  integral: false
});
const INTEGER_BOUNDARY = Object.freeze({
  minimum: 1,
  maximum: MAX_MOTION_FPS,
  integral: true
});
const freeze = <T>(value: T): T => Object.freeze(value);
const codeUnitOrder = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

export type CanonicalRigLoweringResult =
  | Readonly<{
      readonly ok: true;
      readonly bones: readonly BoneNode[];
      readonly roots: readonly EntityId[];
      readonly animations: Readonly<Record<string, AnimationClip>>;
    }>
  | Readonly<{
      readonly ok: false;
      readonly diagnostics: readonly AssetDiagnostic[];
    }>;

interface Location {
  readonly path: string;
  readonly span: SourceSpan;
}

interface BonePlan {
  readonly bones: readonly BoneNode[];
  readonly roots: readonly EntityId[];
  readonly semanticToId: ReadonlyMap<string, string>;
}

const diagnostic = (
  location: Location,
  code: string,
  message: string
): AssetDiagnostic => freeze({
  severity: 'error', code, message,
  path: location.path, span: location.span
});

const motionLocation = (motion: InstantiatedMotion): Location => ({
  path: motion.sourcePath,
  span: motion.span
});

const hashId = (kind: string, nominalKey: string): string =>
  `${kind}:${sha256Digest(nominalKey)}`;

const vector = (x: number, y: number, z: number): Vec3 =>
  freeze([x, y, z]);

const exactValue = (value: AssetNumberValue): AssetExactNumber | null => {
  try {
    return isAssetNumberValueShape(value) ? value.value : null;
  } catch {
    return null;
  }
};

const exactCompare = (
  left: AssetExactNumber,
  right: AssetExactNumber
): -1 | 0 | 1 | null => {
  if (left.unit !== right.unit || left.denominator <= 0n ||
      right.denominator <= 0n) return null;
  const difference = left.numerator * right.denominator -
    right.numerator * left.denominator;
  return difference < 0n ? -1 : difference > 0n ? 1 : 0;
};

const addIssue = (
  diagnostics: AssetDiagnostic[],
  location: Location,
  code: string,
  message: string
): void => {
  if (diagnostics.length < 256) diagnostics.push(diagnostic(location, code, message));
};

const canonicalNumber = (
  value: AssetNumberValue,
  unit: 'plain' | 'second' | 'degree' | 'ratio',
  boundary: Readonly<{ minimum: number; maximum: number; integral: boolean }>,
  location: Location,
  diagnostics: AssetDiagnostic[]
): number | null => {
  if (value === null || typeof value !== 'object' || value.kind !== 'number' ||
      value.type !== (unit === 'plain' ? 'integer' : unit) ||
      !isAssetNumberValueShape(value) || value.value.unit !== unit) {
    addIssue(diagnostics, location, 'asset.canonical-number',
      `Canonical output requires an exact ${unit} number.`);
    return null;
  }
  const result = toAssetCanonicalNumber(value.value, boundary, location.span);
  if (!result.ok) {
    for (const item of result.diagnostics) addIssue(diagnostics, location,
      item.code, item.message);
    return null;
  }
  return result.value === 0 ? 0 : result.value;
};

const makeCanonicalFrame = (
  bone: InstantiatedBone,
  rotation: Vec3,
  origin: Vec3
): Readonly<NonNullable<BoneNode['canonicalFrame']>> => freeze({
  origin,
  xAxis: vector(bone.parentRestFrame.xAxis[0], bone.parentRestFrame.xAxis[1], bone.parentRestFrame.xAxis[2]),
  yAxis: vector(bone.parentRestFrame.yAxis[0], bone.parentRestFrame.yAxis[1], bone.parentRestFrame.yAxis[2]),
  zAxis: vector(bone.parentRestFrame.zAxis[0], bone.parentRestFrame.zAxis[1], bone.parentRestFrame.zAxis[2]),
  determinant: bone.parentRestFrame.determinant,
  rotation
});

const lowerBone = (
  bone: InstantiatedBone,
  parentId: string | null,
  canonicalLayout: AssetExactFrame,
  diagnostics: AssetDiagnostic[]
): BoneNode | null => {
  const location: Location = { path: bone.sourcePath, span: bone.span };
  const transform = lowerAssetFrameToBoneTransform(canonicalLayout);
  if (transform === null) {
    addIssue(diagnostics, location, 'asset.invalid-rest-frame',
      `Bone "${bone.semanticJoint}" has no canonical transform.`);
    return null;
  }
  const origin = vector(transform.pivot[0], transform.pivot[1], transform.pivot[2]);
  const rotation = vector(transform.rotation[0], transform.rotation[1], transform.rotation[2]);
  const node: BoneNode = {
    id: bone.id as EntityId,
    kind: 'bone',
    name: bone.semanticJoint,
    parentId: parentId as EntityId | null,
    transform,
    visible: true,
    canonicalFrame: makeCanonicalFrame(bone, rotation, origin)
  };
  sealCanonicalBoneFrame(node);
  const frozen = deepFreeze(node);
  if (!boneTransformMatchesCanonicalFrame(frozen)) {
    addIssue(diagnostics, location, 'asset.canonical-frame',
      `Bone "${bone.semanticJoint}" failed canonical frame sealing.`);
    return null;
  }
  return frozen;
};

const lowerBones = (
  bones: readonly InstantiatedBone[],
  diagnostics: AssetDiagnostic[]
): BonePlan | null => {
  const byId = new Map<string, InstantiatedBone>();
  const semantic = new Map<string, InstantiatedBone>();
  for (const bone of bones) {
    const location: Location = { path: bone.sourcePath, span: bone.span };
    if (typeof bone.id !== 'string' || bone.id.length === 0 ||
        typeof bone.semanticJoint !== 'string' || bone.semanticJoint.length === 0) {
      addIssue(diagnostics, location, 'asset.invalid-bone-id',
        'Canonical bones require non-empty semantic and emitted identifiers.');
      continue;
    }
    if (byId.has(bone.id)) addIssue(diagnostics, location, 'asset.duplicate-bone-id',
      `Bone identifier "${bone.id}" is declared more than once.`);
    else byId.set(bone.id, bone);
    if (semantic.has(bone.semanticJoint)) addIssue(diagnostics, location,
      'asset.duplicate-semantic-joint',
      `Semantic joint "${bone.semanticJoint}" is ambiguous.`);
    else semantic.set(bone.semanticJoint, bone);
  }
  const resolve = (name: string): InstantiatedBone | undefined =>
    semantic.get(name) ?? byId.get(name);
  const parents = new Map<string, string | null>();
  for (const bone of byId.values()) {
    const location: Location = { path: bone.sourcePath, span: bone.span };
    if (bone.parentId !== null && typeof bone.parentId !== 'string') {
      addIssue(diagnostics, location, 'asset.invalid-bone-parent',
        `Bone "${bone.id}" has an invalid parent identifier.`);
      continue;
    }
    const parent = bone.parentId === null ? null : resolve(bone.parentId);
    if (bone.parentId !== null && parent === undefined) addIssue(diagnostics, location,
      'asset.missing-bone-parent',
      `Bone "${bone.id}" names missing parent "${bone.parentId}".`);
    parents.set(bone.id, parent?.id ?? null);
  }
  const state = new Map<string, 0 | 1 | 2>();
  const visit = (id: string): void => {
    const current = state.get(id);
    if (current === 1) {
      const bone = byId.get(id)!;
      addIssue(diagnostics, { path: bone.sourcePath, span: bone.span },
        'asset.bone-cycle', 'Canonical bone parents must form an acyclic tree.');
      return;
    }
    if (current === 2) return;
    state.set(id, 1);
    const parent = parents.get(id);
    if (parent !== null && parent !== undefined) visit(parent);
    state.set(id, 2);
  };
  for (const id of [...byId.keys()].sort(codeUnitOrder)) visit(id);
  if (diagnostics.length > 0) return null;
  // Canonical runtimes subtract parent pivots to recover the local translation.
  // Accumulate offsets without rotating them here; parent rotation/scale is
  // applied exactly once by the runtime hierarchy, just as in socket frames.
  const layout = createBoneLayouts(byId, parents);
  const lowered: BoneNode[] = [];
  for (const id of [...byId.keys()].sort(codeUnitOrder)) {
    const bone = byId.get(id)!;
    const canonicalLayout = layout(id);
    if (canonicalLayout === null) {
      addIssue(diagnostics, { path: bone.sourcePath, span: bone.span },
        'asset.invalid-rest-frame', `Bone "${id}" has an invalid parent-relative rest frame.`);
      continue;
    }
    const node = lowerBone(bone, parents.get(id) ?? null, canonicalLayout, diagnostics);
    if (node !== null) lowered.push(node);
  }
  lowered.sort((left, right) => codeUnitOrder(left.id, right.id));
  const roots = lowered.filter((bone) => bone.parentId === null)
    .map((bone) => bone.id).sort(codeUnitOrder);
  return deepFreeze({
    bones: deepFreeze(lowered),
    roots: deepFreeze(roots),
    semanticToId: new Map([...semantic.entries()].map(([name, bone]) =>
      [name, bone.id]))
  });
};

const vectorComponents = (
  value: AssetVectorValue,
  type: 'vec3<degree>' | 'vec3<ratio>'
): readonly AssetNumberValue[] | null => {
  try {
    if (value === null || typeof value !== 'object' || value.kind !== 'vector' ||
        value.type !== type || !Array.isArray(value.values) ||
        value.values.length !== 3 || !value.values.every(isAssetNumberValueShape)) return null;
    return value.values;
  } catch {
    return null;
  }
};

const keyVector = (
  key: InstantiatedMotionKey,
  property: 'rotation' | 'scale',
  location: Location,
  diagnostics: AssetDiagnostic[]
): readonly [number, number, number] | null => {
  const type = property === 'rotation' ? 'vec3<degree>' : 'vec3<ratio>';
  const components = vectorComponents(key.value, type);
  if (components === null) {
    addIssue(diagnostics, location, 'asset.motion-value',
      `Motion ${property} keys require a three-component ${type} value.`);
    return null;
  }
  const unit = property === 'rotation' ? 'degree' : 'ratio';
  const values = components.map((component) => canonicalNumber(component, unit,
    NUMBER_BOUNDARY, location, diagnostics));
  if (values.some((value): value is null => value === null)) return null;
  const numeric = [values[0]!, values[1]!, values[2]!] as const;
  if (property === 'scale' && numeric.some((value) => value <= 0)) {
    addIssue(diagnostics, location, 'asset.motion-scale',
      'Motion scale keys require strictly positive ratio components.');
    return null;
  }
  return vector(numeric[0], numeric[1], numeric[2]);
};

const registerId = (
  seen: Map<string, string>,
  id: string,
  owner: string,
  location: Location,
  kind: string,
  diagnostics: AssetDiagnostic[]
): boolean => {
  const previous = seen.get(id);
  if (previous !== undefined) {
    addIssue(diagnostics, location,
      previous === owner ? `asset.duplicate-${kind}-id` : `asset.${kind}-id-collision`,
      previous === owner
        ? `Duplicate ${kind} identifier "${id}".`
        : `Hash collision for ${kind} identifier "${id}".`);
    return false;
  }
  seen.set(id, owner);
  return true;
};

const lowerMotion = (
  motion: InstantiatedMotion,
  semanticToId: ReadonlyMap<string, string>,
  seenIds: Map<string, string>,
  diagnostics: AssetDiagnostic[]
): AnimationClip | null => {
  const initialDiagnostics = diagnostics.length;
  const location = motionLocation(motion);
  const symbol = motion.symbol;
  if (typeof symbol.key !== 'string' || symbol.key.length === 0 ||
      typeof symbol.name !== 'string' || symbol.name.length === 0 ||
      symbol.kind !== 'motion') {
    addIssue(diagnostics, location, 'asset.motion-symbol',
      'Motion output requires a complete nominal symbol identity.');
    return null;
  }
  const clipId = hashId('clip', symbol.key);
  if (!registerId(seenIds, clipId, symbol.key, location, 'clip', diagnostics)) return null;
  const durationExact = exactValue(motion.duration);
  const fpsExact = exactValue(motion.fps);
  const duration = canonicalNumber(motion.duration, 'second', NUMBER_BOUNDARY,
    location, diagnostics);
  const fps = canonicalNumber(motion.fps, 'plain', INTEGER_BOUNDARY, location, diagnostics);
  if (duration === null || fps === null || duration <= 0 ||
      motion.restRelative?.kind !== 'boolean' || motion.restRelative.type !== 'bool' ||
      motion.restRelative.value !== true) {
    if (duration !== null && duration <= 0) addIssue(diagnostics, location,
      'asset.motion-duration', 'Motion duration must be strictly positive.');
    if (motion.restRelative?.value !== true) addIssue(diagnostics, location,
      'asset.motion-space', 'Canonical rig motion must be rest-relative.');
    return null;
  }
  if (motion.loop !== 'once' && motion.loop !== 'loop' &&
      motion.loop !== 'hold_on_last_frame') {
    addIssue(diagnostics, location, 'asset.motion-loop',
      'Motion loop must be once, loop, or hold_on_last_frame.');
    return null;
  }
  if (durationExact === null || fpsExact === null ||
      durationExact.unit !== 'second' || fpsExact.unit !== 'plain' ||
      durationExact.numerator * fpsExact.numerator >
        BigInt(MAX_MOTION_FRAMES) * durationExact.denominator * fpsExact.denominator) {
    addIssue(diagnostics, location, 'asset.motion-frame-limit',
      `Motion duration at its fps must not exceed ${MAX_MOTION_FRAMES} frames.`);
    return null;
  }
  const channels: TransformChannel[] = [];
  if (!Array.isArray(motion.channels) || motion.channels.length === 0) {
    addIssue(diagnostics, location, 'asset.motion-channels',
      'A motion requires at least one channel.');
    return null;
  }
  const channelIds = new Map<string, TransformChannel>();
  for (const channel of motion.channels) {
    const channelLocation: Location = { path: location.path, span: channel.span };
    const property = channel.property;
    const target = typeof channel.targetBoneId === 'string'
      ? semanticToId.get(channel.targetBoneId) : undefined;
    if (target === undefined) {
      addIssue(diagnostics, channelLocation, 'asset.motion-target-missing',
        `Motion channel targets missing semantic joint "${channel.targetBoneId}".`);
      continue;
    }
    if (property !== 'rotation' && property !== 'scale') {
      addIssue(diagnostics, channelLocation, 'asset.motion-channel',
        'Canonical motion channels may only rotate or scale bones.');
      continue;
    }
    const channelOwner = `${symbol.key}\u0000${channel.targetBoneId}\u0000${property}`;
    const channelId = hashId('channel', channelOwner);
    if (!registerId(seenIds, channelId, channelOwner, channelLocation,
      'channel', diagnostics)) continue;
    if (!Array.isArray(channel.keys) || channel.keys.length === 0) {
      addIssue(diagnostics, channelLocation, 'asset.motion-keys',
        'Every canonical motion channel requires at least one key.');
      continue;
    }
    const keys: TransformKeyframe[] = [];
    let previousExact: AssetExactNumber | null = null;
    let previousTime = -Infinity;
    for (let index = 0; index < channel.keys.length; index += 1) {
      const key = channel.keys[index]!;
      const keyLocation: Location = { path: location.path, span: key.span };
      const timeExact = exactValue(key.time);
      const time = canonicalNumber(key.time, 'second', NUMBER_BOUNDARY,
        keyLocation, diagnostics);
      const value = keyVector(key, property, keyLocation, diagnostics);
      if (timeExact === null || time === null || value === null) continue;
      if (time < 0 || time > duration ||
          exactCompare(timeExact, durationExact) === null ||
          exactCompare(timeExact, durationExact)! > 0) {
        addIssue(diagnostics, keyLocation, 'asset.motion-key-range',
          'Motion key time must lie within the declared duration.');
      }
      if (previousExact !== null && exactCompare(previousExact, timeExact)! >= 0) {
        addIssue(diagnostics, keyLocation, 'asset.motion-key-order',
          'Motion key times must be strictly increasing.');
      }
      if (previousTime !== -Infinity && time <= previousTime) {
        addIssue(diagnostics, keyLocation, 'asset.motion-key-precision',
          'Motion key times cannot collapse at the canonical numeric boundary.');
      }
      previousExact = timeExact;
      previousTime = time;
      const keyOwner = `${channelOwner}\u0000${index}`;
      const keyId = hashId('key', keyOwner);
      if (!registerId(seenIds, keyId, keyOwner, keyLocation, 'key', diagnostics)) continue;
      if (key.interpolation !== 'linear' && key.interpolation !== 'step' &&
          key.interpolation !== 'catmullrom') {
        addIssue(diagnostics, keyLocation, 'asset.motion-interpolation',
          'Motion key interpolation must be linear, step, or catmullrom.');
      }
      keys.push(freeze({ id: keyId, timeSeconds: time, value,
        interpolation: key.interpolation }));
    }
    const output: TransformChannel = freeze({
      id: channelId,
      targetNodeId: target,
      property,
      ...(property === 'rotation' ? { rotationSpace: 'bone' as const } : {}),
      keys: freeze(keys)
    });
    channelIds.set(channelId, output);
  }
  channels.push(...[...channelIds.values()].sort((left, right) =>
    codeUnitOrder(left.id, right.id)));
  if (diagnostics.length !== initialDiagnostics) return null;
  return freeze({ id: clipId, name: symbol.name, durationSeconds: duration,
    fps, loop: motion.loop as AnimationLoopMode,
    channels: deepFreeze(Object.fromEntries(channels.map((channel) =>
      [channel.id, channel]))), triggers: deepFreeze({}) });
};

const compareDiagnostics = (left: AssetDiagnostic, right: AssetDiagnostic): number =>
  codeUnitOrder(left.path, right.path) ||
  left.span.start.offset - right.span.start.offset ||
  left.span.end.offset - right.span.end.offset ||
  codeUnitOrder(left.code, right.code) || codeUnitOrder(left.message, right.message);

/** Lower the canonical skeleton and its already-retargeted rest-relative motions. */
export const lowerAssetRigAndMotions = (
  ir: InstantiatedAssetIr
): CanonicalRigLoweringResult => {
  const diagnostics: AssetDiagnostic[] = [];
  try {
    const plan = lowerBones(ir.bones, diagnostics);
    if (plan === null) return deepFreeze({ ok: false, diagnostics });
    const seenIds = new Map<string, string>();
    const clips: AnimationClip[] = [];
    for (const motion of [...ir.motions].sort((left, right) =>
      codeUnitOrder(left.symbol.key, right.symbol.key))) {
      const clip = lowerMotion(motion, plan.semanticToId, seenIds, diagnostics);
      if (clip !== null) clips.push(clip);
    }
    if (diagnostics.length > 0) return deepFreeze({ ok: false,
      diagnostics: deepFreeze([...diagnostics].sort(compareDiagnostics)) });
    const animations: Record<string, AnimationClip> = Object.create(null) as Record<string, AnimationClip>;
    for (const clip of clips.sort((left, right) => codeUnitOrder(left.id, right.id))) {
      animations[clip.id] = clip;
    }
    return deepFreeze({ ok: true, bones: plan.bones, roots: plan.roots,
      animations: deepFreeze(animations) });
  } catch {
    const first = ir.bones[0];
    if (first !== undefined) addIssue(diagnostics,
      { path: first.sourcePath, span: first.span }, 'asset.canonical-lowering',
      'Canonical rig lowering failed closed.');
    return deepFreeze({ ok: false,
      diagnostics: deepFreeze([...diagnostics].sort(compareDiagnostics)) });
  }
};
