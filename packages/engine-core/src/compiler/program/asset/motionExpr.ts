import { freeze } from '../../../immutable';
import type { AssetMotionDecl } from '../../../project/program/asset/contract';
import type { AssetNumberValue } from './value/contract';
import type { TypedExpressionEntry, TypedMotionExpression } from './contract';
import type { AssemblyContext, AssemblyState } from './assembly';
import { compileAndEvaluateHirExpression } from './hirValues';

const exactLess = (left: AssetNumberValue, right: AssetNumberValue): boolean =>
  left.value.numerator * right.value.denominator < right.value.numerator * left.value.denominator;

const compileExprTime = (
  expr: AssetMotionDecl['tracks'][number]['keyframes'][number]['time'],
  duration: AssetNumberValue,
  state: AssemblyState,
  context: AssemblyContext,
): AssetNumberValue | null => {
  const tv = compileAndEvaluateHirExpression(
    expr,
    'second',
    new Map(),
    new Map(),
    state.path,
    context.issue,
  );
  const sec = tv?.kind === 'number' && tv.type === 'second' ? tv : null;
  if (sec !== null && (sec.value.numerator < 0n || exactLess(duration, sec))) {
    context.issue(
      state.path,
      expr.span,
      'asset.invalid-motion-key',
      'Expression key time must lie within the declared duration.',
    );
  }
  return sec;
};

const compileExprEntry = (
  entry: NonNullable<AssetMotionDecl['expressions']>[number]['entries'][number],
  duration: AssetNumberValue,
  state: AssemblyState,
  context: AssemblyContext,
): TypedExpressionEntry | null => {
  const startTime = compileExprTime(entry.startTime, duration, state, context);
  const endTime = entry.endTime ? compileExprTime(entry.endTime, duration, state, context) : null;
  if (startTime === null || (entry.endTime !== null && endTime === null)) return null;
  if (endTime !== null && !exactLess(startTime, endTime)) {
    context.issue(
      state.path,
      entry.span,
      'asset.invalid-motion-key',
      'Expression time range start must precede end.',
    );
    return null;
  }
  return freeze({
    startTime: startTime as TypedExpressionEntry['startTime'],
    endTime: endTime as TypedExpressionEntry['endTime'],
    variant: entry.variant,
    span: entry.span,
  });
};

/** Build typed motion expression slot schedules against the motion duration. */
export const buildMotionExpressions = (
  context: AssemblyContext,
  state: AssemblyState,
  duration: AssetNumberValue,
  declaration: AssetMotionDecl,
): readonly TypedMotionExpression[] =>
  freeze(
    (declaration.expressions ?? []).map((exp) => {
      const entries = exp.entries
        .map((entry) => compileExprEntry(entry, duration, state, context))
        .filter((item): item is TypedExpressionEntry => item !== null);
      return freeze({ slot: exp.slot, entries: freeze(entries), span: exp.span });
    }),
  );
