import { freeze } from '../immutable';
import { compareText } from '../stableOrder';
import type { CompiledModel } from './compiled';
import { isExpressionVariantNode } from './expression';
import type { Vec3 } from './identity';
import { primitiveLocalVertices } from './primitives';
import {
  cubeGeometryPivot,
  cubeGeometryRotation,
  cubeUnrotatedBounds,
  type CubeNode,
  type SceneGraph,
  type SceneNode,
} from './scene';
import { canonicalRotatePoint } from './transform';

export interface ModelAabb {
  readonly min: Vec3;
  readonly max: Vec3;
}

export interface ModelCapsuleCollider {
  readonly shape: 'capsule';
  readonly axis: 'y';
  readonly center: Vec3;
  readonly radius: number;
  readonly height: number;
}

export interface ModelBoxCollider {
  readonly shape: 'box';
  readonly center: Vec3;
  readonly size: Vec3;
  readonly min: Vec3;
  readonly max: Vec3;
}

export type ModelCollider = ModelCapsuleCollider | ModelBoxCollider;

export interface ModelColliderSet {
  readonly profile: 'creature' | 'prop' | 'block';
  readonly aabb: ModelAabb;
  readonly colliders: readonly ModelCollider[];
}

const DEFAULT_UNIT_SCALE = 1 / 16;
const roundMetric = (v: number): number => Math.round(v * 10000) / 10000;
const add3 = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub3 = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul3 = (a: Vec3, b: Vec3): Vec3 => [a[0] * b[0], a[1] * b[1], a[2] * b[2]];
const nodeOrigin = (node: SceneNode): Vec3 => add3(node.transform.pivot, node.transform.position);

const isNodeVisible = (
  nodes: Readonly<Record<string, SceneNode>>,
  node: SceneNode,
  seen: Set<string>,
): boolean => {
  if (!node.visible || seen.has(node.id)) return false;
  if (node.parentId === null) return true;
  const parent = nodes[node.parentId];
  if (!parent) return false;
  seen.add(node.id);
  const res = isNodeVisible(nodes, parent, seen);
  seen.delete(node.id);
  return res;
};

const cubeLocalVerts = (node: CubeNode): readonly Vec3[] => {
  const b = cubeUnrotatedBounds(node);
  const p = cubeGeometryPivot(node);
  const rot = cubeGeometryRotation(node);
  const pts: Vec3[] = [];
  for (const x of [b.from[0] - node.inflate, b.to[0] + node.inflate]) {
    for (const y of [b.from[1] - node.inflate, b.to[1] + node.inflate]) {
      for (const z of [b.from[2] - node.inflate, b.to[2] + node.inflate]) {
        const rel = sub3([x, y, z], p);
        pts.push(
          node.geometryMode === 'oriented-box' ? add3(canonicalRotatePoint(rel, rot), p) : rel,
        );
      }
    }
  }
  return pts;
};

const nodeLocalVerts = (node: SceneNode): readonly Vec3[] => {
  if (node.kind === 'cube') return cubeLocalVerts(node);
  if (node.kind === 'plane') {
    const u = node.basis?.uAxis ?? [1, 0, 0];
    const v = node.basis?.vAxis ?? [0, 1, 0];
    const n = node.basis?.normal ?? [0, 0, 1];
    const p = node.transform.pivot;
    const pts: Vec3[] = [];
    for (const x of [0, node.size[0]]) {
      for (const y of [0, node.size[1]]) {
        pts.push([
          u[0] * (x - p[0]) + v[0] * (y - p[1]) - n[0] * p[2],
          u[1] * (x - p[0]) + v[1] * (y - p[1]) - n[1] * p[2],
          u[2] * (x - p[0]) + v[2] * (y - p[1]) - n[2] * p[2],
        ]);
      }
    }
    return pts;
  }
  if (node.kind === 'taper' || node.kind === 'wedge' || node.kind === 'cylinder') {
    return primitiveLocalVertices(node).map((pt) => sub3(pt, node.transform.pivot));
  }
  return [];
};

const nodeWorldAabb = (
  node: SceneNode,
  nodes: Readonly<Record<string, SceneNode>>,
  unitScale: number,
): ModelAabb | null => {
  const verts = nodeLocalVerts(node);
  if (verts.length === 0) return null;
  const chain: SceneNode[] = [];
  for (let cur: SceneNode | undefined = node; cur && chain.length < 128;) {
    chain.push(cur);
    cur = cur.parentId ? nodes[cur.parentId] : undefined;
  }
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const local of verts) {
    let pt = local;
    for (let i = 0; i < chain.length; i += 1) {
      const owner = chain[i]!;
      const parent = chain[i + 1];
      const tr = sub3(nodeOrigin(owner), parent ? nodeOrigin(parent) : [0, 0, 0]);
      pt = add3(
        canonicalRotatePoint(mul3(pt, owner.transform.scale), owner.transform.rotation),
        tr,
      );
    }
    for (let a = 0; a < 3; a += 1) {
      min[a] = Math.min(min[a]!, pt[a]! * unitScale);
      max[a] = Math.max(max[a]!, pt[a]! * unitScale);
    }
  }
  return {
    min: [roundMetric(min[0]), roundMetric(min[1]), roundMetric(min[2])],
    max: [roundMetric(max[0]), roundMetric(max[1]), roundMetric(max[2])],
  };
};

