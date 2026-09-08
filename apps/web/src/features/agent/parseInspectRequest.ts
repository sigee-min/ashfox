import {
  readExportAdapterInput,
  readWorkspaceManifest,
  type WorkspaceChangeSet,
  type WorkspaceEntrySelector
} from '@ashfox/engine-core';

import type {
  InspectFailure,
  InspectRequest,
  ParseInspectRequestResult
} from './types';
import { parseMeasurement } from './parseMeasurement';

interface ParseInspectRequestFailure {
  ok: false;
  error: InspectFailure['error'];
}

export type { ParseInspectRequestResult } from './types';

const isRecord = (
  value: unknown
): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const failure = (
  path: string,
  expected: string
): ParseInspectRequestFailure => ({
  ok: false,
  error: { code: 'invalid_request', path, expected }
});

const rejectUnknownProperties = (
  value: Readonly<Record<string, unknown>>,
  allowed: readonly string[]
): ParseInspectRequestFailure | null => {
  const property = Object.keys(value).find((key) => !allowed.includes(key));
  return property === undefined
    ? null
    : failure(property, 'no additional properties');
};

const WORKSPACE_HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;
export const MAX_WORKSPACE_READ_CODE_UNITS = 2_048;

const isHash = (value: unknown): value is `sha256:${string}` =>
  typeof value === 'string' && WORKSPACE_HASH_PATTERN.test(value);

const isNonEmptyText = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.trim() === value;

const isParseFailure = (
  value: unknown
): value is ParseInspectRequestFailure => isRecord(value) &&
  value.ok === false && isRecord(value.error);

type WorkspaceReadRequest = NonNullable<Extract<
  InspectRequest,
  { kind: 'workspace' }
>['read']>;

const parseWorkspaceRead = (
  value: unknown
): WorkspaceReadRequest | ParseInspectRequestFailure => {
  if (!isRecord(value)) return failure('read', 'workspace read object');
  const unknown = rejectUnknownProperties(value, [
    'expectedWorkspaceHash', 'path', 'offset', 'maxCodeUnits'
  ]);
  if (unknown) return unknown;
  if (!isHash(value.expectedWorkspaceHash)) {
    return failure('read.expectedWorkspaceHash', 'sha256 workspace hash');
  }
  if (!isNonEmptyText(value.path)) {
    return failure('read.path', 'non-empty normalized workspace path');
  }
  if (typeof value.offset !== 'number' ||
    !Number.isSafeInteger(value.offset) || value.offset < 0) {
    return failure('read.offset', 'non-negative safe integer code-unit offset');
  }
  if (typeof value.maxCodeUnits !== 'number' ||
    !Number.isSafeInteger(value.maxCodeUnits) ||
    value.maxCodeUnits < 1 ||
    value.maxCodeUnits > MAX_WORKSPACE_READ_CODE_UNITS) {
    return failure(
      'read.maxCodeUnits',
      `positive integer <= ${MAX_WORKSPACE_READ_CODE_UNITS}`
    );
  }
  return {
    expectedWorkspaceHash: value.expectedWorkspaceHash,
    path: value.path,
    offset: value.offset,
    maxCodeUnits: value.maxCodeUnits
  };
};

const parseWrite = (
  value: unknown,
  index: number
): WorkspaceChangeSet['writes'][number] | ParseInspectRequestFailure => {
  if (!isRecord(value)) return failure(
    `candidate.changes.writes[${index}]`,
    'workspace file write object'
  );
  const unknown = rejectUnknownProperties(value, [
    'path', 'source', 'expectedHash'
  ]);
  if (unknown) return unknown;
  if (!isNonEmptyText(value.path)) return failure(
    `candidate.changes.writes[${index}].path`,
    'non-empty normalized workspace path'
  );
  if (typeof value.source !== 'string') return failure(
    `candidate.changes.writes[${index}].source`,
    'workspace source text'
  );
  if (value.expectedHash !== undefined && value.expectedHash !== null &&
    !isHash(value.expectedHash)) return failure(
    `candidate.changes.writes[${index}].expectedHash`,
    'sha256 file hash or null'
  );
  return {
    path: value.path,
    source: value.source,
    ...(value.expectedHash !== undefined
      ? { expectedHash: value.expectedHash }
      : {})
  };
};

