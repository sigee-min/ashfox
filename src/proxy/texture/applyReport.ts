import type { TextureSpec } from '../../spec';
import type { TextureCoverage } from './textureCoverage';

export type ApplyErrorEntry = {
  step: string;
  item?: string;
  message: string;
};

export type TextureCoverageReport = {
  id?: string;
  name: string;
  mode: 'create' | 'update';
  width: number;
  height: number;
  coverage?: TextureCoverage;
};

export type ApplyReport = {
  applied: { bones: string[]; cubes: string[]; textures: string[]; animations: string[] };
  errors: ApplyErrorEntry[];
  textureCoverage?: TextureCoverageReport[];
};

export const createApplyReport = (): ApplyReport => ({
  applied: { bones: [], cubes: [], textures: [], animations: [] },
  errors: []
});

export const recordApplyError = (
  report: ApplyReport,
  step: string,
  item: string | undefined,
  message: string
): ApplyReport => {
  report.errors.push({ step, item, message });
  return report;
};

export const recordTextureCoverage = (
  report: ApplyReport,
  texture: TextureSpec,
  render: { width: number; height: number; coverage?: TextureCoverage },
  mode: 'create' | 'update',
  label: string
) => {
  const name = texture.name ?? texture.targetName ?? label;
  const entry: TextureCoverageReport = {
    id: texture.id ?? texture.targetId ?? undefined,
    name,
    mode,
    width: render.width,
    height: render.height,
    coverage: render.coverage ?? undefined
  };
  if (!report.textureCoverage) {
    report.textureCoverage = [entry];
    return;
  }
  report.textureCoverage.push(entry);
};
