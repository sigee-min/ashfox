import { compareText } from '../../stableOrder';

export interface SourcePosition {
  readonly offset: number;
  readonly line: number;
  readonly column: number;
}

/** A source location that remains meaningful after modules are resolved. */
export interface SourceRef {
  readonly packageName: string | null;
  readonly path: string;
  readonly start: SourcePosition;
  readonly end: SourcePosition;
}

export type WorkspaceDiagnosticSeverity = 'error' | 'warning';

export interface WorkspaceDiagnostic {
  readonly severity: WorkspaceDiagnosticSeverity;
  readonly code: string;
  readonly message: string;
  readonly source?: SourceRef;
  /** Logical paths from the reported source to the import that failed. */
  readonly importChain?: readonly string[];
}

export type WorkspaceReadResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly diagnostics: readonly WorkspaceDiagnostic[] };

export const emptyPosition = (): SourcePosition =>
  Object.freeze({
    offset: 0,
    line: 1,
    column: 1,
  });

export const syntheticSourceRef = (path: string, packageName: string | null = null): SourceRef =>
  Object.freeze({
    packageName,
    path,
    start: emptyPosition(),
    end: emptyPosition(),
  });

export interface SourceLineIndex {
  readonly starts: readonly number[];
}

export const createSourceLineIndex = (source: string): SourceLineIndex => {
  const starts = [0];
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === '\n') starts.push(index + 1);
  }
  return Object.freeze({ starts: Object.freeze(starts) });
};

const positionAtIndexed = (
  source: string,
  index: SourceLineIndex,
  offset: number,
): SourcePosition => {
  const bounded = Math.max(0, Math.min(offset, source.length));
  let low = 0;
  let high = index.starts.length;
  while (low + 1 < high) {
    const middle = Math.floor((low + high) / 2);
    if (index.starts[middle] <= bounded) low = middle;
    else high = middle;
  }
  return Object.freeze({
    offset: bounded,
    line: low + 1,
    column: bounded - index.starts[low] + 1,
  });
};

export const sourceRefAtIndexed = (
  packageName: string | null,
  path: string,
  source: string,
  lineIndex: SourceLineIndex,
  startOffset: number,
  endOffset: number,
): SourceRef =>
  Object.freeze({
    packageName,
    path,
    start: positionAtIndexed(source, lineIndex, startOffset),
    end: positionAtIndexed(source, lineIndex, endOffset),
  });

export const sourceRefAt = (
  packageName: string | null,
  path: string,
  source: string,
  startOffset: number,
  endOffset: number,
): SourceRef => {
  return sourceRefAtIndexed(
    packageName,
    path,
    source,
    createSourceLineIndex(source),
    startOffset,
    endOffset,
  );
};

const sourcePathForSort = (diagnostic: WorkspaceDiagnostic): string =>
  diagnostic.source?.path ?? '';

const sourceOffsetForSort = (diagnostic: WorkspaceDiagnostic): number =>
  diagnostic.source?.start.offset ?? Number.MAX_SAFE_INTEGER;

const packageForSort = (diagnostic: WorkspaceDiagnostic): string =>
  diagnostic.source?.packageName ?? '';

const chainForSort = (diagnostic: WorkspaceDiagnostic): string =>
  diagnostic.importChain?.join('\u0000') ?? '';

/** Stable presentation order for diagnostics from several source modules. */
export const sortWorkspaceDiagnostics = (
  diagnostics: readonly WorkspaceDiagnostic[],
): readonly WorkspaceDiagnostic[] =>
  [...diagnostics].sort(
    (left, right) =>
      compareText(packageForSort(left), packageForSort(right)) ||
      compareText(sourcePathForSort(left), sourcePathForSort(right)) ||
      sourceOffsetForSort(left) - sourceOffsetForSort(right) ||
      compareText(left.code, right.code) ||
      compareText(left.message, right.message) ||
      compareText(chainForSort(left), chainForSort(right)),
  );

export const errorDiagnostic = (
  code: string,
  message: string,
  source?: SourceRef,
  importChain?: readonly string[],
): WorkspaceDiagnostic =>
  Object.freeze({
    severity: 'error',
    code,
    message,
    ...(source === undefined ? {} : { source }),
    ...(importChain === undefined ? {} : { importChain: Object.freeze([...importChain]) }),
  });
