import { compareText } from '../../../stableOrder';
import type { AssetDiagnostic } from '../../../project/program/asset/contract';

/** Creates an empty null-prototype map object for compiler symbol tables. */
export const nullRecord = <T>(): Record<string, T> => Object.create(null) as Record<string, T>;

/** Deterministic total order over asset compiler diagnostics. */
export const compareDiagnostics = (left: AssetDiagnostic, right: AssetDiagnostic): number =>
  compareText(left.path, right.path) ||
  left.span.start.offset - right.span.start.offset ||
  left.span.end.offset - right.span.end.offset ||
  compareText(left.code, right.code) ||
  compareText(left.message, right.message);
