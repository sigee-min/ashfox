import assert from 'node:assert/strict';
import { executeAgentCommandBatch, validateProjectDocument, type AssetProject } from '@ashfox/engine-core';
import { inspectProject } from '../../src/features/agent/inspect';
import type { InspectWorkflowGuidance } from '../../src/features/agent/workflow/inspectWorkflowTypes';
import { requiredVisualReviews } from '../../src/features/agent/visualReviewPlan';
import { createBlankWorkbenchProject } from '../../src/features/workbench/newProject';
import { createVisualReviewReceiptFixture } from '../fixtures/review';
import type { VisualReviewReceipt } from '../../src/application/review';

const overview = (project: AssetProject, receipts: readonly VisualReviewReceipt[] = []) => {
  const result = inspectProject(project, null, validateProjectDocument(project.document),
    undefined, [], {}, receipts);
  assert.ok(result.ok);
  if (!result.ok) throw new Error('Overview failed.');
  return result.data as {
    blocker: InspectWorkflowGuidance['blocker'];
    nextActions: InspectWorkflowGuidance['nextActions'];
    workflow: Omit<InspectWorkflowGuidance, 'blocker' | 'nextActions'>;
  };
};

const starter = createBlankWorkbenchProject('2026-09-08T00:00:00.000Z');
const initial = overview(starter);
assert.equal(initial.blocker, null, 'A compiled starter needs no unavailable project.create command.');
assert.equal(initial.workflow.stage, 'review');
assert.equal(initial.workflow.remainingVisualReviewCount, 6);
assert.equal(initial.workflow.remainingVisualReviews.length, 6);
assert.equal(initial.workflow.visualReviewsTruncated, false);

const file = starter.workspace.files[0]!;
const applied = executeAgentCommandBatch(starter, {
  batchId: 'starter-edit', baseProjectId: starter.id, baseRevision: starter.revision,
  operations: [{ name: 'workspace.apply', payload: { entry: starter.entry, changes: {
    expectedWorkspaceHash: starter.build.workspaceHash, deletes: [],
    writes: [{ path: file.path, source: file.source.replace('seed = 23;', 'seed = 24;') }]
  } } }]
});
assert.ok(applied.ok);
if (!applied.ok) throw new Error('Starter edit failed.');
assert.equal(applied.project.id, starter.id, 'Editing preserves the host project identity.');
assert.equal(overview(applied.project).blocker, null, 'The starter identity never traps a successful edit.');

const reviews = requiredVisualReviews(applied.project.document).map((item, index) =>
  createVisualReviewReceiptFixture(applied.project, { ...item, frameNonce: index + 1 }));
for (let count = 0; count <= reviews.length; count += 1) {
  const state = overview(applied.project, reviews.slice(0, count));
  assert.equal(state.workflow.remainingVisualReviewCount, reviews.length - count);
  assert.equal(state.workflow.stage, count === reviews.length ? 'deliver' : 'review');
  assert.equal(state.nextActions.length, count === reviews.length ? 0 : 1);
}
assert.equal(overview(starter, reviews).workflow.remainingVisualReviewCount, 6,
  'Review progress belongs to the exact workspace/build identity.');
const rejected = createVisualReviewReceiptFixture(applied.project, { verdict: 'rejected' });
assert.equal(overview(applied.project, [rejected]).blocker?.code, 'review.rejected');
assert.deepEqual(overview(applied.project, [rejected]).nextActions,
  [{ kind: 'command', name: 'workspace.apply' }],
  'A rejected review requires source revision, not another doomed presentation.');

const longName = 'p'.repeat(502);
const renamed = executeAgentCommandBatch(starter, {
  batchId: 'long-package', baseProjectId: starter.id, baseRevision: starter.revision,
  operations: [{ name: 'workspace.apply', payload: {
    entry: { ...starter.entry, packageName: longName },
    changes: {
      expectedWorkspaceHash: starter.build.workspaceHash, writes: [], deletes: [],
      manifest: { ...starter.workspace.manifest,
        packages: starter.workspace.manifest.packages.map((pkg) => ({ ...pkg, name: longName })) }
    }
  } }]
});
assert.ok(renamed.ok, 'A valid longer package name compiles.');
if (!renamed.ok) throw new Error('Long package edit failed.');
assert.equal(overview(renamed.project).workflow.remainingVisualReviewCount, 6,
  'Adding workflow progress must not prevent reading valid current project guards.');
console.log('starter workspace and revision-bound public review progress ok');
