import type {
  ProjectDiff,
  ProjectState,
  ProjectStateDetail,
} from '@ashfox/blockbench-contracts/types/internal';
import { ok, fail, type UsecaseResult } from '../result';
import { diffSnapshots } from '../../domain/project/diff';
import { ensureNonBlankString } from '../../shared/payloadValidation';
import { PROJECT_NO_ACTIVE } from '../../shared/messages';
import type { ProjectServiceDeps } from './types';

export class ProjectStateService {
  private readonly editor: ProjectServiceDeps['editor'];
  private readonly projectState: ProjectServiceDeps['projectState'];
  private readonly revision: ProjectServiceDeps['revision'];
  private readonly getSnapshot: ProjectServiceDeps['getSnapshot'];

  constructor(deps: ProjectServiceDeps) {
    this.editor = deps.editor;
    this.projectState = deps.projectState;
    this.revision = deps.revision;
    this.getSnapshot = deps.getSnapshot;
  }

  getProjectState(payload: {
    detail?: ProjectStateDetail;
    includeUsage?: boolean;
  }): UsecaseResult<{ project: ProjectState }> {
    const detail: ProjectStateDetail = payload.detail ?? 'summary';
    const includeUsage = payload.includeUsage ?? detail === 'full';
    const snapshot = this.getSnapshot();
    const info = this.projectState.toProjectInfo(snapshot);
    const active = Boolean(info);
    const revision = this.revision.track(snapshot);
    const baseProject = this.projectState.buildProjectState(snapshot, detail, active, revision);
    const resolution = this.editor.getProjectTextureResolution();
    let textureUsage: ProjectState['textureUsage'];
    if (includeUsage) {
      const usage = this.editor.getTextureUsage({});
      if (!usage.error && usage.result) {
        textureUsage = usage.result;
      }
    }
    const project: ProjectState = {
      ...baseProject,
      ...(resolution ? { textureResolution: resolution } : {}),
      ...(textureUsage ? { textureUsage } : {}),
    };
    return ok({ project });
  }

  getProjectDiff(payload: {
    sinceRevision: string;
    detail?: ProjectStateDetail;
  }): UsecaseResult<{ diff: ProjectDiff }> {
    const detail: ProjectStateDetail = payload.detail ?? 'summary';
    const revisionBlankErr = ensureNonBlankString(payload.sinceRevision, 'sinceRevision');
    if (revisionBlankErr) return fail(revisionBlankErr);
    const snapshot = this.getSnapshot();
    const info = this.projectState.toProjectInfo(snapshot);
    if (!info) {
      return fail({ code: 'invalid_state', message: PROJECT_NO_ACTIVE });
    }
    const currentRevision = this.revision.hash(snapshot);
    const previous = this.revision.get(payload.sinceRevision);
    const baseMissing = !previous;
    const emptyBase = {
      ...snapshot,
      bones: [],
      cubes: [],
      meshes: [],
      textures: [],
      animations: [],
      animationsStatus: snapshot.animationsStatus,
    };
    const diffResult = diffSnapshots(previous ?? emptyBase, snapshot, detail === 'full');
    const sets = detail === 'full' ? diffResult.sets : undefined;
    const diff: ProjectDiff = {
      sinceRevision: payload.sinceRevision,
      currentRevision,
      ...(baseMissing ? { baseMissing: true } : {}),
      counts: diffResult.counts,
      ...(sets
        ? {
            bones: sets.bones,
            cubes: sets.cubes,
            meshes: sets.meshes,
            textures: sets.textures,
            animations: sets.animations,
          }
        : {}),
    };
    this.revision.remember(snapshot, currentRevision);
    return ok({ diff });
  }
}
