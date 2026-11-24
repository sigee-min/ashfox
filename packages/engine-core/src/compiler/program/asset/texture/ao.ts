import type {
  ProgramProperty,
  ProgramTextureChart,
} from '../../../../project/program/syntax/contract';
import { canonicalRotatePoint } from '../../../../model/transform';
import type { Vec3 } from '../../../../model/identity';
import type {
  InstantiatedAssetIr,
  InstantiatedGeometryNode,
  InstantiatedGeometryProperty,
} from '../ir';
import type { BoneTransform, PlaneBasisSpec, SceneObb } from './contract';
import { properties, type TextureExpressionContext } from './expressions';
import {
  boxSurfacePoint,
  sampleBudget,
  type FaceDirection,
  type PaintGrid,
  type TextureRegion,
  type TextureSceneContext,
} from './raster';
import { propertyIssue, type TextureReporter } from './report';

export type { SceneObb } from './contract';
export type { TextureSceneContext } from './raster';

type PatternStatement = Extract<ProgramTextureChart['statements'][number], { kind: 'pattern' }>;

const FACE_NORMALS: Readonly<Record<FaceDirection, Vec3>> = {
  north: [0, 0, -1],
  south: [0, 0, 1],
  west: [-1, 0, 0],
  east: [1, 0, 0],
  up: [0, 1, 0],
  down: [0, -1, 0],
};

const add3 = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub3 = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot3 = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const scale3 = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const cross3 = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

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

