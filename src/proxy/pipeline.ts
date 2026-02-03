import type { IncludeDiffOption, IncludeStateOption, IfRevisionOption, ToolError, ToolResponse } from '../types';
import type { ToolService } from '../usecases/ToolService';
import type { UsecaseResult } from '../usecases/result';
import {
  guardRevision,
  MetaOptions,
  resolveDiffDetail,
  resolveIncludeDiff,
  resolveIncludeState,
  withErrorMeta,
  withMeta
} from './meta';

type MetaPayload = IncludeStateOption & IncludeDiffOption & IfRevisionOption;

export type ProxyPipeline = {
  meta: MetaOptions;
  guardRevision: () => ToolResponse<never> | null;
  run: <T>(fn: () => Promise<ToolResponse<T>> | ToolResponse<T>) => Promise<ToolResponse<T>>;
  ok: <T extends Record<string, unknown>>(data: T) => ToolResponse<T>;
  wrap: <T>(result: UsecaseResult<T>) => ToolResponse<T>;
  error: (error: ToolError) => ToolResponse<never>;
};

type PipelineDeps = {
  service: ToolService;
  payload: MetaPayload;
  includeStateByDefault: () => boolean;
  includeDiffByDefault: () => boolean;
};

export const createProxyPipeline = (deps: PipelineDeps): ProxyPipeline => {
  const includeState = resolveIncludeState(deps.payload.includeState, deps.includeStateByDefault);
  const meta: MetaOptions = {
    includeState,
    includeDiff: resolveIncludeDiff(deps.payload.includeDiff, deps.includeDiffByDefault),
    diffDetail: resolveDiffDetail(deps.payload.diffDetail),
    ifRevision: deps.payload.ifRevision
  };
  return {
    meta,
    guardRevision: () => guardRevision(deps.service, deps.payload.ifRevision, meta),
    run: async <T>(fn: () => Promise<ToolResponse<T>> | ToolResponse<T>) => await fn(),
    ok: (data) => ({ ok: true, data: withMeta(data, meta, deps.service) }),
    wrap: (result) => (result.ok ? { ok: true, data: result.value } : withErrorMeta(result.error, meta, deps.service)),
    error: (error) => withErrorMeta(error, meta, deps.service)
  };
};


