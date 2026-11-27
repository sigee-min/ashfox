import { freeze } from '../immutable';
import type { UvRect, Vec2, Vec3 } from './identity';
import type { TransformChannel, TransformKeyframe } from './motion';
import type { PlaneNode, SceneNode } from './scene';

export type ExpressionPlacement = 'front' | 'lateral_pair' | 'corner_wrap';

export const EXPRESSION_PLANE_OFFSET = 0.02;
export const EXPRESSION_VARIANT_TAG = 'expression-variant';
export const EXPRESSION_SLOT_TAG_PREFIX = 'expression-slot:';
export const EXPRESSION_KEY_TAG_PREFIX = 'expression:';
export const EXPRESSION_PLACEMENT_TAG_PREFIX = 'expression-placement:';

export interface ExpressionVariantInput {
  readonly variant: string;
  readonly textureId: string;
  readonly uv: UvRect;
  readonly rotation?: 0 | 90 | 180 | 270;
  readonly coverageId: string;
}

export interface ExpressionSlotPlaneSpec {
  readonly slotId: string;
  readonly parentId: string | null;
  readonly origin: Vec3;
  readonly size: Vec2;
  readonly uAxis: Vec3;
  readonly vAxis: Vec3;
  readonly position: Vec3;
  readonly rotation: Vec3;
  readonly pivot: Vec3;
  readonly visible: boolean;
  readonly placement?: ExpressionPlacement;
  readonly forward?: 'north' | 'south' | 'east' | 'west';
  readonly parentBounds?: Readonly<{ readonly min: Vec3; readonly max: Vec3 }>;
  readonly hasOrigin?: boolean;
  readonly hasUAxis?: boolean;
}

export interface ExpressionMotionEntry {
  readonly startTime: number;
  readonly endTime: number | null;
  readonly variant: string;
}

export interface ExpressionMotionSlotSpec {
  readonly slot: string;
  readonly entries: readonly ExpressionMotionEntry[];
}

const normalizeVec3 = (v: Vec3): Vec3 => {
  const len = Math.hypot(v[0], v[1], v[2]);
  return len > 1e-8 ? [v[0] / len, v[1] / len, v[2] / len] : [0, 0, 1];
};

const crossVec3 = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

/** True when a scene node was lowered from an `expression_slot` variant. */
export const isExpressionVariantNode = (node: SceneNode): boolean =>
  node.tags?.includes(EXPRESSION_VARIANT_TAG) ?? false;

/** Extract the declared slot identifier tag from an expression variant plane node. */
export const expressionSlotName = (node: SceneNode): string | null => {
  const tag = node.tags?.find((entry) => entry.startsWith(EXPRESSION_SLOT_TAG_PREFIX));
  return tag === undefined ? null : tag.slice(EXPRESSION_SLOT_TAG_PREFIX.length);
};

/** Extract the expression variant identifier tag from an expression variant plane node. */
export const expressionVariantName = (node: SceneNode): string | null => {
  const tag = node.tags?.find((entry) => entry.startsWith(EXPRESSION_KEY_TAG_PREFIX));
  return tag === undefined ? null : tag.slice(EXPRESSION_KEY_TAG_PREFIX.length);
};

/** Extract the placement mode tag (`front | lateral_pair | corner_wrap`) from an expression node. */
export const expressionSlotPlacement = (node: SceneNode): ExpressionPlacement => {
  const tag = node.tags?.find((entry) => entry.startsWith(EXPRESSION_PLACEMENT_TAG_PREFIX));
  const val = tag?.slice(EXPRESSION_PLACEMENT_TAG_PREFIX.length);
  return val === 'lateral_pair' || val === 'corner_wrap' ? val : 'front';
};

interface PlacementFrame {
  readonly suffix: '' | '/left' | '/right';
  readonly pos: Vec3;
  readonly uAxis?: Vec3;
  readonly vAxis?: Vec3;
  readonly normal?: Vec3;
  readonly rotationYawDeg?: number;
  readonly placementTag?: ExpressionPlacement;
}

const dot3 = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

const forwardBasis = (
  forward: 'north' | 'south' | 'east' | 'west' = 'north',
): { readonly fwd: Vec3; readonly right: Vec3 } => {
  if (forward === 'south') return { fwd: [0, 0, 1], right: [-1, 0, 0] };
  if (forward === 'east') return { fwd: [1, 0, 0], right: [0, 0, 1] };
  if (forward === 'west') return { fwd: [-1, 0, 0], right: [0, 0, -1] };
  return { fwd: [0, 0, -1], right: [1, 0, 0] };
};

