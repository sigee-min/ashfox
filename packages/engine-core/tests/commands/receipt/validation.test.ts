import assert from 'node:assert/strict';

import {
  COMMAND_RECEIPT_SCHEMA_VERSION,
  isValidCommandReceipt,
  isValidCommandReceiptLedger,
  type CommandReceipt,
} from '../../../src';

const receipt = (commandId: string, completedAt: string): CommandReceipt => ({
  schemaVersion: COMMAND_RECEIPT_SCHEMA_VERSION,
  commandId,
  projectId: 'project-receipt-contract',
  actorId: 'agent-contract',
  source: 'agent',
  summary: 'Applied a canonical command.',
  beforeRevision: 'local-0001',
  revision: 'local-0002',
  completedAt,
  durationMs: 4.5,
  effects: {
    createdEntityIds: ['cube-new'],
    changedEntityIds: [],
    removedEntityIds: [],
    invalidated: ['scene', 'preview'],
  },
  findings: [
    {
      code: 'document.required_value',
      severity: 'warning',
      message: 'Review the generated name.',
      path: 'name',
      entityIds: ['cube-new'],
    },
  ],
});

const current = receipt('command-current', '2026-08-06T03:00:00.000Z');
const older = receipt('command-older', '2026-08-06T02:00:00.000Z');

assert.equal(isValidCommandReceipt(current), true);
assert.equal(isValidCommandReceipt(current, 'project-receipt-contract'), true);
assert.equal(isValidCommandReceipt(current, 'project-foreign'), false);
assert.equal(isValidCommandReceipt({ ...current, schemaVersion: 2 }), false);
assert.equal(isValidCommandReceipt({ ...current, source: 'external' }), false);
assert.equal(isValidCommandReceipt({ ...current, completedAt: '2026-08-06' }), false);
assert.equal(
  isValidCommandReceipt({
    ...current,
    effects: {
      ...current.effects,
      changedEntityIds: ['cube-new', 'cube-new'],
    },
  }),
  false,
);
assert.equal(isValidCommandReceipt({ ...current, extra: true }), false);
assert.equal(
  isValidCommandReceipt({
    ...current,
    findings: [
      {
        ...current.findings[0],
        severity: 'fatal',
      },
    ],
  }),
  false,
);

assert.equal(
  isValidCommandReceiptLedger([current, older], { projectId: current.projectId, maxEntries: 100 }),
  true,
);
assert.equal(
  isValidCommandReceiptLedger([older, current], { projectId: current.projectId, maxEntries: 100 }),
  false,
);
assert.equal(
  isValidCommandReceiptLedger([current, { ...older, commandId: current.commandId }], {
    projectId: current.projectId,
    maxEntries: 100,
  }),
  false,
);
assert.equal(
  isValidCommandReceiptLedger([current, older], { projectId: current.projectId, maxEntries: 1 }),
  false,
);
