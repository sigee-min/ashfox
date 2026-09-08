import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { applyWorkspaceChangeSet, computeWorkspaceHash, executeAgentCommandBatch, openAssetProject, validateProjectDocument,
  type AuthoredAssetWorkspace, type WorkspaceEntrySelector } from '@ashfox/engine-core';
import { AgentCommandPort } from '../../src/features/agent/AgentCommandPort';
import { inspectProject } from '../../src/features/agent/inspect';
import { candidatePreviewFor } from '../../src/features/agent/candidatePreview';
import { createCommandReceipt } from '../../src/application/createCommandReceipt';
import type { InspectRequest, WorkspaceInspectData } from '../../src/features/agent/types';
import { FRAME_EVIDENCE_FIXTURE } from '../fixtures/frame';

export const test = (async () => {
  // Host setup loads a real closed multi-file product. The client below only uses the port.
  const workspace: AuthoredAssetWorkspace = JSON.parse(readFileSync(resolve(__dirname,
    '../../../../examples/shared-creatures.ashfoxworkspace'), 'utf8'));
  const entryPackage = workspace.manifest.packages.find((pkg) => pkg.manifest.entries.length > 0)!;
  const entryPath = `${entryPackage.root}/${entryPackage.manifest.entries[0]!.path}`;
  const entryFile = workspace.files.find((file) => file.path === entryPath)!;
  const withDependency = applyWorkspaceChangeSet(workspace, {
    expectedWorkspaceHash: computeWorkspaceHash(workspace), deletes: [],
    manifest: { ...workspace.manifest, packages: [
      ...workspace.manifest.packages.map((pkg) => pkg.name === entryPackage.name
        ? { ...pkg, manifest: { ...pkg.manifest, dependencies: [...pkg.manifest.dependencies, { name: 'precision' }] } } : pkg),
      { name: 'precision', root: 'precision', manifest: { format: 'ashfox-package', version: 1,
        entries: [], modules: [{ subpath: './constants', path: 'constants.ashfox' }], dependencies: [] } }
    ] }, writes: [
      { path: entryPath, source: entryFile.source.replace(/(asset \w+ \{)/,
        '$1 import "precision/constants" as constants;') },
      { path: 'precision/constants.ashfox', source: 'ashfox-model 1 module constants { export design D { value: integer = 1; } }' }
    ]
  });
  assert.ok(withDependency.ok, withDependency.ok ? '' : JSON.stringify(withDependency.diagnostics));
  if (!withDependency.ok) return;
  const embedded: AuthoredAssetWorkspace = { ...withDependency.workspace,
    manifest: { ...withDependency.workspace.manifest, packages: withDependency.workspace.manifest.packages.filter((pkg) => pkg.name !== 'precision') },
    lock: { ...withDependency.workspace.lock, packages: withDependency.workspace.lock.packages.map((pkg) => pkg.name === 'precision'
      ? { ...pkg, source: 'cas', digest: pkg.contentHash } : pkg) }
  };
  const opened = openAssetProject({ workspace: embedded,
    entry: { packageName: entryPackage.name, entryName: entryPackage.manifest.entries[0]!.name },
    identity: { id: 'agent-flow', revision: 'flow-1', createdAt: '2026-09-10T00:00:00.000Z' } });
  assert.ok(opened.ok, opened.ok ? '' : JSON.stringify(opened.diagnostics));
  if (!opened.ok) return;
  let project = opened.project;
  let presentations = 0;
  const port = new AgentCommandPort({
    currentProjectId: () => project.id, currentRevision: () => project.revision,
    inspect: (request) => inspectProject(project, null, validateProjectDocument(project.document), request),
    submit: async (batch) => {
      const beforeRevision = project.revision;
      const applied = executeAgentCommandBatch(project, batch);
      if (!applied.ok) return { status: 'rejected', commandId: batch.batchId,
        revision: project.revision, error: applied.error };
      project = applied.project;
      return { status: 'committed', commandId: batch.batchId, receipt: createCommandReceipt({
        commandId: batch.batchId, projectId: project.id, source: 'agent', actorId: 'test',
        summary: applied.summary, beforeRevision, revision: project.revision,
        completedAt: '2026-09-10T00:00:01.000Z', effects: applied.effects, findings: applied.findings }) };
    },
    present: async (request) => {
      assert.equal(request.review, 'preview');
      assert.ok(request.review === 'preview' && request.previewToken && candidatePreviewFor(project, request.previewToken));
      presentations += 1;
      // Fake renderer boundary: validates the isolated candidate, never asserts visual quality.
      return { ok: true, revision: project.revision, data: { review: 'preview', purpose: 'preview',
        verdict: 'pending', issues: [], acknowledgedCheckIds: [], failedCheckIds: [], frameNonce: 1,
        mode: 'frame', camera: 'native', cameraMatrix: [], frameEvidence: FRAME_EVIDENCE_FIXTURE,
        clipId: null, playing: false, observedTimeSeconds: 0, completedCycles: 0, reviewChecks: [] } };
    }
  });
  const data = (request?: InspectRequest): unknown => {
    const result = port.inspect(request);
    assert.ok(result.ok, result.ok ? '' : JSON.stringify(result.error));
    return result.ok ? result.data : null;
  };
  const current = () => data() as { revision: string; workspaceHash: `sha256:${string}`;
    entry: WorkspaceEntrySelector; build: { buildKey: string } };
  const initial = current();
  const catalog: NonNullable<WorkspaceInspectData['catalog']>['files'][number][] = [];
  let cursor: number | null = 0;
  while (cursor !== null) {
    const page: NonNullable<WorkspaceInspectData['catalog']> = (data({ kind: 'workspace', catalog: { expectedWorkspaceHash: initial.workspaceHash,
      offset: cursor, limit: 1 } }) as WorkspaceInspectData).catalog!;
    catalog.push(...page.files); cursor = page.nextOffset;
  }
  assert.ok(catalog.length > 1);
  assert.deepEqual(catalog.map((file) => file.path), catalog.map((file) => file.path).sort());
  const terminal = (data({ kind: 'workspace', catalog: { expectedWorkspaceHash: initial.workspaceHash,
    offset: catalog.length, limit: 1 } }) as WorkspaceInspectData).catalog!;
  assert.deepEqual(terminal.files, []);
  assert.equal(terminal.nextOffset, null);
  assert.equal(port.inspect({ kind: 'workspace', catalog: { expectedWorkspaceHash: initial.workspaceHash,
    offset: catalog.length + 1, limit: 1 } }).ok, false);
  const casRow = catalog.find((file) => file.source === 'cas');
  assert.equal(casRow?.packageName, 'precision');
  assert.equal(casRow?.kind, 'module');
  const readSource = (path: string, hash: string): string => {
    let text = ''; let done = false;
    while (!done) {
      const chunk = (data({ kind: 'workspace', read: { expectedWorkspaceHash: hash,
        path, offset: text.length, maxCodeUnits: 512 } }) as WorkspaceInspectData).sourceChunk!;
      text += chunk.content; done = chunk.done;
    }
    return text;
  };
  const readDocument = (document: 'manifest' | 'lock', hash: string): string => {
    let text = ''; let done = false;
    while (!done) {
      const chunk = (data({ kind: 'workspace', document: { expectedWorkspaceHash: hash,
        document, offset: text.length, maxCodeUnits: 512 } }) as WorkspaceInspectData).documentChunk!;
      text += chunk.content; done = chunk.done;
    }
    return text;
  };
  const manifestBefore = readDocument('manifest', initial.workspaceHash);
  const lockBefore = readDocument('lock', initial.workspaceHash);
  const terminalDocument = (data({ kind: 'workspace', document: { expectedWorkspaceHash: initial.workspaceHash,
    document: 'manifest', offset: manifestBefore.length, maxCodeUnits: 32 } }) as WorkspaceInspectData).documentChunk!;
  assert.equal(terminalDocument.content, '');
  assert.equal(terminalDocument.done, true);
  assert.equal(port.inspect({ kind: 'workspace', document: { expectedWorkspaceHash: initial.workspaceHash,
    document: 'manifest', offset: manifestBefore.length + 1, maxCodeUnits: 32 } }).ok, false);
  const sources = catalog.map((file) => ({ ...file, sourceText: readSource(file.path, initial.workspaceHash) }));
  const target = sources.find((file) => /seed = \d+;/.test(file.sourceText) && file.source === 'workspace')!;
  assert.ok(target);
  assert.equal(target.sourceText.length, target.codeUnits);
  const changed = target.sourceText.replace(/seed = (\d+);/, (_, seed: string) => `seed = ${Number(seed) + 1};`);
  const changes = { expectedWorkspaceHash: initial.workspaceHash,
    writes: [{ path: target.path, expectedHash: target.contentHash as `sha256:${string}`, source: changed }], deletes: [] };
  const candidate = data({ kind: 'workspace', candidate: { entry: initial.entry, changes } }) as WorkspaceInspectData;
  assert.equal(candidate.valid, true, JSON.stringify(candidate.diagnostics));
  assert.ok(candidate.previewToken);
  assert.equal(current().workspaceHash, initial.workspaceHash, 'candidate is isolated');
  assert.equal((await port.present({ review: 'preview', camera: 'native', previewToken: candidate.previewToken! })).ok, true);
  assert.equal(presentations, 1);
  const applied = await port.run({ requestId: 'edit-seed', operations: [{ name: 'workspace.apply',
    payload: { entry: initial.entry, changes } }] });
  assert.ok(applied.ok, applied.ok ? '' : JSON.stringify(applied.error));
  const updated = current();
  assert.notEqual(updated.workspaceHash, initial.workspaceHash);
  assert.equal(readSource(target.path, updated.workspaceHash), changed);
  assert.equal(readDocument('manifest', updated.workspaceHash), manifestBefore);
  assert.notEqual(readDocument('lock', updated.workspaceHash), lockBefore, 'engine reseals lock');
  const casRecord = (text: string): unknown => (JSON.parse(text) as { packages: { source: string }[] }).packages.filter((pkg) => pkg.source === 'cas');
  assert.deepEqual(casRecord(readDocument('lock', updated.workspaceHash)), casRecord(lockBefore));
  const casWrite = await port.run({ requestId: 'reject-cas-edit', operations: [{ name: 'workspace.apply',
    payload: { entry: updated.entry, changes: { expectedWorkspaceHash: updated.workspaceHash,
      writes: [{ path: casRow!.path, source: 'ashfox-model 1 module constants {}' }], deletes: [] } } }] });
  assert.equal(casWrite.ok, false);
  assert.equal(current().workspaceHash, updated.workspaceHash);
  for (const request of [
    { kind: 'workspace', catalog: { expectedWorkspaceHash: initial.workspaceHash, offset: 0, limit: 1 } },
    { kind: 'workspace', document: { expectedWorkspaceHash: initial.workspaceHash, document: 'manifest', offset: 0, maxCodeUnits: 32 } },
    { kind: 'workspace', read: { expectedWorkspaceHash: initial.workspaceHash, path: target.path, offset: 0, maxCodeUnits: 32 } }
  ] satisfies InspectRequest[]) {
    const result = port.inspect(request);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, 'stale_revision');
  }
  const guard = { expectedRevision: updated.revision, expectedWorkspaceHash: updated.workspaceHash,
    expectedBuildKey: updated.build.buildKey };
  const nodes = data({ kind: 'nodes', ...guard, offset: 0, limit: 1 }) as {
    evidence: { nodes: { id: string }[] } };
  assert.ok(nodes.evidence.nodes[0]);
  assert.ok(data({ kind: 'measurement', ...guard, nodeId: nodes.evidence.nodes[0]!.id,
    scope: 'subtree', groundY: 0, tolerance: 0.001 }));
  const invalids: unknown[] = [
    { kind: 'workspace', catalog: { expectedWorkspaceHash: updated.workspaceHash, offset: 0, limit: 33 } },
    { kind: 'workspace', document: { expectedWorkspaceHash: updated.workspaceHash, document: 'manifest', offset: 0, maxCodeUnits: 2049 } },
    { kind: 'workspace', catalog: { expectedWorkspaceHash: updated.workspaceHash, offset: 0, limit: 1, extra: true } },
    { kind: 'workspace', candidate: { entry: initial.entry, changes: { ...changes, lock: JSON.parse(lockBefore) } } },
    { kind: 'workspace', catalog: { expectedWorkspaceHash: updated.workspaceHash, offset: 0, limit: 1 }, document: {} }
  ];
  for (const invalid of invalids) assert.equal(port.inspect(invalid as InspectRequest).ok, false);
  assert.equal(current().workspaceHash, updated.workspaceHash);
  console.log('public agent port discovers, chunks, previews, applies lock-free source edits and remeasures');
})();
