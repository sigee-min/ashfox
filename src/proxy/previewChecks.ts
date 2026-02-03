import type { ToolResponse, ValidateResult } from '../types';
import type { RenderPreviewPayload, RenderPreviewStructured } from '../types/preview';
import type { PreviewStepData } from './previewStep';

export type StageCheckFlags = {
  preview: boolean;
  validate: boolean;
};

export const resolveStageCheckFlags = (args: {
  preview?: RenderPreviewPayload;
  validate?: boolean;
  stagePreview?: boolean;
  stageValidate?: boolean;
  staged: boolean;
}): StageCheckFlags => ({
  preview: Boolean(args.preview) && args.stagePreview !== false && args.staged,
  validate: Boolean(args.validate) && args.stageValidate !== false && args.staged
});

export const runStageChecks = (
  flags: StageCheckFlags,
  runners: {
    preview: () => ToolResponse<RenderPreviewStructured>;
    validate: () => ToolResponse<ValidateResult>;
  }
): ToolResponse<{ preview?: RenderPreviewStructured; validate?: ValidateResult }> => {
  const result: { preview?: RenderPreviewStructured; validate?: ValidateResult } = {};
  if (flags.preview) {
    const previewRes = runners.preview();
    if (!previewRes.ok) return previewRes;
    result.preview = previewRes.data;
  }
  if (flags.validate) {
    const validateRes = runners.validate();
    if (!validateRes.ok) return validateRes;
    result.validate = validateRes.data;
  }
  return { ok: true, data: result };
};

export const runFinalPreviewValidate = (args: {
  preview?: RenderPreviewPayload;
  validate?: boolean;
  previewRunner: () => ToolResponse<PreviewStepData>;
  validateRunner: () => ToolResponse<ValidateResult>;
}): ToolResponse<{ preview?: RenderPreviewStructured; validate?: ValidateResult; previewData?: PreviewStepData | null }> => {
  const result: { preview?: RenderPreviewStructured; validate?: ValidateResult; previewData?: PreviewStepData | null } = {};
  if (args.preview) {
    const previewRes = args.previewRunner();
    if (!previewRes.ok) return previewRes;
    result.preview = previewRes.data.structured;
    result.previewData = previewRes.data;
  }
  if (args.validate) {
    const validateRes = args.validateRunner();
    if (!validateRes.ok) return validateRes;
    result.validate = validateRes.data;
  }
  return { ok: true, data: result };
};
