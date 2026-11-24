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
import type { SceneObb } from './contract';
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

const toNumber = (value: InstantiatedGeometryProperty['value']): number | null =>
  value.kind === 'number' ? Number(value.value.numerator) / Number(value.value.denominator) : null;

const vec3Prop = (
  props: readonly InstantiatedGeometryProperty[],
  name: string,
  fallback: Vec3,
): Vec3 => {
  const entry = props.find((p) => p.name === name);
  if (entry === undefined || entry.value.kind !== 'vector' || entry.value.values.length !== 3) {
    return fallback;
  }
  const nums = entry.value.values.map(
    (v) => Number(v.value.numerator) / Number(v.value.denominator),
  );
  return nums.every(Number.isFinite) ? [nums[0]!, nums[1]!, nums[2]!] : fallback;
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
  const val = entry === undefined ? null : toNumber(entry.value);
  return val !== null && Number.isFinite(val) ? val : fallback;
};

const add3 = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub3 = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot3 = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

const transformLocalPoint = (
  local: Vec3,
  pivot: Vec3,
  rotation: Vec3,
  position: Vec3,
  placement: Vec3,
): Vec3 => {
  const rotated = canonicalRotatePoint(sub3(local, pivot), rotation);
  return add3(add3(rotated, pivot), add3(position, placement));
};

const makeObb = (
  id: string,
  chartKey: string | null,
  origin: Vec3,
  size: Vec3,
  inflate: number,
  pivot: Vec3,
  position: Vec3,
  rotation: Vec3,
  placementOffset: Vec3,
): SceneObb => {
  const half: Vec3 = [size[0] / 2 + inflate, size[1] / 2 + inflate, size[2] / 2 + inflate];
  const localCenter: Vec3 = [
    origin[0] + size[0] / 2,
    origin[1] + size[1] / 2,
    origin[2] + size[2] / 2,
  ];
  const center = transformLocalPoint(localCenter, pivot, rotation, position, placementOffset);
  const ax = canonicalRotatePoint([1, 0, 0], rotation);
  const ay = canonicalRotatePoint([0, 1, 0], rotation);
  const az = canonicalRotatePoint([0, 0, 1], rotation);
  const ext = (i: 0 | 1 | 2): number =>
    Math.abs(ax[i]) * half[0] + Math.abs(ay[i]) * half[1] + Math.abs(az[i]) * half[2];
  const aabbMin: Vec3 = [center[0] - ext(0), center[1] - ext(1), center[2] - ext(2)];
  const aabbMax: Vec3 = [center[0] + ext(0), center[1] + ext(1), center[2] + ext(2)];
  return {
    id,
    chartKey,
    origin,
    size,
    pivot,
    position,
    rotation,
    placementOffset,
    center,
    half,
    ax,
    ay,
    az,
    aabbMin,
    aabbMax,
  };
};

const obbFromNode = (node: InstantiatedGeometryNode, placement: Vec3): SceneObb | null => {
  if (!boolProp(node.properties, 'visible', true)) return null;
  const origin = vec3Prop(node.properties, 'origin', [0, 0, 0]);
  const position = vec3Prop(node.properties, 'position', [0, 0, 0]);
  const rotation = vec3Prop(node.properties, 'rotation', [0, 0, 0]);
  const pivot = vec3Prop(node.properties, 'pivot', [0, 0, 0]);
  const chartKey =
    node.surface === null ? null : `${node.surface.surface.key}\u0000${node.surface.chart}`;
  if (node.kind === 'cube') {
    const size = vec3Prop(node.properties, 'size', [1, 1, 1]);
    const inflate = scalarProp(node.properties, 'inflate', 0);
    return makeObb(node.id, chartKey, origin, size, inflate, pivot, position, rotation, placement);
  }
  if (node.kind === 'plane') {
    const sizeEntry = node.properties.find((p) => p.name === 'size');
    if (sizeEntry?.value.kind !== 'vector' || sizeEntry.value.values.length !== 2) return null;
    const sw =
      Number(sizeEntry.value.values[0]!.value.numerator) /
      Number(sizeEntry.value.values[0]!.value.denominator);
    const sh =
      Number(sizeEntry.value.values[1]!.value.numerator) /
      Number(sizeEntry.value.values[1]!.value.denominator);
    const u = vec3Prop(node.properties, 'u-axis', [1, 0, 0]);
    const v = vec3Prop(node.properties, 'v-axis', [0, 1, 0]);
    const min: [number, number, number] = [origin[0], origin[1], origin[2]];
    const max: [number, number, number] = [origin[0], origin[1], origin[2]];
    for (let i = 0; i < 3; i += 1) {
      const span = u[i]! * sw + v[i]! * sh;
      if (span < 0) min[i]! += span;
      else max[i]! += span;
    }
    const size: Vec3 = [
      Math.max(0.05, max[0] - min[0]),
      Math.max(0.05, max[1] - min[1]),
      Math.max(0.05, max[2] - min[2]),
    ];
    return makeObb(node.id, chartKey, min, size, 0, pivot, position, rotation, placement);
  }
  return null;
};

const collectObbs = (
  nodes: readonly InstantiatedGeometryNode[],
  placement: Vec3,
  out: SceneObb[],
): void => {
  for (const node of nodes) {
    const obb = obbFromNode(node, placement);
    if (obb !== null) out.push(obb);
    if (node.children.length > 0) collectObbs(node.children, placement, out);
  }
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
    const offset: Vec3 = [
      Number(o[0].numerator) / Number(o[0].denominator),
      Number(o[1].numerator) / Number(o[1].denominator),
      Number(o[2].numerator) / Number(o[2].denominator),
    ];
    collectObbs(
      instance.geometry,
      instance.placementAuthority === 'socket' ? offset : [0, 0, 0],
      obbs,
    );
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
    const p = boxSurfacePoint(region, x, y);
    if (obb === undefined) return p;
    const local: Vec3 = [obb.origin[0] + p[0], obb.origin[1] + p[1], obb.origin[2] + p[2]];
    return transformLocalPoint(local, obb.pivot, obb.rotation, obb.position, obb.placementOffset);
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

const probePointForTexel = (obb: SceneObb, region: TextureRegion, x: number, y: number): Vec3 => {
  const localOffset = boxSurfacePoint(region, x, y);
  const dir = region.direction ?? 'north';
  const normal = FACE_NORMALS[dir];
  const local: Vec3 = [
    obb.origin[0] + localOffset[0] + normal[0] * 0.08,
    obb.origin[1] + localOffset[1] + normal[1] * 0.08,
    obb.origin[2] + localOffset[2] + normal[2] * 0.08,
  ];
  return transformLocalPoint(local, obb.pivot, obb.rotation, obb.position, obb.placementOffset);
};

const aoStepAt = (
  point: Vec3,
  ownerId: string,
  obbs: readonly SceneObb[],
  radius: number,
  strength: number,
): number => {
  let nearest = Infinity;
  for (const other of obbs) {
    if (other.id === ownerId) continue;
    const dist = distanceToObb(point, other, radius);
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
      const probe = probePointForTexel(owner, region, x, y);
      const step = aoStepAt(probe, owner.id, obbs, radius, strength);
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
  for (const region of regions) {
    applyAoRegion(grid, region, owner, scene.obbs, params.radius, params.strength);
  }
  return true;
};
