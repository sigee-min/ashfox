import { buildRenderPreviewContent, buildRenderPreviewStructured } from '../transport/mcp/content';
import type { McpContentBlock, ToolResponse } from '../types';
import { errFromDomain } from '../shared/tooling/toolResponse';
import type { RenderPreviewPayload, RenderPreviewResult, RenderPreviewStructured } from '../types/preview';
import type { ToolService } from '../usecases/ToolService';
import type { MetaOptions } from './meta';
import { usecaseError } from './errorAdapter';
import { isUsecaseError } from '../shared/tooling/responseGuards';

export type PreviewStepResult = {
  data: RenderPreviewResult;
  content: McpContentBlock[];
  structured: RenderPreviewStructured;
};

export type PreviewStepData = PreviewStepResult;

const renderPreview = (
  service: ToolService,
  payload: RenderPreviewPayload,
  meta?: MetaOptions
): ToolResponse<RenderPreviewResult> => {
  const previewRes = service.renderPreview(payload);
  if (isUsecaseError(previewRes)) {
    return meta ? usecaseError(previewRes, meta, service) : errFromDomain(previewRes.error);
  }
  return { ok: true, data: previewRes.value };
};

export const runPreviewStep = (
  service: ToolService,
  payload: RenderPreviewPayload,
  meta?: MetaOptions
): ToolResponse<PreviewStepResult> => {
  const previewRes = renderPreview(service, payload, meta);
  if (!previewRes.ok) return previewRes;
  const content = buildRenderPreviewContent(previewRes.data);
  const structured = buildRenderPreviewStructured(previewRes.data);
  return {
    ok: true,
    data: {
      data: previewRes.data,
      content,
      structured
    }
  };
};

export const runPreviewStepStructured = (
  service: ToolService,
  payload: RenderPreviewPayload,
  meta?: MetaOptions
): ToolResponse<RenderPreviewStructured> => {
  const previewRes = renderPreview(service, payload, meta);
  if (!previewRes.ok) return previewRes;
  return {
    ok: true,
    data: buildRenderPreviewStructured(previewRes.data)
  };
};




