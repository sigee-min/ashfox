import type { ApplyReport } from '../apply';
import type { AutoUvAtlasResult, GenerateTexturePresetResult, PreflightTextureResult } from '../../types';
import type { RenderPreviewStructured } from '../../types/preview';
import type { PipelineStepsResult } from '../pipelineResult';
import type { TexturePlanDetail, TexturePlanPaint } from '../../spec';

export type TexturePipelineSteps = {
  plan?: {
    applied: boolean;
    detail: TexturePlanDetail;
    resolution: { width: number; height: number };
    textures: Array<{ name: string; cubeCount: number }>;
    padding: number;
    paint?: TexturePlanPaint;
    notes?: string[];
    autoUvAtlas?: AutoUvAtlasResult;
  };
  assign?: { applied: number; results: Array<{ textureId?: string; textureName: string; cubeCount: number; faces?: string[] }> };
  preflight?: { before?: PreflightTextureResult; after?: PreflightTextureResult };
  uv?: { applied: true; cubes: number; faces: number; uvUsageId: string };
  textures?: { applied: true; report: ApplyReport; recovery?: Record<string, unknown>; uvUsageId?: string };
  presets?: { applied: number; results: GenerateTexturePresetResult[]; recovery?: Record<string, unknown>; uvUsageId?: string };
  cleanup?: { applied: number; deleted: Array<{ id?: string; name: string }> };
  preview?: RenderPreviewStructured;
};

export type ApplyUvSpecResult = {
  applied: true;
  cubes: number;
  faces: number;
  uvUsageId: string;
};

export type ApplyTextureSpecResult = {
  applied: true;
  report: ApplyReport;
  recovery?: Record<string, unknown>;
  uvUsageId?: string;
};

export type TexturePipelineResult = PipelineStepsResult<
  TexturePipelineSteps,
  { applied: boolean; planOnly?: boolean; uvUsageId?: string }
>;
