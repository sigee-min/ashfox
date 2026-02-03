import { Logger } from '../logging';
import { Limits, ProjectStateDetail, ToolResponse } from '../types';
import {
  ApplyTextureSpecPayload,
  ApplyUvSpecPayload,
  EntityPipelinePayload,
  ProxyTool,
  TexturePipelinePayload
} from '../spec';
import { ToolService } from '../usecases/ToolService';
import type { DomPort } from '../ports/dom';
import { err } from '../shared/tooling/toolResponse';
import { modelPipelineProxy } from './modelPipeline';
import { applyTextureSpecProxy } from './texturePipeline/applyTextureSpecProxy';
import { applyUvSpecProxy } from './texturePipeline/applyUvSpecProxy';
import { texturePipelineProxy } from './texturePipeline/texturePipelineProxy';
import type { ProxyPipelineDeps, ProxyToolPayloadMap, ProxyToolResultMap } from './types';
import { entityPipelineProxy } from './entityPipeline';
import { attachStateToResponse } from '../shared/tooling/attachState';
import { runPreviewStep } from './previewStep';
import { runUsecaseWithOptionalRevision, runWithOptionalRevision } from './optionalRevision';
import { attachPreviewResponse } from './previewResponse';
import { createProxyPipelineCache } from './cache';
import { PROXY_TOOL_UNKNOWN } from '../shared/messages';
import { isResponseError } from '../shared/tooling/responseGuards';
import { TraceRecorder } from '../trace/traceRecorder';
import { appendMissingRevisionNextActions } from '../shared/tooling/revisionNextActions';

export class ProxyRouter {
  private readonly service: ToolService;
  private readonly dom: DomPort;
  private readonly log: Logger;
  private readonly limits: Limits;
  private readonly includeStateByDefault: () => boolean;
  private readonly includeDiffByDefault: () => boolean;
  private readonly traceRecorder?: TraceRecorder;
  private readonly proxyHandlers: {
    [K in ProxyTool]: (payload: ProxyToolPayloadMap[K]) => Promise<ToolResponse<ProxyToolResultMap[K]>>;
  };

  constructor(
    service: ToolService,
    dom: DomPort,
    log: Logger,
    limits: Limits,
    options?: {
      includeStateByDefault?: boolean | (() => boolean);
      includeDiffByDefault?: boolean | (() => boolean);
      traceRecorder?: TraceRecorder;
    }
  ) {
    this.service = service;
    this.dom = dom;
    this.log = log;
    this.limits = limits;
    const flag = options?.includeStateByDefault;
    this.includeStateByDefault = typeof flag === 'function' ? flag : () => Boolean(flag);
    const diffFlag = options?.includeDiffByDefault;
    this.includeDiffByDefault = typeof diffFlag === 'function' ? diffFlag : () => Boolean(diffFlag);
    this.traceRecorder = options?.traceRecorder;
    this.proxyHandlers = {
      apply_texture_spec: async (payload) => this.applyTextureSpec(payload),
      apply_uv_spec: async (payload) => this.applyUvSpec(payload),
      model_pipeline: async (payload) => modelPipelineProxy(this.getPipelineDeps(), payload),
      texture_pipeline: async (payload) => this.texturePipeline(payload),
      entity_pipeline: async (payload) => this.entityPipeline(payload),
      render_preview: async (payload) =>
        attachStateToResponse(
          this.getStateDeps(),
          payload,
          runWithOptionalRevision(this.service, payload, () => {
            const previewRes = runPreviewStep(this.service, payload);
            if (isResponseError(previewRes)) return previewRes;
            return attachPreviewResponse({ ok: true, data: previewRes.data.data }, previewRes.data);
          })
        ),
      validate: async (payload) =>
        attachStateToResponse(
          this.getStateDeps(),
          payload,
          runUsecaseWithOptionalRevision(this.service, payload, () => this.service.validate(payload))
        )
    };
  }

  async applyTextureSpec(payload: ApplyTextureSpecPayload): Promise<ToolResponse<ProxyToolResultMap['apply_texture_spec']>> {
    return applyTextureSpecProxy(this.getPipelineDeps(), payload);
  }

  async applyUvSpec(payload: ApplyUvSpecPayload): Promise<ToolResponse<ProxyToolResultMap['apply_uv_spec']>> {
    return applyUvSpecProxy(this.getPipelineDeps(), payload);
  }

  async texturePipeline(payload: TexturePipelinePayload): Promise<ToolResponse<ProxyToolResultMap['texture_pipeline']>> {
    return texturePipelineProxy(this.getPipelineDeps(), payload);
  }

  async entityPipeline(payload: EntityPipelinePayload): Promise<ToolResponse<ProxyToolResultMap['entity_pipeline']>> {
    return entityPipelineProxy(this.getPipelineDeps(), payload);
  }

  async handle<K extends ProxyTool>(
    tool: K,
    payload: ProxyToolPayloadMap[K]
  ): Promise<ToolResponse<ProxyToolResultMap[K]>> {
    try {
      const handler =
        this.proxyHandlers[tool] as
          | ((payload: ProxyToolPayloadMap[K]) => Promise<ToolResponse<ProxyToolResultMap[K]>>)
          | undefined;
      if (!handler) {
        const response = err('invalid_payload', PROXY_TOOL_UNKNOWN(tool), { reason: 'unknown_proxy_tool', tool });
        const withRevision = appendMissingRevisionNextActions(tool, payload, response);
        this.recordTrace(tool, payload, withRevision);
        return withRevision;
      }
      const response = await handler(payload);
      const withRevision = appendMissingRevisionNextActions(tool, payload, response);
      this.recordTrace(tool, payload, withRevision);
      return withRevision;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      this.log.error('proxy handle error', { tool, message });
      const response = err('unknown', message, { reason: 'proxy_exception', tool });
      const withRevision = appendMissingRevisionNextActions(tool, payload, response);
      this.recordTrace(tool, payload, withRevision);
      return withRevision;
    }
  }

  private getPipelineDeps(): ProxyPipelineDeps {
    return {
      service: this.service,
      dom: this.dom,
      log: this.log,
      limits: this.limits,
      includeStateByDefault: this.includeStateByDefault,
      includeDiffByDefault: this.includeDiffByDefault,
      cache: createProxyPipelineCache()
    };
  }

  private getStateDeps() {
    return {
      includeStateByDefault: this.includeStateByDefault,
      includeDiffByDefault: this.includeDiffByDefault,
      getProjectState: (payload: { detail: ProjectStateDetail }) => this.service.getProjectState(payload),
      getProjectDiff: (payload: { sinceRevision: string; detail?: ProjectStateDetail }) =>
        this.service.getProjectDiff(payload)
    };
  }

  private recordTrace<T>(
    tool: ProxyTool,
    payload: ProxyToolPayloadMap[ProxyTool],
    response: ToolResponse<T>
  ): void {
    if (!this.traceRecorder) return;
    try {
      this.traceRecorder.record('proxy', tool, payload, response as ToolResponse<unknown>);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'trace log record failed';
      this.log.warn('trace log record failed', { tool, message });
    }
  }

}





