import { BuildFailure } from '@ashfox/asset-build';
import { SpriteInputError, StructureInputError, VfxInputError } from '@ashfox/engine-core';
import { formatCliResult, isOnboardingCommand } from './onboarding/cli';

interface DiagnosticLike {
  readonly severity?: string;
  readonly code: string;
  readonly message: string;
  readonly file?: string;
  readonly hint?: string;
}

/** Writes the canonical JSON CLI envelope for one command result to stdout. */
export const writeCliResult = (
  command: string,
  ok: boolean,
  value: unknown,
  diagnostics: readonly unknown[] = [],
): void => {
  process.stdout.write(formatCliResult(command, ok, value, diagnostics));
};

const failureDiagnostics = (failure: BuildFailure): readonly DiagnosticLike[] =>
  failure.diagnostics && failure.diagnostics.length > 0
    ? failure.diagnostics
    : [
        {
          severity: 'error',
          code: failure.code,
          message: failure.message,
          ...(failure.hint !== undefined ? { hint: failure.hint } : {}),
        },
      ];

const formatDiagnosticLine = (d: DiagnosticLike): string => {
  const loc = d.file && !d.message.startsWith(d.file) ? `${d.file}: ` : '';
  const hint = d.hint ? `\n  ${d.hint}` : '';
  return `ashfox [${d.code}]: ${loc}${d.message}${hint}\n`;
};

const inputErrorFailure = (
  code: string,
  file: string,
  message: string,
  hint?: string,
): BuildFailure =>
  new BuildFailure(
    code,
    message,
    1,
    [{ severity: 'error', code, file, message, ...(hint ? { hint } : {}) }],
    hint,
  );

const toBuildFailure = (error: unknown): BuildFailure => {
  if (error instanceof BuildFailure) return error;
  if (error instanceof SpriteInputError) {
    const d = error.diagnostic;
    return inputErrorFailure(d.code, d.file, error.message, d.hint);
  }
  if (error instanceof StructureInputError) {
    const d = error.detail;
    return inputErrorFailure(d.code, d.file, error.message, d.hint);
  }
  if (error instanceof VfxInputError) {
    const d = error.diagnostic;
    return inputErrorFailure(d.code, d.file, error.message, d.hint);
  }
  const msg = error instanceof Error ? error.message : String(error);
  const hint =
    error instanceof Error && 'hint' in error && typeof error.hint === 'string'
      ? error.hint
      : undefined;
  return new BuildFailure('build.failure', msg, 3, undefined, hint);
};

/** Formats a thrown CLI error onto stderr/stdout and sets process.exitCode. */
export const handleCliFailure = (
  command: string,
  args: readonly string[],
  error: unknown,
): void => {
  const failure = toBuildFailure(error);
  const diagnostics = failureDiagnostics(failure);
  const wantJson = args.includes('--json');
  process.exitCode = failure.exitCode;
  if (isOnboardingCommand(command) && !wantJson) {
    process.stderr.write(
      `ashfox: ${failure.message}${failure.hint ? `\n  ${failure.hint}` : ''}\n`,
    );
    return;
  }
  if (command === 'render') {
    const err = {
      code: failure.code,
      message: failure.message,
      ...(failure.hint ? { hint: failure.hint } : {}),
    };
    process.stderr.write(JSON.stringify({ ok: false, error: err }) + '\n');
    return;
  }
  if (!wantJson) diagnostics.forEach((d) => process.stderr.write(formatDiagnosticLine(d)));
  writeCliResult(command, false, null, diagnostics);
};
