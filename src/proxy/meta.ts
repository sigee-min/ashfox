import { ProjectStateDetail, ToolError, ToolErrorResponse, ToolResponse } from '../types';
import { ToolService } from '../usecases/ToolService';
import { decideRevision } from '../usecases/revision/revisionGuard';
import {
  buildResponseMeta,
  withResponseErrorMeta,
  withResponseMeta,
  type ResponseMetaOptions
} from '../shared/tooling/responseMeta';

export type MetaOptions = {
  includeState: boolean;
  includeDiff: boolean;
  diffDetail: ProjectStateDetail;
  ifRevision?: string;
};

export const resolveIncludeState = (flag: boolean | undefined, fallback: () => boolean): boolean => {
  if (flag !== undefined) return flag;
  return fallback();
};

export const resolveIncludeDiff = (flag: boolean | undefined, fallback: () => boolean): boolean => {
  if (flag !== undefined) return flag;
  return fallback();
};

export const resolveDiffDetail = (detail: ProjectStateDetail | undefined): ProjectStateDetail => detail ?? 'summary';

const toResponseMetaOptions = (meta: MetaOptions): ResponseMetaOptions => ({
  includeState: meta.includeState,
  includeDiff: meta.includeDiff,
  diffDetail: meta.diffDetail,
  ifRevision: meta.ifRevision,
  includeRevision: true
});

export const buildMeta = (meta: MetaOptions, service: ToolService): Record<string, unknown> =>
  buildResponseMeta(
    {
      getProjectState: (payload) => service.getProjectState(payload),
      getProjectDiff: (payload) => service.getProjectDiff(payload)
    },
    toResponseMetaOptions(meta)
  );

export const withMeta = <T extends Record<string, unknown>>(
  data: T,
  meta: MetaOptions,
  service: ToolService
): T & { state?: unknown; diff?: unknown; revision?: string } => {
  return withResponseMeta(
    data,
    {
      getProjectState: (payload) => service.getProjectState(payload),
      getProjectDiff: (payload) => service.getProjectDiff(payload)
    },
    toResponseMetaOptions(meta)
  );
};

export const withErrorMeta = (
  error: ToolError,
  meta: MetaOptions,
  service: ToolService
): ToolErrorResponse => {
  return withResponseErrorMeta(
    error,
    {
      getProjectState: (payload) => service.getProjectState(payload),
      getProjectDiff: (payload) => service.getProjectDiff(payload)
    },
    toResponseMetaOptions(meta)
  );
};

export const guardRevision = (
  service: ToolService,
  expected: string | undefined,
  meta: MetaOptions
): ToolResponse<never> | null => {
  const serviceWithRevision = service as {
    isRevisionRequired?: () => boolean;
    isAutoRetryRevisionEnabled?: () => boolean;
    getProjectState?: ToolService['getProjectState'];
  };
  const requiresRevision =
    typeof serviceWithRevision.isRevisionRequired === 'function' ? service.isRevisionRequired() : false;
  if (!requiresRevision) return null;
  const allowAutoRetry =
    typeof serviceWithRevision.isAutoRetryRevisionEnabled === 'function'
      ? service.isAutoRetryRevisionEnabled()
      : false;
  if (typeof serviceWithRevision.getProjectState !== 'function') return null;
  const decision = decideRevision(expected, {
    requiresRevision,
    allowAutoRetry,
    getProjectState: () => service.getProjectState({ detail: 'summary' })
  });
  if (!decision.ok) return withErrorMeta(decision.error, meta, service);
  if (decision.action === 'retry') {
    meta.ifRevision = decision.currentRevision;
    return null;
  }
  return null;
};