const parseDelete = (
  value: unknown,
  index: number
): WorkspaceChangeSet['deletes'][number] | ParseInspectRequestFailure => {
  if (!isRecord(value)) return failure(
    `candidate.changes.deletes[${index}]`,
    'workspace file delete object'
  );
  const unknown = rejectUnknownProperties(value, ['path', 'expectedHash']);
  if (unknown) return unknown;
  if (!isNonEmptyText(value.path)) return failure(
    `candidate.changes.deletes[${index}].path`,
    'non-empty normalized workspace path'
  );
  if (value.expectedHash !== undefined && !isHash(value.expectedHash)) return failure(
    `candidate.changes.deletes[${index}].expectedHash`,
    'sha256 file hash'
  );
  return { path: value.path, ...(value.expectedHash !== undefined ? { expectedHash: value.expectedHash } : {}) };
};

const parseWorkspaceChanges = (
  value: unknown
): WorkspaceChangeSet | ParseInspectRequestFailure => {
  if (!isRecord(value)) return failure(
    'candidate.changes',
    'workspace change set object'
  );
  const unknown = rejectUnknownProperties(value, [
    'expectedWorkspaceHash', 'writes', 'deletes', 'manifest'
  ]);
  if (unknown) return unknown;
  if (!isHash(value.expectedWorkspaceHash)) return failure(
    'candidate.changes.expectedWorkspaceHash',
    'sha256 workspace hash'
  );
  if (!Array.isArray(value.writes)) return failure(
    'candidate.changes.writes',
    'workspace file write array'
  );
  const writes: WorkspaceChangeSet['writes'][number][] = [];
  for (let index = 0; index < value.writes.length; index += 1) {
    const write = parseWrite(value.writes[index], index);
    if (isParseFailure(write)) return write;
    writes.push(write);
  }
  if (!Array.isArray(value.deletes)) return failure(
    'candidate.changes.deletes',
    'workspace file delete array'
  );
  const deletes: WorkspaceChangeSet['deletes'][number][] = [];
  for (let index = 0; index < value.deletes.length; index += 1) {
    const deletion = parseDelete(value.deletes[index], index);
    if (isParseFailure(deletion)) return deletion;
    deletes.push(deletion);
  }
  const manifest = value.manifest === undefined
    ? undefined : readWorkspaceManifest(value.manifest);
  if (manifest !== undefined && !manifest.ok) return failure(
    'candidate.changes.manifest', 'valid closed workspace manifest');
  return {
    expectedWorkspaceHash: value.expectedWorkspaceHash,
    writes,
    deletes,
    ...(manifest?.ok ? { manifest: manifest.value } : {})
  };
};

const parseWorkspaceCandidate = (
  value: unknown
): Extract<InspectRequest, { kind: 'workspace' }>['candidate'] |
  ParseInspectRequestFailure => {
  if (!isRecord(value)) return failure(
    'candidate',
    'workspace candidate object'
  );
  const unknown = rejectUnknownProperties(value, ['entry', 'changes']);
  if (unknown) return unknown;
  if (!isRecord(value.entry)) return failure(
    'candidate.entry',
    'workspace entry selector'
  );
  const entryUnknown = rejectUnknownProperties(value.entry, [
    'packageName', 'entryName'
  ]);
  if (entryUnknown) return entryUnknown;
  if (!isNonEmptyText(value.entry.packageName)) return failure(
    'candidate.entry.packageName',
    'non-empty package name'
  );
  if (!isNonEmptyText(value.entry.entryName)) return failure(
    'candidate.entry.entryName',
    'non-empty entry name'
  );
  const changes = parseWorkspaceChanges(value.changes);
  if (isParseFailure(changes)) return changes;
  return {
    entry: structuredClone({
      packageName: value.entry.packageName,
      entryName: value.entry.entryName
    }) as WorkspaceEntrySelector,
    changes
  };
};

