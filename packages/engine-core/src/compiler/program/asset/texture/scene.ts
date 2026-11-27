import { add3, cross3, scale3, sub3 } from '../../../../math/vec3';
import { canonicalRotatePoint } from '../../../../model/transform';
import type { Vec3 } from '../../../../model/identity';
import type {
  InstantiatedAssetIr,
  InstantiatedGeometryNode,
  InstantiatedGeometryProperty,
} from '../ir';
import type { BoneTransform, PlaneBasisSpec, SceneObb } from './contract';
import {
  boxSurfacePoint,
  type FaceDirection,
  type TextureRegion,
  type TextureSceneContext,
} from './raster';

const FACE_NORMALS: Readonly<Record<FaceDirection, Vec3>> = {
  north: [0, 0, -1],
  south: [0, 0, 1],
  west: [-1, 0, 0],
  east: [1, 0, 0],
  up: [0, 1, 0],
  down: [0, -1, 0],
};

const numVal = (v: { readonly numerator: bigint; readonly denominator: bigint }): number =>
  Number(v.numerator) / Number(v.denominator);

const vec3Prop = (
  props: readonly InstantiatedGeometryProperty[],
  name: string,
  fallback: Vec3,
): Vec3 => {
  const entry = props.find((p) => p.name === name);
  if (entry === undefined || entry.value.kind !== 'vector' || entry.value.values.length !== 3)
    return fallback;
  const nums = entry.value.values.map((v) => numVal(v.value));
  return nums.every(Number.isFinite) ? [nums[0]!, nums[1]!, nums[2]!] : fallback;
};

const vec2Prop = (
  props: readonly InstantiatedGeometryProperty[],
  name: string,
): readonly [number, number] | null => {
  const entry = props.find((p) => p.name === name);
  if (entry === undefined || entry.value.kind !== 'vector' || entry.value.values.length !== 2)
    return null;
  const a = numVal(entry.value.values[0]!.value);
  const b = numVal(entry.value.values[1]!.value);
  return Number.isFinite(a) && Number.isFinite(b) ? [a, b] : null;
};

const boolProp = (
  props: readonly InstantiatedGeometryProperty[],
  name: string,
  fallback: boolean,
): boolean => {
  const entry = props.find((p) => p.name === name);
  return entry?.value.kind === 'boolean' ? entry.value.value : fallback;
};

const scalarProp = (
  props: readonly InstantiatedGeometryProperty[],
  name: string,
  fallback: number,
): number => {
  const entry = props.find((p) => p.name === name);
  if (entry?.value.kind !== 'number') return fallback;
  const val = numVal(entry.value.value);
  return Number.isFinite(val) ? val : fallback;
};

const chainTransformPoint = (
  localFromPivot: Vec3,
  ownerOrigin: Vec3,
  ownerRotation: Vec3,
  ancestors: readonly BoneTransform[],
): Vec3 => {
  const parent = ancestors[0];
  let point = add3(
    canonicalRotatePoint(localFromPivot, ownerRotation),
    sub3(ownerOrigin, parent ? parent.origin : [0, 0, 0]),
  );
  for (let i = 0; i < ancestors.length; i += 1) {
    const bone = ancestors[i]!;
    const grandParent = ancestors[i + 1];
    point = add3(
      canonicalRotatePoint(point, bone.rotation),
      sub3(bone.origin, grandParent ? grandParent.origin : [0, 0, 0]),
    );
  }
  return point;
};

const chainRotateDir = (
  dir: Vec3,
  ownerRotation: Vec3,
  ancestors: readonly BoneTransform[],
): Vec3 => {
  let vec = canonicalRotatePoint(dir, ownerRotation);
  for (const bone of ancestors) vec = canonicalRotatePoint(vec, bone.rotation);
  return vec;
};

const worldAabbFromBasis = (
  center: Vec3,
  ax: Vec3,
  ay: Vec3,
  az: Vec3,
  half: Vec3,
): Readonly<{ readonly min: Vec3; readonly max: Vec3 }> => {
  const ext = (i: 0 | 1 | 2): number =>
    Math.abs(ax[i]) * half[0] + Math.abs(ay[i]) * half[1] + Math.abs(az[i]) * half[2];
  return {
    min: [center[0] - ext(0), center[1] - ext(1), center[2] - ext(2)],
    max: [center[0] + ext(0), center[1] + ext(1), center[2] + ext(2)],
  };
};

