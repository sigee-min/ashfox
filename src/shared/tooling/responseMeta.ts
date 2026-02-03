import type { ProjectDiff, ProjectState, ProjectStateDetail, ToolError } from '../../types';
import { buildStateMeta } from '../../domain/project/stateMeta';
import { errFromDomain } from './toolResponse';

type ResultLike<T> = { ok: true; value: T } | { ok: false; error: ToolError };

export type ResponseMetaDeps = {
  getProjectState: (payload: { detail: ProjectStateDetail }) => ResultLike<{ project: ProjectState }>;
  getProjectDiff: (payload: { sinceRevision: string; detail?: ProjectStateDetail }) => ResultLike<{ diff: ProjectDiff }>;
};

export type ResponseMetaOptions = {
  includeState: boolean;
  includeDiff: boolean;
  diffDetail: ProjectStateDetail;
  ifRevision?: string;
  includeRevision?: boolean;
};

export const buildResponseMeta = (deps: ResponseMetaDeps, options: ResponseMetaOptions) =>
  buildStateMeta(
    {
      getProjectState: deps.getProjectState,
      getProjectDiff: deps.getProjectDiff
    },
    {
      includeState: options.includeState,
      includeDiff: options.includeDiff,
      diffDetail: options.diffDetail,
      ifRevision: options.ifRevision,
      includeRevision: options.includeRevision ?? true
    }
  );

export const withResponseMeta = <T extends Record<string, unknown>>(
  data: T,
  deps: ResponseMetaDeps,
  options: ResponseMetaOptions
): T & { state?: unknown; diff?: unknown; revision?: string } => {
  const extra = buildResponseMeta(deps, options);
  if (Object.keys(extra).length === 0) return data;
  return { ...data, ...extra };
};

export const withResponseErrorMeta = (
  error: ToolError,
  deps: ResponseMetaDeps,
  options: ResponseMetaOptions
) => {
  const extra = buildResponseMeta(deps, options);
  if (Object.keys(extra).length === 0) return errFromDomain(error);
  const details = { ...(error.details ?? {}), ...extra };
  return errFromDomain({ ...error, details });
};