const cleanZero = (value: number): number => (Math.abs(value) < 1e-12 ? 0 : value);

const cleanVec3 = (v: Vec3): Vec3 => [cleanZero(v[0]), cleanZero(v[1]), cleanZero(v[2])];

const horizontalUAxis = (normal: Vec3): Vec3 =>
  cleanVec3(normalizeVec3([normal[2], 0, -normal[0]]));

const combinePlanePos = (anchor: Vec3, position: Vec3, normal: Vec3): Vec3 => [
  anchor[0] + position[0] + normal[0] * EXPRESSION_PLANE_OFFSET,
  anchor[1] + position[1] + normal[1] * EXPRESSION_PLANE_OFFSET,
  anchor[2] + position[2] + normal[2] * EXPRESSION_PLANE_OFFSET,
];

const resolveAnchorMetrics = (spec: ExpressionSlotPlaneSpec, fwd: Vec3, right: Vec3) => {
  const pb = spec.parentBounds;
  const centerR = pb
    ? (pb.min[0] + pb.max[0]) * 0.5 * right[0] + (pb.min[2] + pb.max[2]) * 0.5 * right[2]
    : 0;
  const halfR = pb
    ? 0.5 *
      (Math.abs(pb.max[0] - pb.min[0]) * Math.abs(right[0]) +
        Math.abs(pb.max[2] - pb.min[2]) * Math.abs(right[2]))
    : 0;
  const rawOff = spec.hasOrigin ? Math.abs(dot3(spec.origin, right) - centerR) : halfR;
  const offsetR = spec.hasOrigin && rawOff < 1e-4 && pb ? halfR : rawOff;
  const y = spec.hasOrigin
    ? spec.origin[1]
    : pb
      ? pb.min[1] + (pb.max[1] - pb.min[1]) * 0.5 - spec.size[1] * 0.5
      : 0;
  const d0 = pb ? pb.min[0] * fwd[0] + pb.min[2] * fwd[2] : 0;
  const d1 = pb ? pb.max[0] * fwd[0] + pb.max[2] * fwd[2] : 0;
  return { centerR, offsetR, y, fwdMin: Math.min(d0, d1), fwdMax: Math.max(d0, d1) };
};

const composeXzPoint = (
  right: Vec3,
  rCoord: number,
  fwd: Vec3,
  fCoord: number,
  y: number,
): Vec3 => [right[0] * rCoord + fwd[0] * fCoord, y, right[2] * rCoord + fwd[2] * fCoord];

const buildLateralPairFrames = (spec: ExpressionSlotPlaneSpec): readonly PlacementFrame[] => {
  const { fwd, right } = forwardBasis(spec.forward);
  const { centerR, offsetR, y, fwdMin, fwdMax } = resolveAnchorMetrics(spec, fwd, right);
  const w = spec.size[0];
  let leftFwd = 0;
  if (spec.hasOrigin) {
    const baseFwd = dot3(spec.origin, fwd);
    leftFwd = spec.hasUAxis && dot3(spec.uAxis, fwd) > 0 ? baseFwd + w : baseFwd;
  } else if (spec.parentBounds) {
    const depth = fwdMax - fwdMin;
    const mid =
      w >= depth
        ? (fwdMin + fwdMax) * 0.5
        : Math.max(
            fwdMin + w * 0.5,
            Math.min(fwdMax - w * 0.5, fwdMax - Math.max(w * 0.5, depth * 0.42)),
          );
    leftFwd = mid + w * 0.5;
  }
  const rightFwd = leftFwd - w;
  const vAxis: Vec3 = [0, 1, 0];
  const leftN = cleanVec3([-right[0], 0, -right[2]]);
  const rightN = cleanVec3(right);
  return [
    {
      suffix: '/left',
      pos: combinePlanePos(
        composeXzPoint(right, centerR - offsetR, fwd, leftFwd, y),
        spec.position,
        leftN,
      ),
      uAxis: horizontalUAxis(leftN),
      vAxis,
      normal: leftN,
      placementTag: 'lateral_pair',
    },
    {
      suffix: '/right',
      pos: combinePlanePos(
        composeXzPoint(right, centerR + offsetR, fwd, rightFwd, y),
        spec.position,
        rightN,
      ),
      uAxis: horizontalUAxis(rightN),
      vAxis,
      normal: rightN,
      placementTag: 'lateral_pair',
    },
  ];
};

const cornerYawDegrees = (normal: Vec3): number =>
  cleanZero((Math.atan2(normal[0], normal[2]) * 180) / Math.PI);