const buildBoxObb = (
  node: InstantiatedGeometryNode,
  chartKey: string | null,
  offset: Vec3,
  ancestors: readonly BoneTransform[],
  origin: Vec3,
  size: Vec3,
  inflate: number,
): SceneObb => {
  const position = vec3Prop(node.properties, 'position', [0, 0, 0]);
  const rotation = vec3Prop(node.properties, 'rotation', [0, 0, 0]);
  const pivot = add3(vec3Prop(node.properties, 'pivot', [0, 0, 0]), offset);
  const ownerOrigin = add3(pivot, position);
  const half: Vec3 = [size[0] / 2 + inflate, size[1] / 2 + inflate, size[2] / 2 + inflate];
  const localCenter = sub3(
    [origin[0] + size[0] / 2, origin[1] + size[1] / 2, origin[2] + size[2] / 2],
    pivot,
  );
  const center = chainTransformPoint(localCenter, ownerOrigin, rotation, ancestors);
  const ax = chainRotateDir([1, 0, 0], rotation, ancestors);
  const ay = chainRotateDir([0, 1, 0], rotation, ancestors);
  const az = chainRotateDir([0, 0, 1], rotation, ancestors);
  const aabb = worldAabbFromBasis(center, ax, ay, az, half);
  return {
    id: node.id,
    chartKey,
    origin,
    size,
    pivot,
    position,
    rotation,
    ownerOrigin,
    ancestors,
    center,
    half,
    ax,
    ay,
    az,
    aabbMin: aabb.min,
    aabbMax: aabb.max,
  };
};

const buildCubeObb = (
  node: InstantiatedGeometryNode,
  chartKey: string | null,
  offset: Vec3,
  ancestors: readonly BoneTransform[],
): SceneObb =>
  buildBoxObb(
    node,
    chartKey,
    offset,
    ancestors,
    add3(vec3Prop(node.properties, 'origin', [0, 0, 0]), offset),
    vec3Prop(node.properties, 'size', [1, 1, 1]),
    scalarProp(node.properties, 'inflate', 0),
  );

const buildCylinderObb = (
  node: InstantiatedGeometryNode,
  chartKey: string | null,
  offset: Vec3,
  ancestors: readonly BoneTransform[],
): SceneObb => {
  const org = add3(vec3Prop(node.properties, 'origin', [0, 0, 0]), offset);
  const r = Math.max(
    scalarProp(node.properties, 'radius', 1),
    scalarProp(node.properties, 'radius_top', 0),
  );
  const h = scalarProp(node.properties, 'height', 1);
  const ax = node.axis ?? 'y';
  const origin: Vec3 =
    ax === 'y'
      ? [org[0] - r, org[1], org[2] - r]
      : ax === 'x'
        ? [org[0], org[1] - r, org[2] - r]
        : [org[0] - r, org[1] - r, org[2]];
  const size: Vec3 =
    ax === 'y' ? [r * 2, h, r * 2] : ax === 'x' ? [h, r * 2, r * 2] : [r * 2, r * 2, h];
  return buildBoxObb(node, chartKey, offset, ancestors, origin, size, 0);
};

const buildPlaneObb = (
  node: InstantiatedGeometryNode,
  chartKey: string | null,
  offset: Vec3,
  ancestors: readonly BoneTransform[],
): SceneObb | null => {
  const size2 = vec2Prop(node.properties, 'size');
  if (size2 === null) return null;
  const rawOrigin = vec3Prop(node.properties, 'origin', [0, 0, 0]);
  const hasPos = node.properties.some((p) => p.name === 'position');
  const position = add3(
    hasPos ? vec3Prop(node.properties, 'position', [0, 0, 0]) : rawOrigin,
    offset,
  );
  const rotation = vec3Prop(node.properties, 'rotation', [0, 0, 0]);
  const pivot = vec3Prop(node.properties, 'pivot', [0, 0, 0]);
  const u = vec3Prop(node.properties, 'u_axis', [1, 0, 0]);
  const v = vec3Prop(node.properties, 'v_axis', [0, 1, 0]);
  const normal = cross3(u, v);
  const basis: PlaneBasisSpec = { u, v, normal };
  const ownerOrigin = add3(pivot, position);
  const half: Vec3 = [size2[0] / 2, size2[1] / 2, 0.02];
  const localCenter = add3(
    add3(scale3(u, half[0] - pivot[0]), scale3(v, half[1] - pivot[1])),
    scale3(normal, -pivot[2]),
  );
  const center = chainTransformPoint(localCenter, ownerOrigin, rotation, ancestors);
  const ax = chainRotateDir(u, rotation, ancestors);
  const ay = chainRotateDir(v, rotation, ancestors);
  const az = chainRotateDir(normal, rotation, ancestors);
  const aabb = worldAabbFromBasis(center, ax, ay, az, half);
  return {
    id: node.id,
    chartKey,
    origin: rawOrigin,
    size: [size2[0], size2[1], 0],
    pivot,
    position,
    rotation,
    ownerOrigin,
    ancestors,
    planeBasis: basis,
    center,
    half,
    ax,
    ay,
    az,
    aabbMin: aabb.min,
    aabbMax: aabb.max,
  };
};

