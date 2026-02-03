import type { FormatKind } from '../../types';
import { ok, fail, type UsecaseResult } from '../result';
import { ensureNonBlankString } from '../../shared/payloadValidation';
import {
  PROJECT_DELETE_NAME_REQUIRED,
  PROJECT_DELETE_NAME_REQUIRED_FIX,
  PROJECT_MISMATCH,
  PROJECT_NO_ACTIVE
} from '../../shared/messages';
import type { ProjectServiceDeps } from './projectServiceTypes';

export type ProjectDeleteContext = Pick<
  ProjectServiceDeps,
  'session' | 'editor' | 'projectState' | 'getSnapshot' | 'ensureRevisionMatch'
>;

export const runDeleteProject = (
  ctx: ProjectDeleteContext,
  payload: { target?: { name?: string }; force?: boolean; ifRevision?: string }
): UsecaseResult<{ action: 'deleted'; project: { id: string; format: FormatKind; name: string | null; formatId?: string | null } }> => {
  const revisionErr = ctx.ensureRevisionMatch(payload.ifRevision);
  if (revisionErr) return fail(revisionErr);
  const targetName = payload.target?.name;
  if (!targetName) {
    return fail({
      code: 'invalid_payload',
      message: PROJECT_DELETE_NAME_REQUIRED,
      fix: PROJECT_DELETE_NAME_REQUIRED_FIX
    });
  }
  const targetBlankErr = ensureNonBlankString(targetName, 'target.name');
  if (targetBlankErr) return fail(targetBlankErr);
  const snapshot = ctx.getSnapshot();
  const normalized = ctx.projectState.normalize(snapshot);
  const info = ctx.projectState.toProjectInfo(normalized);
  if (!info || !normalized.format) {
    return fail({ code: 'invalid_state', message: PROJECT_NO_ACTIVE });
  }
  if (info.name !== targetName) {
    return fail({
      code: 'invalid_state',
      message: PROJECT_MISMATCH,
      details: {
        expected: { name: targetName },
        actual: { name: info.name ?? null }
      }
    });
  }
  const err = ctx.editor.closeProject({ force: payload.force });
  if (err) return fail(err);
  ctx.session.reset();
  return ok({
    action: 'deleted',
    project: {
      id: info.id,
      format: normalized.format,
      name: info.name ?? null,
      formatId: normalized.formatId ?? null
    }
  });
};
