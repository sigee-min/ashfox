import type { RenderPreviewStructured } from '../../types/preview';
import type { ValidateResult } from '../../types';
import type { AppliedReport, ModelPlan, ModelStageResult } from './types';

export const buildStageResult = (args: {
  label?: string;
  plan: ModelPlan['summary'];
  warnings?: string[];
  ops?: ModelPlan['ops'];
  report?: AppliedReport;
  preview?: RenderPreviewStructured;
  validate?: ValidateResult;
}): ModelStageResult => {
  const result: ModelStageResult = {
    plan: args.plan
  };
  if (args.label) result.label = args.label;
  if (args.warnings && args.warnings.length > 0) result.warnings = args.warnings;
  if (args.ops && args.ops.length > 0) result.ops = args.ops;
  if (args.report) result.report = args.report;
  if (args.preview) result.preview = args.preview;
  if (args.validate) result.validate = args.validate;
  return result;
};
