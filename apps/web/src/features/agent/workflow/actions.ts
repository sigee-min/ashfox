import {
  listAgentCommandDefinitions,
  type ProjectCommandOperation,
  type ProjectDocument
} from '@ashfox/engine-core';

import type { VisualReviewReceipt } from '../../../application/review';
import type {
  InspectWorkflowAction,
  InspectWorkflowStage,
  ReadinessFinding
} from './inspectWorkflowTypes';

interface DerivedWorkflowActions {
  exactOperation: ProjectCommandOperation | null;
  nextActions: readonly InspectWorkflowAction[];
}

const registeredAgentCommands = new Set(
  listAgentCommandDefinitions().map((definition) => definition.name)
);

const command = (
  name: ProjectCommandOperation['name']
): readonly InspectWorkflowAction[] =>
  registeredAgentCommands.has(name)
    ? [{ kind: 'command', name }]
    : [];

const startAction = (): readonly InspectWorkflowAction[] =>
  command('workspace.apply');

/** Derive the closed next-command set from the current workflow stage. */
export const deriveWorkflowActions = (
  _document: ProjectDocument,
  stage: InspectWorkflowStage,
  _blocker: ReadinessFinding | null,
  rejectedReview: VisualReviewReceipt | null
): DerivedWorkflowActions => {
  if (rejectedReview !== null) {
    return { exactOperation: null, nextActions: command('workspace.apply') };
  }
  if (stage === 'start') {
    return { exactOperation: null, nextActions: startAction() };
  }
  if (stage === 'review') {
    return {
      exactOperation: null,
      nextActions: [{ kind: 'present', request: { review: 'next' } }]
    };
  }
  if (stage === 'deliver') return { exactOperation: null, nextActions: [] };
  return {
    exactOperation: null,
    nextActions: command('workspace.apply')
  };
};

export const fallbackWorkflowFix = (
  stage: InspectWorkflowStage,
  actions: readonly InspectWorkflowAction[]
): string => {
  const first = actions[0];
  if (first?.kind === 'command' && first.name === 'workspace.apply') {
    return 'Revise one complete workspace change set and apply it atomically.';
  }
  if (first?.kind === 'command') {
    return `Correct the project setup with ${first.name}, then inspect again.`;
  }
  if (stage === 'review') {
    return 'Present the next compiled review frame, inspect its evidence, and autonomously continue or revise the source; the human remains observation-only.';
  }
  if (stage === 'deliver') {
    return 'Tell the user to choose an export adapter in the Export menu. Target delivery settings are user-owned and never change the canonical asset.';
  }
  return 'Inspect the blocker and revise the workspace entry if output is incomplete.';
};