/** Parse the small closed inspection surface; source bytes are never inline. */
export const parseInspectRequest = (
  value: unknown
): ParseInspectRequestResult => {
  if (value === undefined) return { ok: true };
  if (!isRecord(value) || typeof value.kind !== 'string') {
    return failure('$', 'inspect request object');
  }

  if (value.kind === 'measurement' || value.kind === 'surface' || value.kind === 'nodes') return parseMeasurement(value);

  if (value.kind === 'command') {
    const unknown = rejectUnknownProperties(value, ['kind', 'name']);
    if (unknown) return unknown;
    return typeof value.name === 'string'
      ? { ok: true, request: { kind: 'command', name: value.name } }
      : failure('name', 'command name');
  }

  if (value.kind === 'finding') {
    const unknown = rejectUnknownProperties(value, ['kind', 'path']);
    if (unknown) return unknown;
    return typeof value.path === 'string'
      ? { ok: true, request: { kind: 'finding', path: value.path } }
      : failure('path', 'finding path');
  }

  if (value.kind === 'export-target') {
    const unknown = rejectUnknownProperties(value, ['kind', 'adapter']);
    if (unknown) return unknown;
    try {
      return {
        ok: true,
        request: {
          kind: 'export-target',
          adapter: readExportAdapterInput(value.adapter)
        }
      };
    } catch {
      return failure('adapter', 'current export adapter input');
    }
  }

  if (value.kind === 'workspace') {
    const unknown = rejectUnknownProperties(value, [
      'kind', 'read', 'candidate', 'catalog', 'document'
    ]);
    if (unknown) return unknown;
    const hasRead = value.read !== undefined;
    if (['read', 'candidate', 'catalog', 'document'].filter((key) => value[key] !== undefined).length !== 1) return failure(
      '$',
      'exactly one of read, candidate, catalog, or document'
    );
    if (value.catalog !== undefined || value.document !== undefined) {
      const selector = value.catalog !== undefined ? 'catalog' : 'document';
      const input = value[selector];
      if (!isRecord(input)) return failure(selector, 'closed workspace inspection object');
      const unknown = rejectUnknownProperties(input, selector === 'catalog'
        ? ['expectedWorkspaceHash', 'offset', 'limit']
        : ['expectedWorkspaceHash', 'document', 'offset', 'maxCodeUnits']);
      if (unknown) return unknown;
      if (!isHash(input.expectedWorkspaceHash)) return failure(`${selector}.expectedWorkspaceHash`, 'sha256 workspace hash');
      if (typeof input.offset !== 'number' || !Number.isSafeInteger(input.offset) || input.offset < 0) return failure(`${selector}.offset`, 'non-negative safe integer');
      if (selector === 'catalog') {
        if (typeof input.limit !== 'number' || !Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 32) return failure('catalog.limit', 'integer from 1 to 32');
        return { ok: true, request: { kind: 'workspace', catalog: {
          expectedWorkspaceHash: input.expectedWorkspaceHash, offset: input.offset, limit: input.limit } } };
      }
      if (input.document !== 'manifest' && input.document !== 'lock') return failure('document.document', 'manifest or lock');
      if (typeof input.maxCodeUnits !== 'number' || !Number.isSafeInteger(input.maxCodeUnits) || input.maxCodeUnits < 1 || input.maxCodeUnits > MAX_WORKSPACE_READ_CODE_UNITS) return failure('document.maxCodeUnits', 'integer from 1 to 2048');
      return { ok: true, request: { kind: 'workspace', document: {
        expectedWorkspaceHash: input.expectedWorkspaceHash, offset: input.offset,
        document: input.document, maxCodeUnits: input.maxCodeUnits } } };
    }
    if (hasRead) {
      const read = parseWorkspaceRead(value.read);
      return isParseFailure(read)
        ? read
        : { ok: true, request: { kind: 'workspace', read } };
    }
    const candidate = parseWorkspaceCandidate(value.candidate);
    return isParseFailure(candidate)
      ? candidate
      : { ok: true, request: { kind: 'workspace', candidate } };
  }

  return failure('kind', 'command, finding, export-target, workspace, measurement, surface, or nodes');
};
