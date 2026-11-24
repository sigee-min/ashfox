import type {
  ProgramExpr,
  ProgramProperty,
  ProgramTextureStampDecl,
} from '../../../../project/program/syntax/contract';
import type { SourceSpan } from '../../../../project/source/contract';
import type { AssetValueType } from '../../../../project/program/asset/contract';
import {
  type AssetExpectedType,
  type AssetExpressionType,
  type AssetValue,
  type AssetValueDiagnostic,
} from '../value/contract';
import { compileAssetExpression } from '../valueCompile';
import { evaluateAssetExpression } from '../valueEvaluate';
import { assetTypeCompatible, isAssetExpressionType } from '../valueTypes';
import { cloneAssetValue } from '../valueRuntime';
import type { AssetTextureIssue } from './contract';

export interface TextureExpressionContext {
  readonly ownerSpan: SourceSpan;
  readonly types: ReadonlyMap<string, AssetExpressionType>;
  readonly values: ReadonlyMap<string, AssetValue>;
  readonly evaluate: (expression: ProgramExpr, expected?: AssetExpectedType) => AssetValue | null;
}

const safeIssue = (
  issue: AssetTextureIssue,
  path: string,
  span: SourceSpan,
  code: string,
  message: string,
): void => {
  issue(path, span, code, message);
};

const ownKeys = (value: object): readonly string[] => Object.keys(value).sort();

const diagnosticText = (diagnostic: AssetValueDiagnostic): string => diagnostic.message;

type SlotIssue = (code: string, message: string) => void;

/** Clone of one contract slot's bound value, or null after reporting why it is unusable. */
const readContractSlot = (
  name: string,
  declared: AssetValueType,
  source: AssetValue | undefined,
  report: SlotIssue,
): Readonly<{ readonly type: AssetExpressionType; readonly value: AssetValue }> | null => {
  if (!isAssetExpressionType(declared)) {
    report(
      'asset.texture.invalid-slot-type',
      'Texture slot "' + name + '" has an unsupported type.',
    );
    return null;
  }
  if (source === undefined) {
    report('asset.texture.missing-slot', 'Texture slot "' + name + '" has no bound value.');
    return null;
  }
  const cloned = cloneAssetValue(source);
  if (cloned === null || !assetTypeCompatible(cloned.type, declared)) {
    report(
      'asset.texture.invalid-slot-value',
      'Texture slot "' + name + '" does not satisfy its contract type.',
    );
    return null;
  }
  return { type: declared, value: cloned };
};

const reportUndeclaredSlots = (
  surfaceSlots: Readonly<Record<string, AssetValue>>,
  contractSlots: Readonly<Record<string, AssetValueType>>,
  report: SlotIssue,
): boolean => {
  let valid = true;
  for (const name of ownKeys(surfaceSlots)) {
    if (!Object.prototype.hasOwnProperty.call(contractSlots, name)) {
      report(
        'asset.texture.unknown-slot',
        'Texture slot "' + name + '" is not declared by the surface contract.',
      );
      valid = false;
    }
  }
  return valid;
};

/** Reporting sink for one texture owner's expression diagnostics. */
interface ExpressionScope {
  readonly types: ReadonlyMap<string, AssetExpressionType>;
  readonly values: ReadonlyMap<string, AssetValue>;
  readonly path: string;
  readonly ownerSpan: SourceSpan;
  readonly issue: AssetTextureIssue;
}

const reportMalformed = (scope: ExpressionScope): null => {
  safeIssue(
    scope.issue,
    scope.path,
    scope.ownerSpan,
    'asset.texture.invalid-expression',
    'Texture expression is malformed or exceeds the exact value boundary.',
  );
  return null;
};

const reportDiagnostics = (
  scope: ExpressionScope,
  diagnostics: readonly AssetValueDiagnostic[],
): null => {
  for (const diagnostic of diagnostics)
    safeIssue(
      scope.issue,
      scope.path,
      diagnostic.span,
      diagnostic.code,
      diagnosticText(diagnostic),
    );
  return null;
};

