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
  withErrorMeta,
  withMeta
} from './meta';
import { toToolResponse } from './response';
import { validateModelSpec, validateTextureSpec } from './validators';
import { computeTextureUsageId } from '../domain/textureUsage';
import { findUvOverlapIssues, formatUvFaceRect, UvOverlapIssue } from '../domain/uvOverlap';

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

  async applyModelSpec(payload: ApplyModelSpecPayload): Promise<ToolResponse<unknown>> {
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
    return this.runWithoutRevisionGuard(async () => {
      const report = createApplyReport();
      const result = applyModelSpecSteps(this.service, this.log, payload, report, meta);
      if (!result.ok) return result;
      return { ok: true, data: withMeta({ applied: true, report }, meta, this.service) };
    });
  }

  async applyTextureSpec(payload: ApplyTextureSpecPayload): Promise<ToolResponse<unknown>> {
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
    const usageRes = this.service.getTextureUsage({});
    if (!usageRes.ok) return withErrorMeta(usageRes.error, meta, this.service);
    const currentUsageId = computeTextureUsageId(usageRes.value);
    if (currentUsageId !== payload.uvUsageId) {
      return withErrorMeta(
        {
          code: 'invalid_state',
          message: 'UV usage changed since preflight_texture. Refresh preflight and retry.',
          fix: 'Call preflight_texture without texture filters and retry with the new uvUsageId.',
          details: { expected: payload.uvUsageId, current: currentUsageId }
        },
        meta,
        this.service
      );
    }
    const overlapIssues = findUvOverlapIssues(usageRes.value);
    const overlapTargets = collectTextureTargets(payload.textures);
    const blockingOverlaps = overlapIssues.filter((issue) => isOverlapTarget(issue, overlapTargets));
    if (blockingOverlaps.length > 0) {
      const sample = blockingOverlaps[0];
      const example = sample.example
        ? ` Example: ${formatUvFaceRect(sample.example.a)} overlaps ${formatUvFaceRect(sample.example.b)}.`
        : '';
      const names = blockingOverlaps.slice(0, 3).map((issue) => `"${issue.textureName}"`).join(', ');
      const suffix = blockingOverlaps.length > 3 ? ` (+${blockingOverlaps.length - 3} more)` : '';
      return withErrorMeta(
        {
          code: 'invalid_state',
          message:
            `UV overlap detected for texture${blockingOverlaps.length === 1 ? '' : 's'} ${names}${suffix}. ` +
            `Only identical UV rects may overlap.` +
            example,
          fix: 'Adjust UVs so only identical rects overlap, then call preflight_texture and retry.',
          details: {
            overlaps: blockingOverlaps.map((issue) => ({
              textureId: issue.textureId ?? undefined,
              textureName: issue.textureName,
              conflictCount: issue.conflictCount,
              example: issue.example
            }))
          }
        },
        meta,
        this.service
      );
    }
    return this.runWithoutRevisionGuard(async () => {
      const report = createApplyReport();
      const result = await applyTextureSpecSteps(
        this.service,
        this.limits,
        payload.textures,
        report,
        meta,
        this.log,
        usageRes.value
      );
      if (!result.ok) return result;
      this.log.info('applyTextureSpec applied', { textures: payload.textures.length });
      return { ok: true, data: withMeta({ applied: true, report }, meta, this.service) };
    });
  }

  async handle(tool: ProxyTool, payload: unknown): Promise<ToolResponse<unknown>> {
    try {
      switch (tool) {
        case 'apply_model_spec':
          return await this.applyModelSpec(payload as ApplyModelSpecPayload);
        case 'apply_texture_spec':
          return await this.applyTextureSpec(payload as ApplyTextureSpecPayload);
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

  private async runWithoutRevisionGuard<T>(fn: () => Promise<T> | T): Promise<T> {
    const service = this.service as {
      runWithoutRevisionGuardAsync?: (inner: () => Promise<T>) => Promise<T>;
      runWithoutRevisionGuard?: (inner: () => T) => T;
    };
    if (typeof service.runWithoutRevisionGuardAsync === 'function') {
      return service.runWithoutRevisionGuardAsync(async () => await fn());
    }
    if (typeof service.runWithoutRevisionGuard === 'function') {
      const result = service.runWithoutRevisionGuard(() => {
        const value = fn();
        if (value && typeof (value as Promise<T>).then === 'function') {
          throw new Error('Async revision guard unavailable');
        }
        return value as T;
      });
      return result;
    }
    return await fn();
  }
}

type TextureTargetSet = { ids: Set<string>; names: Set<string> };

const collectTextureTargets = (textures: ApplyTextureSpecPayload['textures']): TextureTargetSet => {
  const ids = new Set<string>();
  const names = new Set<string>();
  textures.forEach((texture) => {
    if (texture.targetId) ids.add(texture.targetId);
    if (texture.id) ids.add(texture.id);
    if (texture.targetName) names.add(texture.targetName);
    if (texture.name) names.add(texture.name);
  });
  return { ids, names };
};

const isOverlapTarget = (issue: UvOverlapIssue, targets: TextureTargetSet): boolean => {
  if (issue.textureId && targets.ids.has(issue.textureId)) return true;
  return targets.names.has(issue.textureName);
};

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
