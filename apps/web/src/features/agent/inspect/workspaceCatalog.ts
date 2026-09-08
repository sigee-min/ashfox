import { canonicalJsonString, type AssetProject } from '@ashfox/engine-core';
import { boundedSuccess } from '../boundedResult';
import type { InspectRequest, InspectResult, WorkspaceInspectData } from '../types';
import { DETAIL_INSPECT_LIMIT } from './inspectResult';

type WorkspaceRequest = Extract<InspectRequest, { kind: 'workspace' }>;

export const inspectWorkspaceCatalog = (
  project: AssetProject, request: WorkspaceRequest
): InspectResult => {
  const input = request.catalog ?? request.document;
  const selector = request.catalog ? 'catalog' : 'document';
  const fail = (code: 'invalid_request' | 'stale_revision', path: string, expected: string): InspectResult =>
    ({ ok: false, revision: project.revision, error: { code, path, expected } });
  if (!input) return fail('invalid_request', '$', 'catalog or document');
  if (input.expectedWorkspaceHash !== project.build.workspaceHash) return fail(
    'stale_revision', `${selector}.expectedWorkspaceHash`, project.build.workspaceHash);
  let data: WorkspaceInspectData;
  if (request.document) {
    const read = request.document;
    const source = canonicalJsonString(project.workspace[read.document]);
    if (read.offset > source.length) return fail('invalid_request', 'document.offset', `offset <= ${source.length}`);
    const end = Math.min(source.length, read.offset + read.maxCodeUnits);
    data = { kind: 'workspace', valid: true, diagnostics: [], documentChunk: {
      workspaceHash: project.build.workspaceHash, document: read.document, offset: read.offset,
      content: source.slice(read.offset, end), done: end === source.length, totalCodeUnits: source.length } };
  } else {
    const read = request.catalog!;
    const sourceFiles = new Map(project.workspace.files.map((file) => [file.path, file]));
    const files = project.workspace.lock.packages.flatMap((pkg) => pkg.files.map((file) => ({
      path: file.path, contentHash: file.contentHash, codeUnits: sourceFiles.get(file.path)?.source.length ?? 0,
      packageName: pkg.name, source: pkg.source,
      kind: pkg.manifest.entries.some((entry) => (pkg.root === '' ? entry.path : `${pkg.root}/${entry.path}`) === file.path)
        ? 'entry' as const : 'module' as const
    }))).sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
    if (read.offset > files.length) return fail('invalid_request', 'catalog.offset', `offset <= ${files.length}`);
    const end = Math.min(files.length, read.offset + read.limit);
    data = { kind: 'workspace', valid: true, diagnostics: [], catalog: {
      workspaceHash: project.build.workspaceHash, files: files.slice(read.offset, end),
      total: files.length, offset: read.offset, nextOffset: end < files.length ? end : null } };
  }
  return boundedSuccess(project.revision, data, DETAIL_INSPECT_LIMIT);
};
