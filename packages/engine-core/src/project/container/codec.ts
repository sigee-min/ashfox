import { canonicalJsonString } from '../../canonicalJson';
import {
  canonicalWorkspaceLock,
  canonicalWorkspaceManifest
} from '../workspace/hash';
import {
  readAuthoredAssetWorkspace
} from '../workspace/reader';
import {
  errorDiagnostic,
  syntheticSourceRef
} from '../workspace/diagnostic';
import {
  assertWellFormedSourceText,
  decodeUtf8Source,
  sourceByteLength
} from '../workspace/path';
import {
  withWorkspaceLimits,
  type WorkspaceLimits
} from '../workspace/limits';
import type {
  AuthoredAssetWorkspace,
  WorkspaceFile
} from '../workspace/contract';
import type {
  WorkspaceDiagnostic
} from '../workspace/diagnostic';
import type {
  ReadWorkspaceFileOptions,
  ReadWorkspaceFileResult,
  WorkspaceFileInput,
  WriteWorkspaceFileResult
} from './contract';

const containerPath = 'ashfoxworkspace';

type WorkspaceFileFailure = {
  readonly ok: false;
  readonly diagnostics: readonly WorkspaceDiagnostic[];
};

const failure = (
  code: string,
  message: string
): WorkspaceFileFailure => Object.freeze({
  ok: false,
  diagnostics: Object.freeze([
    errorDiagnostic(code, message, syntheticSourceRef(containerPath))
  ])
});

const workspaceSource = (
  workspace: AuthoredAssetWorkspace
): string => {
  const files: readonly WorkspaceFile[] = [...workspace.files]
    .sort((left, right) => left.path < right.path ? -1 :
      left.path > right.path ? 1 : 0)
    .map((file) => ({ path: file.path, source: file.source }));
  return `${canonicalJsonString({
    files,
    manifest: canonicalWorkspaceManifest(workspace.manifest),
    lock: canonicalWorkspaceLock(workspace.lock)
  })}\n`;
};

const containerByteLimit = (limits: WorkspaceLimits): number => Math.min(
  Number.MAX_SAFE_INTEGER,
  limits.maxSourceBytes * 6 +
    limits.maxFiles * (limits.maxPathCodeUnits * 6 + 256) +
    65_536
);

const inputSource = (input: unknown, maxBytes: number):
  | { readonly ok: true; readonly source: string }
  | { readonly ok: false; readonly diagnostics: readonly WorkspaceDiagnostic[] } => {
  try {
    if (typeof input === 'string') {
      if (input.length > maxBytes || sourceByteLength(input) > maxBytes) {
        return failure('workspace.file.budget',
          `Workspace container exceeds the ${maxBytes}-byte input budget.`);
      }
      return Object.freeze({ ok: true, source: assertWellFormedSourceText(input) });
    }
    if (input instanceof Uint8Array) {
      if (input.byteLength > maxBytes) return failure('workspace.file.budget',
        `Workspace container exceeds the ${maxBytes}-byte input budget.`);
      return Object.freeze({ ok: true, source: decodeUtf8Source(input) });
    }
  } catch (error) {
    return Object.freeze({
      ok: false,
      diagnostics: Object.freeze([errorDiagnostic(
        'workspace.file.utf8',
        error instanceof Error ? error.message :
          'Workspace file is not well-formed UTF-8 text.',
        syntheticSourceRef(containerPath)
      )])
    });
  }
  return Object.freeze({
    ok: false,
    diagnostics: Object.freeze([errorDiagnostic(
      'workspace.file.input',
      'Workspace file input must be a UTF-8 string or Uint8Array.',
      syntheticSourceRef(containerPath)
    )])
  });
};

const readJson = (
  source: string
): WorkspaceFileFailure | { readonly ok: true; readonly value: unknown } => {
  if (!source.endsWith('\n') || source.endsWith('\n\n')) return failure(
    'workspace.file.newline',
    'Workspace files must contain canonical JSON followed by exactly one LF.'
  );
  if (source.includes('\r')) return failure(
    'workspace.file.newline',
    'Workspace files must use LF and must not contain CR characters.'
  );
  try {
    return Object.freeze({ ok: true, value: JSON.parse(source) });
  } catch (error) {
    return failure(
      'workspace.file.json',
      error instanceof Error ? `Workspace JSON is invalid: ${error.message}` :
        'Workspace JSON is invalid.'
    );
  }
};

/** Reads a canonical `.ashfoxworkspace` container without materializing products. */
export const readWorkspaceFile = (
  input: WorkspaceFileInput,
  options: ReadWorkspaceFileOptions = {}
): ReadWorkspaceFileResult => {
  try {
    const limits = withWorkspaceLimits(options?.limits);
    const decoded = inputSource(input, containerByteLimit(limits));
    if (!decoded.ok) return decoded;
    const parsed = readJson(decoded.source);
    if (!parsed.ok) return parsed;
    const opened = readAuthoredAssetWorkspace(parsed.value, {
      limits
    });
    if (!opened.ok) return Object.freeze({
      ok: false,
      diagnostics: Object.freeze([...opened.diagnostics])
    });
    if (decoded.source !== workspaceSource(opened.value)) return failure(
      'workspace.file.noncanonical',
      'Workspace file must use canonical JSON ordering, escaping, and one LF.'
    );
    return Object.freeze({ ok: true, workspace: opened.value });
  } catch {
    return failure(
      'workspace.file.invalid',
      'Workspace file could not be read.'
    );
  }
};

const writeFailure = (
  message: string,
  path: string
): WriteWorkspaceFileResult => Object.freeze({
  ok: false,
  diagnostics: Object.freeze([errorDiagnostic(
    'workspace.file.invalid_workspace',
    message,
    syntheticSourceRef(path)
  )])
});

/** Revalidates the source authority and emits its one canonical JSON encoding. */
export const writeWorkspaceFile = (
  workspace: AuthoredAssetWorkspace
): WriteWorkspaceFileResult => {
  try {
    const opened = readAuthoredAssetWorkspace(workspace);
    if (!opened.ok) {
      const first = opened.diagnostics[0];
      return writeFailure(
        first?.message ?? 'Workspace authority failed validation.',
        first?.source?.path ?? 'workspace'
      );
    }
    return Object.freeze({
      ok: true,
      source: workspaceSource(opened.value)
    });
  } catch {
    return writeFailure(
      'Workspace authority failed validation.',
      'workspace'
    );
  }
};
