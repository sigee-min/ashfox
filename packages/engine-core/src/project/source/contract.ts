export interface SourcePosition {
  readonly offset: number;
  readonly line: number;
  readonly column: number;
}

export interface SourceSpan {
  readonly start: SourcePosition;
  readonly end: SourcePosition;
}

export interface SourceDiagnostic {
  readonly severity: 'error' | 'warning';
  readonly code: string;
  readonly message: string;
  readonly span: SourceSpan;
  readonly hint?: string;
}
