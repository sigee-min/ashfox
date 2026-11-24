import {
  hasExactContractKeys,
  isCanonicalIsoDate,
  isClosedContractRecord,
  isNonEmptyContractText,
  isUniqueContractTextArray,
} from '@ashfox/internal-contracts';

import { INVARIANT_SEVERITIES } from '../../validation/contract';
import {
  COMMAND_INVALIDATED_AREAS,
  COMMAND_RECEIPT_SCHEMA_VERSION,
  COMMAND_SOURCES,
  type CommandEffects,
  type CommandReceipt,
} from '../types';

const RECEIPT_KEYS = new Set([
  'schemaVersion',
  'commandId',
  'projectId',
  'actorId',
  'source',
  'summary',
  'beforeRevision',
  'revision',
  'completedAt',
  'durationMs',
  'effects',
  'findings',
]);
const EFFECT_KEYS = new Set([
  'createdEntityIds',
  'changedEntityIds',
  'removedEntityIds',
  'invalidated',
]);
const FINDING_REQUIRED_KEYS = ['code', 'severity', 'message', 'path'] as const;
const FINDING_OPTIONAL_KEYS = ['entityIds', 'assetIds', 'clipIds', 'fix'] as const;

const isCommandEffects = (value: unknown): value is CommandEffects => {
  if (!isClosedContractRecord(value) || !hasExactContractKeys(value, EFFECT_KEYS)) {
    return false;
  }
  if (
    !isUniqueContractTextArray(value.createdEntityIds) ||
    !isUniqueContractTextArray(value.changedEntityIds) ||
    !isUniqueContractTextArray(value.removedEntityIds) ||
    !isUniqueContractTextArray(value.invalidated)
  ) {
    return false;
  }
  return value.invalidated.every((area) =>
    COMMAND_INVALIDATED_AREAS.includes(area as (typeof COMMAND_INVALIDATED_AREAS)[number]),
  );
};

const isInvariantFinding = (value: unknown): boolean => {
  if (!isClosedContractRecord(value)) return false;
  const expectedKeys = new Set<string>(FINDING_REQUIRED_KEYS);
  for (const key of FINDING_OPTIONAL_KEYS) {
    if (key in value) expectedKeys.add(key);
  }
  if (!hasExactContractKeys(value, expectedKeys)) return false;
  if (
    !isNonEmptyContractText(value.code) ||
    !INVARIANT_SEVERITIES.includes(value.severity as (typeof INVARIANT_SEVERITIES)[number]) ||
    !isNonEmptyContractText(value.message) ||
    typeof value.path !== 'string'
  ) {
    return false;
  }
  for (const key of ['entityIds', 'assetIds', 'clipIds'] as const) {
    if (key in value && value[key] !== undefined && !isUniqueContractTextArray(value[key])) {
      return false;
    }
  }
  return !('fix' in value) || value.fix === undefined || isNonEmptyContractText(value.fix);
};

export const isValidCommandReceipt = (
  value: unknown,
  expectedProjectId?: string,
): value is CommandReceipt => {
  if (
    !isClosedContractRecord(value) ||
    !hasExactContractKeys(value, RECEIPT_KEYS) ||
    value.schemaVersion !== COMMAND_RECEIPT_SCHEMA_VERSION ||
    !isNonEmptyContractText(value.commandId) ||
    !isNonEmptyContractText(value.projectId) ||
    !isNonEmptyContractText(value.actorId) ||
    !COMMAND_SOURCES.includes(value.source as (typeof COMMAND_SOURCES)[number]) ||
    !isNonEmptyContractText(value.summary) ||
    !isNonEmptyContractText(value.beforeRevision) ||
    !isNonEmptyContractText(value.revision) ||
    !isCanonicalIsoDate(value.completedAt) ||
    typeof value.durationMs !== 'number' ||
    !Number.isFinite(value.durationMs) ||
    value.durationMs < 0 ||
    !isCommandEffects(value.effects) ||
    !Array.isArray(value.findings) ||
    !value.findings.every(isInvariantFinding)
  ) {
    return false;
  }
  return expectedProjectId === undefined || value.projectId === expectedProjectId;
};

export interface CommandReceiptLedgerOptions {
  projectId: string;
  maxEntries: number;
}

export const isValidCommandReceiptLedger = (
  value: unknown,
  options: CommandReceiptLedgerOptions,
): value is readonly CommandReceipt[] => {
  if (
    !Array.isArray(value) ||
    !Number.isSafeInteger(options.maxEntries) ||
    options.maxEntries < 0 ||
    value.length > options.maxEntries
  ) {
    return false;
  }
  const commandIds = new Set<string>();
  let previousCompletedAt: string | null = null;
  for (const entry of value) {
    if (!isValidCommandReceipt(entry, options.projectId)) return false;
    if (commandIds.has(entry.commandId)) return false;
    if (previousCompletedAt !== null && previousCompletedAt < entry.completedAt) {
      return false;
    }
    commandIds.add(entry.commandId);
    previousCompletedAt = entry.completedAt;
  }
  return true;
};