const buildCubeObb = (
  node: InstantiatedGeometryNode,
  chartKey: string | null,
  offset: Vec3,
  ancestors: readonly BoneTransform[],
): SceneObb => {
  const origin = add3(vec3Prop(node.properties, 'origin', [0, 0, 0]), offset);
  const position = vec3Prop(node.properties, 'position', [0, 0, 0]);
  const rotation = vec3Prop(node.properties, 'rotation', [0, 0, 0]);
  const pivot = add3(vec3Prop(node.properties, 'pivot', [0, 0, 0]), offset);
  const size = vec3Prop(node.properties, 'size', [1, 1, 1]);
  const inflate = scalarProp(node.properties, 'inflate', 0);
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
  const u = vec3Prop(node.properties, 'u-axis', [1, 0, 0]);
  const v = vec3Prop(node.properties, 'v-axis', [0, 1, 0]);
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
  if (node.kind === 'cube') return buildCubeObb(node, chartKey, offset, ancestors);
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

const texelSurfaceAndNormal = (
  obb: SceneObb,
  region: TextureRegion,
  x: number,
  y: number,
): Readonly<{ readonly point: Vec3; readonly normal: Vec3 }> => {
  if (obb.planeBasis !== undefined) {
    const { u, v, normal } = obb.planeBasis;
    const su = x + 0.5 - obb.pivot[0];
    const sv = region.height - 0.5 - y - obb.pivot[1];
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

const distanceToObb = (point: Vec3, obb: SceneObb, radius: number): number => {
  if (
    point[0] < obb.aabbMin[0] - radius ||
    point[0] > obb.aabbMax[0] + radius ||
    point[1] < obb.aabbMin[1] - radius ||
    point[1] > obb.aabbMax[1] + radius ||
    point[2] < obb.aabbMin[2] - radius ||
    point[2] > obb.aabbMax[2] + radius
  ) {
    return Infinity;
  }
  const d = sub3(point, obb.center);
  const dx = Math.max(0, Math.abs(dot3(d, obb.ax)) - obb.half[0]);
  const dy = Math.max(0, Math.abs(dot3(d, obb.ay)) - obb.half[1]);
  const dz = Math.max(0, Math.abs(dot3(d, obb.az)) - obb.half[2]);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
};

const aoStepAt = (
  surface: Readonly<{ readonly point: Vec3; readonly normal: Vec3 }>,
  owner: SceneObb,
  obbs: readonly SceneObb[],
  radius: number,
  strength: number,
): number => {
  const probeFront = add3(surface.point, scale3(surface.normal, 0.08));
  const probeBack =
    owner.planeBasis !== undefined
      ? add3(surface.point, scale3(surface.normal, -0.08))
      : probeFront;
  let nearest = Infinity;
  for (const other of obbs) {
    if (other.id === owner.id) continue;
    const dist =
      owner.planeBasis !== undefined
        ? Math.min(
            distanceToObb(probeFront, other, radius),
            distanceToObb(probeBack, other, radius),
          )
        : distanceToObb(probeFront, other, radius);
    if (dist < nearest) nearest = dist;
    if (nearest === 0) break;
  }
  if (nearest >= radius) return 0;
  const factor = strength * (1 - nearest / radius);
  if (factor >= 0.55) return 2;
  return factor >= 0.2 ? 1 : 0;
};

const readAoStrength = (
  entry: ProgramProperty | undefined,
  context: TextureExpressionContext,
  report: TextureReporter,
): number | null => {
  if (entry === undefined) return 0.8;
  const val = context.evaluate(entry.value, 'ratio');
  if (val?.kind !== 'number' || val.value.unit !== 'ratio' || val.value.denominator <= 0n) {
    report.report(entry.value.span, 'asset.texture.invalid-ratio', 'AO strength requires a ratio.');
    return null;
  }
  const strength = Number(val.value.numerator) / Number(val.value.denominator);
  if (strength < 0 || strength > 1) {
    report.report(
      entry.value.span,
      'asset.texture.invalid-ratio',
      'AO strength must be between zero and one.',
    );
    return null;
  }
  return strength;
};

const readAoRadius = (
  entry: ProgramProperty | undefined,
  context: TextureExpressionContext,
  report: TextureReporter,
): number | null => {
  if (entry === undefined) return 1.5;
  const val = context.evaluate(entry.value);
  if (val?.kind !== 'number' || (val.value.unit !== 'unit' && val.value.unit !== 'texel')) {
    report.report(
      entry.value.span,
      'asset.texture.invalid-pattern',
      'AO radius requires a unit or texel scalar.',
    );
    return null;
  }
  const num = Number(val.value.numerator) / Number(val.value.denominator);
  if (!Number.isFinite(num) || num <= 0 || num > 16) {
    report.report(
      entry.value.span,
      'asset.texture.invalid-pattern',
      'AO radius must be positive and at most 16.',
    );
    return null;
  }
  return num;
};

const readAoParams = (
  statement: PatternStatement,
  context: TextureExpressionContext,
  report: TextureReporter,
): Readonly<{ readonly strength: number; readonly radius: number }> | null => {
  const entries = properties(
    statement.properties,
    ['strength', 'radius'],
    statement.span,
    report.path,
    propertyIssue(report),
  );
  if (entries === null) return null;
  const strength = readAoStrength(entries.get('strength'), context, report);
  const radius = readAoRadius(entries.get('radius'), context, report);
  return strength === null || radius === null ? null : { strength, radius };
};

const applyAoRegion = (
  grid: PaintGrid,
  region: TextureRegion,
  owner: SceneObb,
  obbs: readonly SceneObb[],
  radius: number,
  strength: number,
): void => {
  for (let y = 0; y < region.height; y += 1) {
    for (let x = 0; x < region.width; x += 1) {
      const surface = texelSurfaceAndNormal(owner, region, x, y);
      const step = aoStepAt(surface, owner, obbs, radius, strength);
      const index = (region.y + y) * grid.width + region.x + x;
      if (step > grid.ao[index]!) grid.ao[index] = step;
    }
  }
};

/** Accumulate pure-CPU 3D Contact AO darkening steps from neighboring scene OBBs. */
export const applyAoPattern = (
  statement: PatternStatement,
  chartKey: string,
  regions: readonly TextureRegion[],
  context: TextureExpressionContext,
  grid: PaintGrid,
  scene: TextureSceneContext | undefined,
  report: TextureReporter,
): boolean => {
  const params = readAoParams(statement, context, report);
  if (params === null) return false;
  if (sampleBudget(regions, 6) === null) {
    report.report(
      statement.span,
      'asset.texture-budget',
      'Contact AO exceeds the bounded work budget.',
    );
    return false;
  }
  const owner = scene?.byChart.get(chartKey)?.[0];
  if (owner === undefined || scene === undefined) return true;
  for (const region of regions)
    applyAoRegion(grid, region, owner, scene.obbs, params.radius, params.strength);
  return true;
};
