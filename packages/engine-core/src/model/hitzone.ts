import { freeze } from '../immutable';
import type { Vec3 } from './identity';
import type { SceneNode } from './scene';

export type HitZoneShape = 'box' | 'capsule' | 'sphere';

export type DamageStateKind = 'intact' | 'damaged' | 'destroyed';

export interface CompiledHitZone {
  readonly id: string;
  readonly bone: string;
  readonly shape: HitZoneShape;
  readonly multiplier: number;
  readonly tag: string;
}

export interface ModelDamageStateMeta {
  readonly state: DamageStateKind;
  readonly baseId?: string;
  readonly breakVfx?: string;
  readonly breakSound?: string;
  readonly variants?: Readonly<Record<string, string>>;
}

export interface ModelHitZone {
  readonly id: string;
  readonly bone: string;
  readonly shape: HitZoneShape;
  readonly multiplier: number;
  readonly tag: string;
  readonly center: Vec3;
  readonly localCenter: Vec3;
  readonly size?: Vec3;
  readonly min?: Vec3;
  readonly max?: Vec3;
  readonly radius?: number;
  readonly height?: number;
}

export interface HitZoneAabb {
  readonly min: Vec3;
  readonly max: Vec3;
}

const roundMetric = (v: number): number => Math.round(v * 10000) / 10000;

const nodeOrigin = (node: SceneNode): Vec3 => [
  node.transform.pivot[0] + node.transform.position[0],
  node.transform.pivot[1] + node.transform.position[1],
  node.transform.pivot[2] + node.transform.position[2],
];

const nearestBoneId = (
  node: SceneNode,
  nodes: Readonly<Record<string, SceneNode>>,
): string | null => {
  for (let cur = node.parentId ? nodes[node.parentId] : undefined; cur;) {
    if (cur.kind === 'bone') return cur.id;
    cur = cur.parentId ? nodes[cur.parentId] : undefined;
  }
  return null;
};

const hasBoneAncestor = (
  node: SceneNode,
  boneId: string,
  nodes: Readonly<Record<string, SceneNode>>,
): boolean => {
  for (
    let cur = node.parentId ? nodes[node.parentId] : undefined, steps = 0;
    cur && steps < 128;
    steps += 1
  ) {
    if (cur.id === boneId) return true;
    cur = cur.parentId ? nodes[cur.parentId] : undefined;
  }
  return false;
};

const boneWorldOrigin = (bone: SceneNode | undefined, unitScale: number): Vec3 => {
  if (!bone) return [0, 0, 0];
  const o = nodeOrigin(bone);
  return [
    roundMetric(o[0] * unitScale),
    roundMetric(o[1] * unitScale),
    roundMetric(o[2] * unitScale),
  ];
};

const unionBoxes = (boxes: readonly HitZoneAabb[], fallbackCenter: Vec3): HitZoneAabb => {
  if (boxes.length === 0) {
    const pad = 0.1;
    return {
      min: [
        roundMetric(fallbackCenter[0] - pad),
        roundMetric(fallbackCenter[1] - pad),
        roundMetric(fallbackCenter[2] - pad),
      ],
      max: [
        roundMetric(fallbackCenter[0] + pad),
        roundMetric(fallbackCenter[1] + pad),
        roundMetric(fallbackCenter[2] + pad),
      ],
    };
  }
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const box of boxes) {
    for (let i = 0; i < 3; i += 1) {
      min[i] = Math.min(min[i]!, box.min[i]!);
      max[i] = Math.max(max[i]!, box.max[i]!);
    }
  }
  return {
    min: [roundMetric(min[0]), roundMetric(min[1]), roundMetric(min[2])],
    max: [roundMetric(max[0]), roundMetric(max[1]), roundMetric(max[2])],
  };
};

const buildHitZoneGeometry = (
  hz: CompiledHitZone,
  bounds: HitZoneAabb,
  bonePos: Vec3,
): ModelHitZone => {
  const dx = Math.max(0.01, bounds.max[0] - bounds.min[0]);
  const dy = Math.max(0.01, bounds.max[1] - bounds.min[1]);
  const dz = Math.max(0.01, bounds.max[2] - bounds.min[2]);
  const center: Vec3 = freeze([
    roundMetric((bounds.min[0] + bounds.max[0]) * 0.5),
    roundMetric((bounds.min[1] + bounds.max[1]) * 0.5),
    roundMetric((bounds.min[2] + bounds.max[2]) * 0.5),
  ]);
  const localCenter: Vec3 = freeze([
    roundMetric(center[0] - bonePos[0]),
    roundMetric(center[1] - bonePos[1]),
    roundMetric(center[2] - bonePos[2]),
  ]);
  if (hz.shape === 'sphere') {
    const radius = roundMetric(Math.max(0.01, Math.max(dx, dy, dz) * 0.5));
    return freeze({ ...hz, center, localCenter, radius });
  }
  if (hz.shape === 'capsule') {
    const radius = roundMetric(Math.max(0.01, Math.min(Math.max(dx, dz) * 0.5, dy * 0.5)));
    const height = roundMetric(Math.max(dy, radius * 2));
    return freeze({ ...hz, center, localCenter, radius, height });
  }
  return freeze({
    ...hz,
    center,
    localCenter,
    size: freeze([roundMetric(dx), roundMetric(dy), roundMetric(dz)] as Vec3),
    min: freeze(bounds.min),
    max: freeze(bounds.max),
  });
};

export interface VisiblePartBox {
  readonly node: SceneNode;
  readonly box: HitZoneAabb;
}

/** Evaluate bone-bound hitzone shapes in world and bone-local meter coordinates. */
export const evaluateModelHitZones = (
  hitzones: readonly CompiledHitZone[] | undefined,
  nodes: Readonly<Record<string, SceneNode>>,
  partBoxes: readonly VisiblePartBox[],
  unitScale: number,
): readonly ModelHitZone[] => {
  if (!hitzones || hitzones.length === 0) return [];
  return freeze(
    hitzones.map((hz) => {
      const direct = partBoxes
        .filter((p) => nearestBoneId(p.node, nodes) === hz.bone)
        .map((p) => p.box);
      const boxes =
        direct.length > 0
          ? direct
          : partBoxes.filter((p) => hasBoneAncestor(p.node, hz.bone, nodes)).map((p) => p.box);
      const bonePos = boneWorldOrigin(nodes[hz.bone], unitScale);
      return buildHitZoneGeometry(hz, unionBoxes(boxes, bonePos), bonePos);
    }),
  );
};