const buildCornerWrapFrames = (spec: ExpressionSlotPlaneSpec): readonly PlacementFrame[] => {
  const { fwd, right } = forwardBasis(spec.forward);
  const { centerR, offsetR, y, fwdMax } = resolveAnchorMetrics(spec, fwd, right);
  const halfW = spec.size[0] * 0.5;
  const fwdFront = spec.parentBounds ? fwdMax : spec.hasOrigin ? dot3(spec.origin, fwd) : 0;
  const leftN = normalizeVec3([fwd[0] - right[0], 0, fwd[2] - right[2]]);
  const rightN = normalizeVec3([fwd[0] + right[0], 0, fwd[2] + right[2]]);
  const leftU = horizontalUAxis(leftN);
  const rightU = horizontalUAxis(rightN);
  const leftCorner = composeXzPoint(right, centerR - offsetR, fwd, fwdFront, y);
  const rightCorner = composeXzPoint(right, centerR + offsetR, fwd, fwdFront, y);
  return [
    {
      suffix: '/left',
      pos: combinePlanePos(
        [leftCorner[0] - leftU[0] * halfW, y, leftCorner[2] - leftU[2] * halfW],
        spec.position,
        leftN,
      ),
      rotationYawDeg: cornerYawDegrees(leftN),
      placementTag: 'corner_wrap',
    },
    {
      suffix: '/right',
      pos: combinePlanePos(
        [rightCorner[0] - rightU[0] * halfW, y, rightCorner[2] - rightU[2] * halfW],
        spec.position,
        rightN,
      ),
      rotationYawDeg: cornerYawDegrees(rightN),
      placementTag: 'corner_wrap',
    },
  ];
};

const buildVariantPlaneNode = (
  spec: ExpressionSlotPlaneSpec,
  item: ExpressionVariantInput,
  frame: PlacementFrame,
  defaultVariant: string,
): PlaneNode => {
  const active = item.variant === defaultVariant;
  const id = `${spec.slotId}/${item.variant}${frame.suffix}`;
  const tags = [
    EXPRESSION_VARIANT_TAG,
    `${EXPRESSION_SLOT_TAG_PREFIX}${spec.slotId}`,
    `${EXPRESSION_KEY_TAG_PREFIX}${item.variant}`,
    ...(frame.placementTag ? [`${EXPRESSION_PLACEMENT_TAG_PREFIX}${frame.placementTag}`] : []),
  ];
  const rotY = cleanZero(spec.rotation[1] + (frame.rotationYawDeg ?? 0));
  const basis =
    frame.normal && frame.uAxis && frame.vAxis
      ? freeze({
          normal: frame.normal,
          uAxis: frame.uAxis,
          vAxis: frame.vAxis,
          orientation: 'normal' as const,
        })
      : undefined;
  return freeze({
    id,
    kind: 'plane' as const,
    name: id,
    parentId: spec.parentId,
    transform: freeze({
      position: freeze([...frame.pos] as Vec3),
      rotation: freeze([spec.rotation[0], rotY, spec.rotation[2]] as Vec3),
      scale: freeze((active ? [1, 1, 1] : [0, 0, 0]) as Vec3),
      pivot: freeze([...spec.pivot] as Vec3),
    }),
    visible: spec.visible,
    tags: freeze(tags),
    size: freeze([...spec.size] as Vec2),
    ...(basis !== undefined ? { basis } : {}),
    sidedness: 'front' as const,
    coverageId: item.coverageId,
    faces: freeze({
      front: freeze({
        enabled: true,
        textureId: item.textureId,
        uv: item.uv,
        rotation: item.rotation ?? 0,
      }),
      back: freeze({ enabled: false, textureId: null }),
    }),
  });
};

/** Lower an expression slot and its variants into atlas-sharing 0.02u-offset PlaneNodes. */
export const buildExpressionVariantPlanes = (
  spec: ExpressionSlotPlaneSpec,
  variants: readonly ExpressionVariantInput[],
): readonly PlaneNode[] => {
  if (variants.length === 0) return [];
  const defaultVariant = variants.some((v) => v.variant === 'neutral')
    ? 'neutral'
    : variants[0]!.variant;
  let frames: readonly PlacementFrame[];
  if (spec.placement === 'lateral_pair') frames = buildLateralPairFrames(spec);
  else if (spec.placement === 'corner_wrap') frames = buildCornerWrapFrames(spec);
  else {
    const uAxis = normalizeVec3(spec.uAxis);
    const vAxis = normalizeVec3(spec.vAxis);
    const normal = normalizeVec3(crossVec3(uAxis, vAxis));
    frames = [
      {
        suffix: '',
        pos: combinePlanePos(spec.origin, spec.position, normal),
        uAxis,
        vAxis,
        normal,
      },
    ];
  }
  return freeze(
    variants.flatMap((item) =>
      frames.map((frame) => buildVariantPlaneNode(spec, item, frame, defaultVariant)),
    ),
  );
};