const unionAabbs = (boxes: readonly ModelAabb[]): ModelAabb => {
  if (boxes.length === 0) {
    return freeze({ min: freeze([0, 0, 0] as Vec3), max: freeze([0, 0, 0] as Vec3) });
  }
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const box of boxes) {
    for (let i = 0; i < 3; i += 1) {
      min[i] = Math.min(min[i]!, box.min[i]!);
      max[i] = Math.max(max[i]!, box.max[i]!);
    }
  }
  return freeze({
    min: freeze([roundMetric(min[0]), roundMetric(min[1]), roundMetric(min[2])] as Vec3),
    max: freeze([roundMetric(max[0]), roundMetric(max[1]), roundMetric(max[2])] as Vec3),
  });
};

const aabbsOverlap = (a: ModelAabb, b: ModelAabb, pad = 0.02): boolean =>
  a.min[0] <= b.max[0] + pad &&
  a.max[0] >= b.min[0] - pad &&
  a.min[1] <= b.max[1] + pad &&
  a.max[1] >= b.min[1] - pad &&
  a.min[2] <= b.max[2] + pad &&
  a.max[2] >= b.min[2] - pad;

const boxColliderFromAabb = (box: ModelAabb): ModelBoxCollider => {
  const sx = roundMetric(Math.max(0.01, box.max[0] - box.min[0]));
  const sy = roundMetric(Math.max(0.01, box.max[1] - box.min[1]));
  const sz = roundMetric(Math.max(0.01, box.max[2] - box.min[2]));
  const cx = roundMetric((box.min[0] + box.max[0]) * 0.5);
  const cy = roundMetric((box.min[1] + box.max[1]) * 0.5);
  const cz = roundMetric((box.min[2] + box.max[2]) * 0.5);
  return freeze({
    shape: 'box' as const,
    center: freeze([cx, cy, cz] as Vec3),
    size: freeze([sx, sy, sz] as Vec3),
    min: box.min,
    max: box.max,
  });
};

const mergeTouchingAabbs = (inputs: readonly ModelAabb[]): readonly ModelAabb[] => {
  const work = [...inputs];
  let merged = true;
  while (merged && work.length > 1) {
    merged = false;
    for (let i = 0; i < work.length && !merged; i += 1) {
      for (let j = i + 1; j < work.length; j += 1) {
        if (!aabbsOverlap(work[i]!, work[j]!)) continue;
        work[i] = unionAabbs([work[i]!, work[j]!]);
        work.splice(j, 1);
        merged = true;
        break;
      }
    }
  }
  return work.length <= 8 ? work : [unionAabbs(work)];
};

const buildCapsuleFromAabb = (aabb: ModelAabb): ModelCapsuleCollider => {
  const dx = Math.max(0.01, aabb.max[0] - aabb.min[0]);
  const dy = Math.max(0.01, aabb.max[1] - aabb.min[1]);
  const dz = Math.max(0.01, aabb.max[2] - aabb.min[2]);
  const radius = roundMetric(Math.max(0.01, Math.min(Math.max(dx, dz) * 0.5, dy * 0.5)));
  const height = roundMetric(Math.max(dy, radius * 2));
  const center: Vec3 = [
    roundMetric((aabb.min[0] + aabb.max[0]) * 0.5),
    roundMetric((aabb.min[1] + aabb.max[1]) * 0.5),
    roundMetric((aabb.min[2] + aabb.max[2]) * 0.5),
  ];
  return freeze({
    shape: 'capsule' as const,
    axis: 'y' as const,
    center: freeze(center),
    radius,
    height,
  });
};

const normalizeColliderProfile = (
  profile: CompiledModel['profile'],
): 'creature' | 'prop' | 'block' => {
  if (profile === 'creature') return 'creature';
  if (profile === 'block') return 'block';
  return 'prop';
};

/**
 * Fit deterministic physics colliders to compiled model geometry in meters
 * (`capsule` + root AABB for creatures; tight `box` collider(s) + root AABB for props/blocks).
 */
export const computeModelColliders = (
  model: Readonly<{ scene: SceneGraph; profile?: CompiledModel['profile'] }>,
  unitScale = DEFAULT_UNIT_SCALE,
): ModelColliderSet => {
  const partBoxes: ModelAabb[] = [];
  const ordered = Object.values(model.scene.nodes).sort((a, b) => compareText(a.id, b.id));
  for (const node of ordered) {
    if (node.kind === 'bone' || node.kind === 'locator') continue;
    if (isExpressionVariantNode(node) && node.transform.scale.some((s) => Math.abs(s) <= 1e-6)) {
      continue;
    }
    if (!isNodeVisible(model.scene.nodes, node, new Set())) continue;
    const box = nodeWorldAabb(node, model.scene.nodes, unitScale);
    if (box !== null) partBoxes.push(box);
  }
  const aabb = unionAabbs(partBoxes);
  const profile = normalizeColliderProfile(model.profile);
  const colliders: readonly ModelCollider[] =
    profile === 'creature'
      ? freeze([buildCapsuleFromAabb(aabb)])
      : freeze(mergeTouchingAabbs(partBoxes).map(boxColliderFromAabb));
  return freeze({ profile, aabb, colliders });
};