const buildNodeObb = (
  node: InstantiatedGeometryNode,
  offset: Vec3,
  ancestors: readonly BoneTransform[],
): SceneObb | null => {
  const chartKey =
    node.surface === null ? null : `${node.surface.surface.key}\u0000${node.surface.chart}`;
  if (node.kind === 'cube' || node.kind === 'taper' || node.kind === 'wedge') {
    return buildCubeObb(node, chartKey, offset, ancestors);
  }
  if (node.kind === 'cylinder') return buildCylinderObb(node, chartKey, offset, ancestors);
  if (node.kind === 'plane') return buildPlaneObb(node, chartKey, offset, ancestors);
  return null;
};

const boneTransformOf = (node: InstantiatedGeometryNode, offset: Vec3): BoneTransform => {
  const pivot = add3(vec3Prop(node.properties, 'pivot', [0, 0, 0]), offset);
  const position = vec3Prop(node.properties, 'position', [0, 0, 0]);
  const rotation = vec3Prop(node.properties, 'rotation', [0, 0, 0]);
  return { origin: add3(pivot, position), rotation };
};

const collectObbs = (
  nodes: readonly InstantiatedGeometryNode[],
  offset: Vec3,
  ancestors: readonly BoneTransform[],
  out: SceneObb[],
): void => {
  for (const node of nodes) {
    if (!boolProp(node.properties, 'visible', true)) continue;
    if (node.kind === 'bone') {
      collectObbs(node.children, offset, [boneTransformOf(node, offset), ...ancestors], out);
      continue;
    }
    const obb = buildNodeObb(node, offset, ancestors);
    if (obb !== null) out.push(obb);
    if (node.children.length > 0) collectObbs(node.children, offset, ancestors, out);
  }
};

/** Compute world-space surface point and outward normal for a texel in a scene OBB. */
export const texelSurfaceAndNormal = (
  obb: SceneObb,
  region: TextureRegion,
  x: number,
  y: number,
): Readonly<{ readonly point: Vec3; readonly normal: Vec3 }> => {
  if (obb.planeBasis !== undefined) {
    const { u, v, normal } = obb.planeBasis;
    const s = region.density ?? 1;
    const su = (x + 0.5) / s - obb.pivot[0];
    const sv = (region.height - 0.5 - y) / s - obb.pivot[1];
    const localFromPivot = add3(add3(scale3(u, su), scale3(v, sv)), scale3(normal, -obb.pivot[2]));
    return {
      point: chainTransformPoint(localFromPivot, obb.ownerOrigin, obb.rotation, obb.ancestors),
      normal: chainRotateDir(normal, obb.rotation, obb.ancestors),
    };
  }
  const p = boxSurfacePoint(region, x, y);
  const localFromPivot = sub3(add3(obb.origin, p), obb.pivot);
  const dir = region.direction ?? 'north';
  return {
    point: chainTransformPoint(localFromPivot, obb.ownerOrigin, obb.rotation, obb.ancestors),
    normal: chainRotateDir(FACE_NORMALS[dir], obb.rotation, obb.ancestors),
  };
};

const computeBounds = (
  obbs: readonly SceneObb[],
): Readonly<{ readonly min: Vec3; readonly max: Vec3 }> => {
  if (obbs.length === 0) return { min: [0, 0, 0], max: [1, 1, 1] };
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const obb of obbs) {
    for (let i = 0; i < 3; i += 1) {
      min[i] = Math.min(min[i]!, obb.aabbMin[i]!);
      max[i] = Math.max(max[i]!, obb.aabbMax[i]!);
    }
  }
  return { min, max };
};

/** Build a pure-CPU 3D OBB scene index from instantiated IR for Contact AO and model gradients. */
export const buildTextureSceneContext = (ir: InstantiatedAssetIr): TextureSceneContext => {
  const obbs: SceneObb[] = [];
  for (const instance of ir.instances) {
    const o = instance.placement.origin;
    const offset: Vec3 =
      instance.placementAuthority === 'socket'
        ? [numVal(o[0]), numVal(o[1]), numVal(o[2])]
        : [0, 0, 0];
    collectObbs(instance.geometry, offset, [], obbs);
  }
  const byChart = new Map<string, SceneObb[]>();
  for (const obb of obbs) {
    if (obb.chartKey === null) continue;
    const list = byChart.get(obb.chartKey);
    if (list) list.push(obb);
    else byChart.set(obb.chartKey, [obb]);
  }
  const bounds = computeBounds(obbs);
  const worldPointFor = (chartKey: string, region: TextureRegion, x: number, y: number): Vec3 => {
    const obb = byChart.get(chartKey)?.[0];
    if (obb === undefined) return boxSurfacePoint(region, x, y);
    return texelSurfaceAndNormal(obb, region, x, y).point;
  };
  return { obbs, byChart, boundsMin: bounds.min, boundsMax: bounds.max, worldPointFor };
};
