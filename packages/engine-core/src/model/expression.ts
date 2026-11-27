import { freeze } from '../immutable';
import type { UvRect, Vec2, Vec3 } from './identity';
import type { TransformChannel, TransformKeyframe } from './motion';
import type { PlaneNode, SceneNode } from './scene';

export const EXPRESSION_PLANE_OFFSET = 0.02;
export const EXPRESSION_VARIANT_TAG = 'expression-variant';
export const EXPRESSION_SLOT_TAG_PREFIX = 'expression-slot:';
export const EXPRESSION_KEY_TAG_PREFIX = 'expression:';

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

const buildVariantPlaneNode = (
  spec: ExpressionSlotPlaneSpec,
  item: ExpressionVariantInput,
  pos: Vec3,
  uAxis: Vec3,
  vAxis: Vec3,
  normal: Vec3,
  defaultVariant: string,
): PlaneNode => {
  const active = item.variant === defaultVariant;
  const id = `${spec.slotId}/${item.variant}`;
  return freeze({
    id,
    kind: 'plane' as const,
    name: id,
    parentId: spec.parentId,
    transform: freeze({
      position: freeze([...pos] as Vec3),
      rotation: freeze([...spec.rotation] as Vec3),
      scale: freeze((active ? [1, 1, 1] : [0, 0, 0]) as Vec3),
      pivot: freeze([...spec.pivot] as Vec3),
    }),
    visible: spec.visible,
    tags: freeze([
      EXPRESSION_VARIANT_TAG,
      `${EXPRESSION_SLOT_TAG_PREFIX}${spec.slotId}`,
      `${EXPRESSION_KEY_TAG_PREFIX}${item.variant}`,
    ]),
    size: freeze([...spec.size] as Vec2),
    basis: freeze({ normal, uAxis, vAxis, orientation: 'normal' as const }),
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
  const uAxis = normalizeVec3(spec.uAxis);
  const vAxis = normalizeVec3(spec.vAxis);
  const normal = normalizeVec3(crossVec3(uAxis, vAxis));
  const defaultVariant = variants.some((v) => v.variant === 'neutral')
    ? 'neutral'
    : variants[0]!.variant;
  const pos: Vec3 = [
    spec.origin[0] + spec.position[0] + normal[0] * EXPRESSION_PLANE_OFFSET,
    spec.origin[1] + spec.position[1] + normal[1] * EXPRESSION_PLANE_OFFSET,
    spec.origin[2] + spec.position[2] + normal[2] * EXPRESSION_PLANE_OFFSET,
  ];
  return freeze(
    variants.map((item) =>
      buildVariantPlaneNode(spec, item, pos, uAxis, vAxis, normal, defaultVariant),
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
