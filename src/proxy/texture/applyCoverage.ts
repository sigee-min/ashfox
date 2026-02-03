import type { TextureSpec } from '../../spec';
import type { TextureCoverage } from './textureCoverage';
import {
  TEXTURE_COVERAGE_LOW_FIX,
  TEXTURE_COVERAGE_LOW_HINT,
  TEXTURE_COVERAGE_LOW_MESSAGE
} from '../../shared/messages';
import type { ToolError } from '../../types';

const MIN_OPAQUE_RATIO = 0.05;

export const checkTextureCoverage = (args: {
  coverage: TextureCoverage | undefined;
  texture: TextureSpec;
  label: string;
  paintCoverage?: TextureCoverage;
  usePaintCoverage?: boolean;
}): ToolError | null => {
  const mode = args.texture.mode ?? 'create';
  if (mode !== 'create') return null;
  const ops = Array.isArray(args.texture.ops) ? args.texture.ops : [];
  if (ops.length === 0 && !args.texture.background) return null;
  const effectiveCoverage =
    args.usePaintCoverage && args.paintCoverage ? args.paintCoverage : args.coverage;
  if (!effectiveCoverage || effectiveCoverage.totalPixels === 0) return null;
  if (effectiveCoverage.opaqueRatio >= MIN_OPAQUE_RATIO) return null;
  const ratio = Math.round(effectiveCoverage.opaqueRatio * 1000) / 10;
  return {
    code: 'invalid_payload',
    message: TEXTURE_COVERAGE_LOW_MESSAGE(args.label, ratio),
    fix: TEXTURE_COVERAGE_LOW_FIX,
    details: {
      coverage: effectiveCoverage,
      hint: TEXTURE_COVERAGE_LOW_HINT
    }
  };
};
