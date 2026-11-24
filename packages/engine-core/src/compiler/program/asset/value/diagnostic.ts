import { freeze } from '../../../../immutable';
import type { SourceSpan } from '../../../../project/source/contract';
import { assetTypeCompatible } from '../valueTypes';
import type {
  AssetExpressionType,
  AssetValueDiagnostic,
  AssetValueDiagnosticCode,
} from './contract';

/** Detached immutable copy of a source span for diagnostics. */
export const immutableSpan = (span: SourceSpan): SourceSpan =>
  freeze({
    start: freeze({ offset: span.start.offset, line: span.start.line, column: span.start.column }),
    end: freeze({ offset: span.end.offset, line: span.end.line, column: span.end.column }),
  });

export const diagnostic = (
  code: AssetValueDiagnosticCode,
  message: string,
  span: SourceSpan,
): AssetValueDiagnostic => freeze({ code, message, span: immutableSpan(span) });

/** Records a type-mismatch diagnostic unless `actual` satisfies `expected`. */
export const fitsExpected = (
  actual: AssetExpressionType,
  expected: AssetExpressionType | undefined,
  span: SourceSpan,
  diagnostics: AssetValueDiagnostic[],
): boolean => {
  if (expected === undefined || assetTypeCompatible(actual, expected)) return true;
  diagnostics.push(
    diagnostic(
      'asset.value.type-mismatch',
      'Expression type "' + actual + '" does not satisfy expected type "' + expected + '".',
      span,
    ),
  );
  return false;
};
