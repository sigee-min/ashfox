import type {
  ProgramProperty,
  ProgramTextureChart,
} from '../../../../project/program/syntax/contract';
import type { GrainMode } from './contract';
import { readRole } from './palette';
import type { PreparedTexture } from './prepare';
import { fill, roleId, type PaintGrid, type TextureRegion } from './raster';
import { propertyIssue, type TextureReporter } from './report';

const GRAIN_MODES = new Set<string>(['clustered', 'soft', 'none']);

/** Reads an explicit grain property (`clustered | soft | none`) if present. */
export const readGrainModeProperty = (
  statements: readonly ProgramTextureChart['statements'][number][],
  report: TextureReporter,
): GrainMode | null | undefined => {
  const props = statements.filter(
    (entry): entry is ProgramProperty => entry.kind === 'property' && entry.name === 'grain',
  );
  if (props.length === 0) return undefined;
  if (props.length > 1) {
    report.report(props[1]!.span, 'asset.texture.duplicate-property', 'Duplicate grain property.');
    return null;
  }
  const value = props[0]!.value;
  if (value.kind === 'name' && GRAIN_MODES.has(value.value)) return value.value as GrainMode;
  report.report(
    value.span,
    'asset.texture.invalid-grain',
    'Grain must be clustered, soft, or none.',
  );
  return null;
};

/** Fills a single face region from a `face <dir> { fill = <role>; }` property. */
export const applyFaceFill = (
  fillProp: ProgramProperty,
  region: TextureRegion,
  prepared: PreparedTexture,
  grid: PaintGrid,
  report: TextureReporter,
): boolean => {
  const role = readRole(
    fillProp.value,
    prepared.palette,
    true,
    report.path,
    propertyIssue(report),
    fillProp.span,
  );
  const id = role === null ? null : roleId(grid, role.name);
  if (id === null) return false;
  fill(grid, region.x, region.y, region.width, region.height, id, 2);
  return true;
};

/** Copies another face region horizontally flipped into target face region. */
export const copyMirroredFace = (
  mirrorProp: ProgramProperty,
  targetDir: string,
  targetRegion: TextureRegion,
  regions: readonly TextureRegion[],
  grid: PaintGrid,
  report: TextureReporter,
): boolean => {
  const value = mirrorProp.value;
  if (value.kind !== 'name' || value.value === targetDir) {
    report.report(
      value.span,
      'asset.texture.invalid-mirror',
      'Face mirror must name a distinct face direction.',
    );
    return false;
  }
  const sourceRegion = regions.find((candidate) => candidate.direction === value.value);
  if (sourceRegion === undefined) {
    report.report(
      value.span,
      'asset.texture.invalid-mirror',
      'Face mirror target has no geometry-owned region.',
    );
    return false;
  }
  if (sourceRegion.width !== targetRegion.width || sourceRegion.height !== targetRegion.height) {
    report.report(
      value.span,
      'asset.texture.invalid-mirror',
      'Mirrored faces must have identical texel dimensions.',
    );
    return false;
  }
  for (let y = 0; y < targetRegion.height; y += 1) {
    for (let x = 0; x < targetRegion.width; x += 1) {
      const srcIdx =
        (sourceRegion.y + y) * grid.width + (sourceRegion.x + sourceRegion.width - 1 - x);
      const dstIdx = (targetRegion.y + y) * grid.width + (targetRegion.x + x);
      grid.values[dstIdx] = grid.values[srcIdx]!;
      grid.tones[dstIdx] = grid.tones[srcIdx]!;
      grid.fixed[dstIdx] = grid.fixed[srcIdx]!;
      grid.ao[dstIdx] = grid.ao[srcIdx]!;
    }
  }
  return true;
};
