import { Logger } from '../logging';
import { Limits, RenderPreviewPayload, RenderPreviewResult, ToolResponse } from '../types';
import {
  ApplyModelSpecPayload,
  ApplyTextureSpecPayload,
  ProxyTool
} from '../spec';
import { ToolService } from '../usecases/ToolService';
import { buildRenderPreviewContent, buildRenderPreviewStructured } from '../mcp/content';
import { applyModelSpecSteps, applyTextureSpecSteps, createApplyReport } from './apply';
import {
  guardRevision,
  MetaOptions,
  resolveDiffDetail,
  resolveIncludeDiff,
  resolveIncludeState,
  withMeta
} from './meta';
import { toToolResponse } from './response';
import { validateModelSpec, validateTextureSpec } from './validators';

export class ProxyRouter {
  private readonly service: ToolService;
  private readonly log: Logger;
  private readonly limits: Limits;
  private readonly includeStateByDefault: () => boolean;
  private readonly includeDiffByDefault: () => boolean;

  constructor(
    service: ToolService,
    log: Logger,
    limits: Limits,
    options?: { includeStateByDefault?: boolean | (() => boolean); includeDiffByDefault?: boolean | (() => boolean) }
  ) {
    this.service = service;
    this.log = log;
    this.limits = limits;
    const flag = options?.includeStateByDefault;
    this.includeStateByDefault = typeof flag === 'function' ? flag : () => Boolean(flag);
    const diffFlag = options?.includeDiffByDefault;
    this.includeDiffByDefault = typeof diffFlag === 'function' ? diffFlag : () => Boolean(diffFlag);
  }

  applyModelSpec(payload: ApplyModelSpecPayload): ToolResponse<unknown> {
    const v = validateModelSpec(payload, this.limits);
    if (!v.ok) return v;
    const includeState = resolveIncludeState(payload.includeState, this.includeStateByDefault);
    const meta: MetaOptions = {
      includeState,
      includeDiff: resolveIncludeDiff(payload.includeDiff, this.includeDiffByDefault),
      diffDetail: resolveDiffDetail(payload.diffDetail),
      ifRevision: payload.ifRevision
    };
    const revisionError = guardRevision(this.service, payload.ifRevision, meta);
    if (revisionError) return revisionError;
    return this.runWithoutRevisionGuard(() => {
      const report = createApplyReport();
      const result = applyModelSpecSteps(this.service, this.log, payload, report, meta);
      if (!result.ok) return result;
      return { ok: true, data: withMeta({ applied: true, report }, meta, this.service) };
    });
  }

  applyTextureSpec(payload: ApplyTextureSpecPayload): ToolResponse<unknown> {
    const v = validateTextureSpec(payload, this.limits);
    if (!v.ok) return v;
    const includeState = resolveIncludeState(payload.includeState, this.includeStateByDefault);
    const meta: MetaOptions = {
      includeState,
      includeDiff: resolveIncludeDiff(payload.includeDiff, this.includeDiffByDefault),
      diffDetail: resolveDiffDetail(payload.diffDetail),
      ifRevision: payload.ifRevision
    };
    const guard = guardRevision(this.service, payload.ifRevision, meta);
    if (guard) return guard;
    return this.runWithoutRevisionGuard(() => {
      const report = createApplyReport();
      const result = applyTextureSpecSteps(this.service, this.limits, payload.textures, report, meta, this.log);
      if (!result.ok) return result;
      this.log.info('applyTextureSpec applied', { textures: payload.textures.length });
      return { ok: true, data: withMeta({ applied: true, report }, meta, this.service) };
    });
  }

  handle(tool: ProxyTool, payload: unknown): ToolResponse<unknown> {
    try {
      switch (tool) {
        case 'apply_model_spec':
          return this.applyModelSpec(payload as ApplyModelSpecPayload);
        case 'apply_texture_spec':
          return this.applyTextureSpec(payload as ApplyTextureSpecPayload);
        case 'render_preview':
          return attachRenderPreviewContent(
            toToolResponse(this.service.renderPreview(payload as RenderPreviewPayload))
          );
        case 'validate':
          return toToolResponse(this.service.validate());
        default:
          return { ok: false, error: { code: 'unknown', message: `Unknown proxy tool ${tool}` } };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      this.log.error('proxy handle error', { tool, message });
      return { ok: false, error: { code: 'unknown', message } };
    }
  }

  private runWithoutRevisionGuard<T>(fn: () => T): T {
    const runner = (this.service as { runWithoutRevisionGuard?: (inner: () => T) => T }).runWithoutRevisionGuard;
    if (typeof runner === 'function') return runner.call(this.service, fn);
    return fn();
  }
}

const attachRenderPreviewContent = (
  response: ToolResponse<RenderPreviewResult>
): ToolResponse<RenderPreviewResult> => {
  if (!response.ok) return response;
  const content = buildRenderPreviewContent(response.data);
  const structuredContent = buildRenderPreviewStructured(response.data);
  if (!content.length) {
    return { ...response, structuredContent };
  }
  return { ...response, content, structuredContent };
};
