import assert from 'node:assert/strict';

import {
  computeWorkspaceHash,
  validateProjectDocument
} from '@ashfox/engine-core';

import { inspectProject } from '../../src/features/agent/inspect';
import { parseInspectRequest } from '../../src/features/agent/parseInspectRequest';
import type { WorkspaceInspectData } from '../../src/features/agent/types';
import {
  candidatePreviewFor,
  createCandidatePreview
} from '../../src/features/agent/candidatePreview';
import { createWorkbenchProject } from '../fixtures/project';

const project = createWorkbenchProject();
const report = validateProjectDocument(project.document);
const overview = inspectProject(project, null, report);
assert.equal(overview.ok, true);
if (!overview.ok) throw new Error('workspace overview failed');
const overviewData = overview.data as {
  workspaceHash: string;
  entry: unknown;
  build: { productHash: string };
  source?: unknown;
};
assert.equal(overviewData.workspaceHash, project.build.workspaceHash);
assert.deepEqual(overviewData.entry, project.entry);
assert.equal(overviewData.build.productHash, project.build.productHash);
assert.equal(Object.hasOwn(overviewData, 'source'), false,
  'overview must never return workspace source bytes');

const path = project.workspace.files[0]!.path;
const parsedRead = parseInspectRequest({
  kind: 'workspace',
  read: {
    expectedWorkspaceHash: project.build.workspaceHash,
    path,
    offset: 0,
    maxCodeUnits: 32
  }
});
assert.equal(parsedRead.ok, true);
if (!parsedRead.ok || parsedRead.request === undefined) {
  throw new Error('workspace read request did not parse');
}
const read = inspectProject(project, null, report, parsedRead.request);
assert.equal(read.ok, true);
if (!read.ok) throw new Error('workspace read failed');
const chunk = (read.data as WorkspaceInspectData).sourceChunk;
assert.equal(chunk?.workspaceHash, project.build.workspaceHash);
assert.equal(chunk?.path, path);
assert.equal(chunk?.content, project.workspace.files[0]!.source.slice(0, 32));

const staleRead = inspectProject(project, null, report, {
  kind: 'workspace',
  read: {
    expectedWorkspaceHash: `sha256:${'0'.repeat(64)}`,
    path,
    offset: 0,
    maxCodeUnits: 32
  }
});
assert.equal(staleRead.ok, false);
if (!staleRead.ok) assert.equal(staleRead.error.path,
  'read.expectedWorkspaceHash');

const candidate = inspectProject(project, null, report, {
  kind: 'workspace',
  candidate: {
    entry: project.entry,
    changes: {
      expectedWorkspaceHash: computeWorkspaceHash(project.workspace),
      writes: [],
      deletes: []
    }
  }
});
assert.equal(candidate.ok, true);
if (!candidate.ok) throw new Error('workspace candidate failed');
const token = (candidate.data as WorkspaceInspectData).previewToken;
assert.equal(typeof token, 'string');
if (typeof token !== 'string') throw new Error('candidate token missing');
const preview = candidatePreviewFor(project, token);
assert.ok(preview);
assert.equal(preview?.build.productHash, project.build.productHash);

const lruTokens = Array.from({ length: 9 }, () =>
  createCandidatePreview(project, project)
);
assert.ok(lruTokens.every((entry): entry is string => typeof entry === 'string'));
assert.equal(
  candidatePreviewFor(project, lruTokens[0]!),
  null,
  'candidate previews use a bounded LRU instead of wall-clock expiry'
);
assert.ok(candidatePreviewFor(project, lruTokens.at(-1)!));

for (const invalid of [
  { kind: 'workspace' },
  { kind: 'workspace', read: {}, candidate: {} },
  { kind: 'workspace', read: {
    expectedWorkspaceHash: project.build.workspaceHash,
    path,
    offset: 0,
    maxCodeUnits: 2049
  } },
  { kind: 'unknown-inspect-surface', value: 'forbidden' }
]) assert.equal(parseInspectRequest(invalid).ok, false,
  'unknown or open workspace request surfaces must fail closed');

console.log('workspace overview, bounded read, and isolated candidate inspect ok');
