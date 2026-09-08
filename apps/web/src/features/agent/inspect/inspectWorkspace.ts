import {
  applyWorkspaceChangeSet,
  openAssetProject,
  type AssetProject
} from '@ashfox/engine-core';

import { boundedSuccess } from '../boundedResult';
import {
  createCandidatePreview
} from '../candidatePreview';
import type {
  InspectResult,
  WorkspaceInspectData
} from '../types';
import type {
  InspectRequest
} from '../types';
import { DETAIL_INSPECT_LIMIT } from './inspectResult';
import { inspectWorkspaceCatalog } from './workspaceCatalog';

type WorkspaceRead = NonNullable<Extract<
  InspectRequest,
  { kind: 'workspace' }
>['read']>;
type WorkspaceCandidate = NonNullable<Extract<
  InspectRequest,
  { kind: 'workspace' }
>['candidate']>;

const failure = (
  project: AssetProject,
  code: 'invalid_request' | 'not_found' | 'stale_revision',
  path: string,
  expected: string
): InspectResult => ({
  ok: false,
  revision: project.revision,
  error: { code, path, expected }
});

const boundedWorkspace = (
  project: AssetProject,
  data: WorkspaceInspectData
): InspectResult => boundedSuccess(
  project.revision,
  data,
  DETAIL_INSPECT_LIMIT
);

const readWorkspace = (
  project: AssetProject,
  read: WorkspaceRead
): InspectResult => {
  if (read.expectedWorkspaceHash !== project.build.workspaceHash) {
    return failure(
      project,
      'stale_revision',
      'read.expectedWorkspaceHash',
      project.build.workspaceHash
    );
  }
  const file = project.workspace.files.find((item) => item.path === read.path);
  if (file === undefined) return failure(
    project,
    'not_found',
    'read.path',
    'an existing workspace file path'
  );
  if (read.offset > file.source.length) return failure(
    project,
    'invalid_request',
    'read.offset',
    `an offset <= ${file.source.length}`
  );
  const end = Math.min(file.source.length, read.offset + read.maxCodeUnits);
  return boundedWorkspace(project, {
    kind: 'workspace',
    valid: true,
    diagnostics: [],
    sourceChunk: {
      workspaceHash: project.build.workspaceHash,
      path: file.path,
      offset: read.offset,
      content: file.source.slice(read.offset, end),
      done: end >= file.source.length,
      totalCodeUnits: file.source.length
    }
  });
};

const candidate = (
  project: AssetProject,
  request: WorkspaceCandidate
): InspectResult => {
  const staged = applyWorkspaceChangeSet(project.workspace, request.changes);
  if (!staged.ok) return boundedWorkspace(project, {
    kind: 'workspace',
    valid: false,
    diagnostics: staged.diagnostics,
    previewToken: null
  });
  const opened = openAssetProject({
    workspace: staged.workspace,
    entry: request.entry,
    identity: {
      id: project.id,
      revision: project.revision,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt
    }
  });
  if (!opened.ok) return boundedWorkspace(project, {
    kind: 'workspace',
    valid: false,
    diagnostics: opened.diagnostics,
    previewToken: null
  });
  const previewToken = createCandidatePreview(project, opened.project);
  return boundedWorkspace(project, {
    kind: 'workspace',
    valid: true,
    diagnostics: [],
    previewToken
  });
};

/** Inspect a bounded workspace read or build an isolated transient candidate. */
export const inspectWorkspace = (
  project: AssetProject,
  request: Extract<InspectRequest, { kind: 'workspace' }>
): InspectResult => {
  if (request.catalog !== undefined || request.document !== undefined) return inspectWorkspaceCatalog(project, request);
  if (request.read !== undefined) return readWorkspace(project, request.read);
  if (request.candidate === undefined) return failure(
    project,
    'invalid_request',
    '$',
    'exactly one of read, candidate, catalog, or document'
  );
  return candidate(project, request.candidate);
};
