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
import { add3, dot3, scale3, sub3, texelSurfaceAndNormal } from './scene';

export type { SceneObb } from './contract';
export type { TextureSceneContext } from './raster';
export { buildTextureSceneContext } from './scene';

type PatternStatement = Extract<ProgramTextureChart['statements'][number], { kind: 'pattern' }>;

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