const tryCompile = (
  scope: ExpressionScope,
  expression: ProgramExpr,
  expected: AssetExpectedType | undefined,
): ReturnType<typeof compileAssetExpression> | null => {
  try {
    return compileAssetExpression(expression, scope.types, expected);
  } catch {
    return reportMalformed(scope);
  }
};

const tryEvaluate = (
  scope: ExpressionScope,
  compiled: Parameters<typeof evaluateAssetExpression>[0],
): ReturnType<typeof evaluateAssetExpression> | null => {
  try {
    return evaluateAssetExpression(compiled, scope.values);
  } catch {
    return reportMalformed(scope);
  }
};

const evaluateInScope = (
  scope: ExpressionScope,
  expression: ProgramExpr,
  expected?: AssetExpectedType,
): AssetValue | null => {
  const compiled = tryCompile(scope, expression, expected);
  if (compiled === null) return null;
  if (!compiled.ok) return reportDiagnostics(scope, compiled.diagnostics);
  const evaluated = tryEvaluate(scope, compiled.value);
  if (evaluated === null) return null;
  if (!evaluated.ok) return reportDiagnostics(scope, evaluated.diagnostics);
  return evaluated.value;
};

/** Clone and type-check the only values visible to a texture expression. */
export const createTextureExpressionContext = (
  surfaceSlots: Readonly<Record<string, AssetValue>>,
  contractSlots: Readonly<Record<string, AssetValueType>>,
  path: string,
  ownerSpan: SourceSpan,
  issue: AssetTextureIssue,
): TextureExpressionContext | null => {
  const report: SlotIssue = (code, message) => safeIssue(issue, path, ownerSpan, code, message);
  if (
    surfaceSlots === null ||
    typeof surfaceSlots !== 'object' ||
    contractSlots === null ||
    typeof contractSlots !== 'object'
  ) {
    report('asset.texture.invalid-slots', 'Texture slots must be closed objects.');
    return null;
  }
  const types = new Map<string, AssetExpressionType>();
  const values = new Map<string, AssetValue>();
  let valid = true;
  for (const name of ownKeys(contractSlots)) {
    const slot = readContractSlot(name, contractSlots[name], surfaceSlots[name], report);
    if (slot === null) {
      valid = false;
      continue;
    }
    types.set(name, slot.type);
    values.set(name, slot.value);
  }
  if (!reportUndeclaredSlots(surfaceSlots, contractSlots, report) || !valid) return null;
  const scope: ExpressionScope = { types, values, path, ownerSpan, issue };
  const evaluate = (expression: ProgramExpr, expected?: AssetExpectedType): AssetValue | null =>
    evaluateInScope(scope, expression, expected);
  return Object.freeze({ ownerSpan, types, values, evaluate });
};

const acceptProperty = (
  entry: ProgramProperty,
  allowedSet: ReadonlySet<string>,
  result: Map<string, ProgramProperty>,
  ownerSpan: SourceSpan,
  path: string,
  issue: AssetTextureIssue,
): boolean => {
  if (
    entry === null ||
    typeof entry !== 'object' ||
    typeof entry.name !== 'string' ||
    entry.value === undefined
  ) {
    safeIssue(
      issue,
      path,
      ownerSpan,
      'asset.texture.invalid-property',
      'Texture property is malformed.',
    );
    return false;
  }
  let valid = true;
  if (!allowedSet.has(entry.name)) {
    safeIssue(
      issue,
      path,
      entry.span ?? ownerSpan,
      'asset.texture.unknown-property',
      'Unknown texture property "' + entry.name + '".',
    );
    valid = false;
  }
  if (result.has(entry.name)) {
    safeIssue(
      issue,
      path,
      entry.span ?? ownerSpan,
      'asset.texture.duplicate-property',
      'Texture property "' + entry.name + '" is declared more than once.',
    );
    return false;
  }
  result.set(entry.name, entry);
  return valid;
};

