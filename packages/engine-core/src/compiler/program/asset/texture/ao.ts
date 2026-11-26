import type {
  ProgramProperty,
  ProgramTextureChart,
} from '../../../../project/program/syntax/contract';
import type { Vec3 } from '../../../../model/identity';
import type { SceneObb } from './contract';
import { properties, type TextureExpressionContext } from './expressions';
import {
  sampleBudget,
  type PaintGrid,
  type TextureRegion,
  type TextureSceneContext,
} from './raster';
import { propertyIssue, type TextureReporter } from './report';
import { texelSurfaceAndNormal } from './scene';

export type { SceneObb } from './contract';
export type { TextureSceneContext } from './raster';
export { buildTextureSceneContext } from './scene';

type PatternStatement = Extract<ProgramTextureChart['statements'][number], { kind: 'pattern' }>;

const distanceToObb = (
  px: number,
  py: number,
  pz: number,
  obb: SceneObb,
  radius: number,
): number => {
  if (
    px < obb.aabbMin[0] - radius ||
    px > obb.aabbMax[0] + radius ||
    py < obb.aabbMin[1] - radius ||
    py > obb.aabbMax[1] + radius ||
    pz < obb.aabbMin[2] - radius ||
    pz > obb.aabbMax[2] + radius
  ) {
    return Infinity;
  }
  const dx0 = px - obb.center[0];
  const dy0 = py - obb.center[1];
  const dz0 = pz - obb.center[2];
  const dx = Math.max(
    0,
    Math.abs(dx0 * obb.ax[0] + dy0 * obb.ax[1] + dz0 * obb.ax[2]) - obb.half[0],
  );
  const dy = Math.max(
    0,
    Math.abs(dx0 * obb.ay[0] + dy0 * obb.ay[1] + dz0 * obb.ay[2]) - obb.half[1],
  );
  const dz = Math.max(
    0,
    Math.abs(dx0 * obb.az[0] + dy0 * obb.az[1] + dz0 * obb.az[2]) - obb.half[2],
  );
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
};

const filterNearbyObbs = (
  owner: SceneObb,
  obbs: readonly SceneObb[],
  radius: number,
): readonly SceneObb[] => {
  const pad = radius + 0.08;
  const minX = owner.aabbMin[0] - pad;
  const minY = owner.aabbMin[1] - pad;
  const minZ = owner.aabbMin[2] - pad;
  const maxX = owner.aabbMax[0] + pad;
  const maxY = owner.aabbMax[1] + pad;
  const maxZ = owner.aabbMax[2] + pad;
  return obbs.filter(
    (other) =>
      other.id !== owner.id &&
      other.aabbMax[0] >= minX &&
      other.aabbMin[0] <= maxX &&
      other.aabbMax[1] >= minY &&
      other.aabbMin[1] <= maxY &&
      other.aabbMax[2] >= minZ &&
      other.aabbMin[2] <= maxZ,
  );
};

const aoStepAt = (
  surface: Readonly<{ readonly point: Vec3; readonly normal: Vec3 }>,
  owner: SceneObb,
  obbs: readonly SceneObb[],
  radius: number,
  strength: number,
): number => {
  const px = surface.point[0];
  const py = surface.point[1];
  const pz = surface.point[2];
  const nx = surface.normal[0] * 0.08;
  const ny = surface.normal[1] * 0.08;
  const nz = surface.normal[2] * 0.08;
  const fx = px + nx;
  const fy = py + ny;
  const fz = pz + nz;
  const hasBack = owner.planeBasis !== undefined;
  const bx = px - nx;
  const by = py - ny;
  const bz = pz - nz;
  let nearest = Infinity;
  for (const other of obbs) {
    const dist = hasBack
      ? Math.min(distanceToObb(fx, fy, fz, other, radius), distanceToObb(bx, by, bz, other, radius))
      : distanceToObb(fx, fy, fz, other, radius);
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
  const nearby = filterNearbyObbs(owner, scene.obbs, params.radius);
  if (nearby.length === 0) return true;
  for (const region of regions)
    applyAoRegion(grid, region, owner, nearby, params.radius, params.strength);
  return true;
};
