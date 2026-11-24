import { PROJECT_SOURCE_MAX_CODE_UNITS } from '../resources';
import type { SourceDiagnostic, SourcePosition, SourceSpan } from './contract';

const position = (source: string, offset: number): SourcePosition => {
  let line = 1;
  let column = 1;
  const boundedOffset = Math.min(offset, source.length);
  for (let index = 0; index < boundedOffset; index += 1) {
    if (source[index] === '\n') {
      line += 1;
      column = 1;
    } else column += 1;
  }
  return Object.freeze({
    offset,
    line,
    column: column + Math.max(0, offset - source.length),
  });
};

export const sourceSpan = (source: string, start: number, end: number): SourceSpan =>
  Object.freeze({
    start: position(source, start),
    end: position(source, end),
  });

export const sourceLengthDiagnostic = (source: string): SourceDiagnostic | null =>
  source.length > PROJECT_SOURCE_MAX_CODE_UNITS
    ? Object.freeze({
        severity: 'error',
        code: 'source.too_long',
        message:
          `Authored source must not exceed ` + `${PROJECT_SOURCE_MAX_CODE_UNITS} code units.`,
        span: sourceSpan(source, PROJECT_SOURCE_MAX_CODE_UNITS, PROJECT_SOURCE_MAX_CODE_UNITS + 1),
      })
    : null;