export const properties = (
  entries: readonly ProgramProperty[],
  allowed: readonly string[],
  ownerSpan: SourceSpan,
  path: string,
  issue: AssetTextureIssue,
): ReadonlyMap<string, ProgramProperty> | null => {
  if (!Array.isArray(entries)) {
    safeIssue(
      issue,
      path,
      ownerSpan,
      'asset.texture.invalid-properties',
      'Texture properties must be an array.',
    );
    return null;
  }
  const allowedSet = new Set(allowed);
  const result = new Map<string, ProgramProperty>();
  let valid = true;
  for (const entry of entries) {
    if (!acceptProperty(entry, allowedSet, result, ownerSpan, path, issue)) valid = false;
  }
  return valid ? result : null;
};

const numberFrom = (
  value: AssetValue | null,
  expectedUnit: 'plain' | 'texel' | 'ratio',
  integral: boolean,
): bigint | null => {
  if (value?.kind !== 'number' || value.value.unit !== expectedUnit) return null;
  if (integral && value.value.denominator !== 1n) return null;
  return (value.value.numerator * 1n) / value.value.denominator;
};

export const readInteger = (
  expression: ProgramExpr,
  context: TextureExpressionContext,
  expectedUnit: 'plain' | 'texel',
  path: string,
  issue: AssetTextureIssue,
  fallback: SourceSpan,
): bigint | null => {
  const expected: AssetExpectedType = expectedUnit === 'plain' ? 'integer' : 'texel';
  const value = context.evaluate(expression, expected);
  const result = numberFrom(value, expectedUnit, true);
  if (result === null)
    safeIssue(
      issue,
      path,
      expression.span ?? fallback,
      'asset.texture.invalid-integer',
      'Texture value requires an integral ' + expectedUnit + ' number.',
    );
  return result;
};

const safeNumber = (value: bigint): number | null => {
  const maximum = BigInt(Number.MAX_SAFE_INTEGER);
  const minimum = -maximum;
  return value < minimum || value > maximum ? null : Number(value);
};

export const readTexelVector = (
  expression: ProgramExpr,
  context: TextureExpressionContext,
  length: 2 | 3,
  path: string,
  issue: AssetTextureIssue,
  fallback: SourceSpan,
): readonly number[] | null => {
  const values: readonly AssetValue[] =
    length === 3 &&
    expression.kind === 'vector' &&
    Array.isArray(expression.values) &&
    expression.values.length === 3
      ? expression.values
          .map((entry) => context.evaluate(entry, 'texel'))
          .filter((entry): entry is AssetValue => entry !== null)
      : (() => {
          const value = context.evaluate(expression, 'vec2<texel>');
          return value?.kind === 'vector' ? value.values : [];
        })();
  if (values.length !== length || values.some((entry) => entry.kind !== 'number')) {
    safeIssue(
      issue,
      path,
      expression.span ?? fallback,
      'asset.texture.invalid-vector',
      'Texture coordinates require an integral texel vector.',
    );
    return null;
  }
  const result: number[] = [];
  for (const entry of values) {
    if (entry.kind !== 'number') return null;
    const converted = safeNumber(entry.value.numerator);
    if (entry.value.denominator !== 1n || converted === null) {
      safeIssue(
        issue,
        path,
        expression.span ?? fallback,
        'asset.texture.invalid-vector',
        'Texture coordinates require safe integral texels.',
      );
      return null;
    }
    result.push(converted);
  }
  return Object.freeze(result);
};

export const readStampPixels = (
  declaration: ProgramTextureStampDecl,
  _context: TextureExpressionContext,
  path: string,
  issue: AssetTextureIssue,
): string | null => {
  const entries = declaration.properties.filter((entry) => entry.name === 'pixels');
  if (entries.length !== 1 || entries[0] === undefined || entries[0].value.kind !== 'string') {
    safeIssue(
      issue,
      path,
      declaration.span,
      'asset.texture.invalid-string',
      'Stamp requires exactly one pixels string.',
    );
    return null;
  }
  return entries[0].value.value;
};

export const toSafeNumber = safeNumber;