const activeVariantAt = (
  entries: readonly ExpressionMotionEntry[],
  fallback: string,
  t: number,
): string => {
  let pointVariant = fallback;
  let windowVariant: string | null = null;
  for (const entry of entries) {
    if (entry.endTime === null && entry.startTime <= t + 1e-9) {
      pointVariant = entry.variant;
    } else if (entry.endTime !== null && entry.startTime <= t + 1e-9 && t < entry.endTime - 1e-9) {
      windowVariant = entry.variant;
    }
  }
  return windowVariant ?? pointVariant;
};

const matchesExpressionSlot = (node: SceneNode, slot: string): boolean => {
  const slotId = expressionSlotName(node);
  return slotId !== null && (slotId === slot || slotId.endsWith(`/${slot}`));
};

const collectSlotTimes = (entries: readonly ExpressionMotionEntry[]): number[] => {
  const raw = [
    0,
    ...entries.flatMap((e) => (e.endTime === null ? [e.startTime] : [e.startTime, e.endTime])),
  ];
  return [...new Set(raw)].sort((a, b) => a - b);
};

const makeStepScaleKey = (
  chId: string,
  index: number,
  timeSeconds: number,
  on: boolean,
): TransformKeyframe =>
  freeze({
    id: `${chId}:k${index}`,
    timeSeconds,
    value: freeze((on ? [1, 1, 1] : [0, 0, 0]) as [number, number, number]),
    interpolation: 'step' as const,
  });

const buildVariantScaleChannel = (
  chId: string,
  targetNodeId: string,
  variant: string,
  sorted: readonly ExpressionMotionEntry[],
  times: readonly number[],
  fallback: string,
  durationSeconds?: number,
): TransformChannel => {
  const keys: TransformKeyframe[] = [];
  let prevOn: boolean | null = null;
  for (const t of times) {
    const isOn = activeVariantAt(sorted, fallback, t) === variant;
    if (prevOn === null || isOn !== prevOn) {
      keys.push(makeStepScaleKey(chId, keys.length, t, isOn));
      prevOn = isOn;
    }
  }
  if (durationSeconds !== undefined && durationSeconds > 1e-6) {
    const lastKey = keys.at(-1);
    if (lastKey === undefined || lastKey.timeSeconds < durationSeconds - 1e-6) {
      const endOn = activeVariantAt(sorted, fallback, durationSeconds) === variant;
      keys.push(makeStepScaleKey(chId, keys.length, durationSeconds, endOn));
    }
  }
  return freeze({ id: chId, targetNodeId, property: 'scale' as const, keys: freeze(keys) });
};

/** Lower declarative `expression <slot>` motion schedules into glTF STEP scale channels. */
export const compileExpressionChannels = (
  specs: readonly ExpressionMotionSlotSpec[],
  nodes: Readonly<Record<string, SceneNode>>,
  durationSeconds?: number,
  clipId = '',
  defaultVariantFallback = 'neutral',
): Record<string, TransformChannel> => {
  const channels: Record<string, TransformChannel> = Object.create(null);
  const allNodes = Object.values(nodes).filter(isExpressionVariantNode);
  const prefix = clipId ? `expression:${clipId}` : 'expression';
  for (const spec of specs) {
    const slotNodes = allNodes.filter((n) => matchesExpressionSlot(n, spec.slot));
    if (slotNodes.length === 0 || spec.entries.length === 0) continue;
    const sorted = [...spec.entries].sort((a, b) => a.startTime - b.startTime);
    const fallback = slotNodes.some((n) => expressionVariantName(n) === defaultVariantFallback)
      ? defaultVariantFallback
      : (expressionVariantName(slotNodes[0]!) ?? sorted[0]!.variant);
    const times = collectSlotTimes(sorted);
    for (const node of slotNodes) {
      const variant = expressionVariantName(node);
      if (variant === null) continue;
      const chId = `${prefix}:${node.id}:scale`;
      channels[chId] = buildVariantScaleChannel(
        chId,
        node.id,
        variant,
        sorted,
        times,
        fallback,
        durationSeconds,
      );
    }
  }
  return channels;
};
