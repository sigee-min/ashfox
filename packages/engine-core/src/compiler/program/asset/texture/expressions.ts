import type {
  ProgramExpr,
  ProgramProperty,
  ProgramTexturePalette,
  ProgramTextureStampDecl
} from '../../../../project/program/syntax/contract';
import type { SourceSpan } from '../../../../project/source/contract';
import type { AssetValueType } from '../../../../project/program/asset/contract';
import {
  type AssetExpectedType,
  type AssetExpressionType,
  type AssetValue,
  type AssetValueDiagnostic
} from '../value/contract';
import { compileAssetExpression } from '../value/compile';
import { evaluateAssetExpression } from '../value/evaluate';
import { assetTypeCompatible, isAssetExpressionType } from '../value/types';
import { cloneAssetValue } from '../value/runtime';
import type { AssetTextureIssue } from './contract';

export type PaletteRole =
  | Readonly<{ readonly kind: 'accent'; readonly color: string }>
  | Readonly<{
      readonly kind: 'ramp';
      readonly shadow: string;
      readonly base: string;
      readonly light: string;
    }>;

export interface TextureExpressionContext {
  readonly ownerSpan: SourceSpan;
  readonly types: ReadonlyMap<string, AssetExpressionType>;
  readonly values: ReadonlyMap<string, AssetValue>;
  readonly evaluate: (
    expression: ProgramExpr,
    expected?: AssetExpectedType
  ) => AssetValue | null;
}

const safeIssue = (
  issue: AssetTextureIssue,
  path: string,
  span: SourceSpan,
  code: string,
  message: string
): void => {
  issue(path, span, code, message);
};

const ownKeys = (value: object): readonly string[] =>
  Object.keys(value).sort();

const diagnosticText = (diagnostic: AssetValueDiagnostic): string =>
  diagnostic.message;

/** Clone and type-check the only values visible to a texture expression. */
export const createTextureExpressionContext = (
  surfaceSlots: Readonly<Record<string, AssetValue>>,
  contractSlots: Readonly<Record<string, AssetValueType>>,
  path: string,
  ownerSpan: SourceSpan,
  issue: AssetTextureIssue
): TextureExpressionContext | null => {
  const types = new Map<string, AssetExpressionType>();
  const values = new Map<string, AssetValue>();
  let valid = true;
  if (surfaceSlots === null || typeof surfaceSlots !== 'object' ||
    contractSlots === null || typeof contractSlots !== 'object') {
    safeIssue(issue, path, ownerSpan, 'asset.texture.invalid-slots',
      'Texture slots must be closed objects.');
    return null;
  }
  for (const name of ownKeys(contractSlots)) {
    const declared = contractSlots[name];
    const source = surfaceSlots[name];
    if (!isAssetExpressionType(declared)) {
      safeIssue(issue, path, ownerSpan, 'asset.texture.invalid-slot-type',
        'Texture slot "' + name + '" has an unsupported type.');
      valid = false;
      continue;
    }
    if (source === undefined) {
      safeIssue(issue, path, ownerSpan, 'asset.texture.missing-slot',
        'Texture slot "' + name + '" has no bound value.');
      valid = false;
      continue;
    }
    const cloned = cloneAssetValue(source);
    if (cloned === null || !assetTypeCompatible(cloned.type, declared)) {
      safeIssue(issue, path, ownerSpan, 'asset.texture.invalid-slot-value',
        'Texture slot "' + name + '" does not satisfy its contract type.');
      valid = false;
      continue;
    }
    types.set(name, declared);
    values.set(name, cloned);
  }
  for (const name of ownKeys(surfaceSlots)) {
    if (!Object.prototype.hasOwnProperty.call(contractSlots, name)) {
      safeIssue(issue, path, ownerSpan, 'asset.texture.unknown-slot',
        'Texture slot "' + name + '" is not declared by the surface contract.');
      valid = false;
    }
  }
  if (!valid) return null;
  const evaluate = (expression: ProgramExpr, expected?: AssetExpectedType): AssetValue | null => {
    let compiled: ReturnType<typeof compileAssetExpression>;
    try {
      compiled = compileAssetExpression(expression, types, expected);
    } catch {
      safeIssue(issue, path, ownerSpan, 'asset.texture.invalid-expression',
        'Texture expression is malformed or exceeds the exact value boundary.');
      return null;
    }
    if (!compiled.ok) {
      for (const diagnostic of compiled.diagnostics) safeIssue(issue, path,
        diagnostic.span, diagnostic.code, diagnosticText(diagnostic));
      return null;
    }
    let evaluated: ReturnType<typeof evaluateAssetExpression>;
    try {
      evaluated = evaluateAssetExpression(compiled.value, values);
    } catch {
      safeIssue(issue, path, ownerSpan, 'asset.texture.invalid-expression',
        'Texture expression is malformed or exceeds the exact value boundary.');
      return null;
    }
    if (!evaluated.ok) {
      for (const diagnostic of evaluated.diagnostics) safeIssue(issue, path,
        diagnostic.span, diagnostic.code, diagnosticText(diagnostic));
      return null;
    }
    return evaluated.value;
  };
  return Object.freeze({ ownerSpan, types, values, evaluate });
};

export const properties = (
  entries: readonly ProgramProperty[],
  allowed: readonly string[],
  ownerSpan: SourceSpan,
  path: string,
  issue: AssetTextureIssue
): ReadonlyMap<string, ProgramProperty> | null => {
  const allowedSet = new Set(allowed);
  const result = new Map<string, ProgramProperty>();
  let valid = true;
  if (!Array.isArray(entries)) {
    safeIssue(issue, path, ownerSpan, 'asset.texture.invalid-properties',
      'Texture properties must be an array.');
    return null;
  }
  for (const entry of entries) {
    if (entry === null || typeof entry !== 'object' ||
      typeof entry.name !== 'string' || entry.value === undefined) {
      safeIssue(issue, path, ownerSpan, 'asset.texture.invalid-property',
        'Texture property is malformed.');
      valid = false;
      continue;
    }
    if (!allowedSet.has(entry.name)) {
      safeIssue(issue, path, entry.span ?? ownerSpan, 'asset.texture.unknown-property',
        'Unknown texture property "' + entry.name + '".');
      valid = false;
    }
    if (result.has(entry.name)) {
      safeIssue(issue, path, entry.span ?? ownerSpan, 'asset.texture.duplicate-property',
        'Texture property "' + entry.name + '" is declared more than once.');
      valid = false;
      continue;
    }
    result.set(entry.name, entry);
  }
  return valid ? result : null;
};

const colorLiteral = /^#[0-9a-f]{6}$/iu;

const colorValues = (
  expression: ProgramExpr,
  context: TextureExpressionContext
): readonly string[] | null => {
  if (expression.kind === 'vector' && Array.isArray(expression.values) &&
    expression.values.length === 3) {
    const values = expression.values.map((entry) => context.evaluate(entry, 'color'));
    return values.every((value) => value?.kind === 'color' && colorLiteral.test(value.value))
      ? values.map((value) => value === null || value.kind !== 'color' ? '#000000' : value.value.toLowerCase())
      : null;
  }
  const value = context.evaluate(expression, 'color');
  return value?.kind === 'color' && colorLiteral.test(value.value)
    ? [value.value.toLowerCase()] : null;
};

const luma = (value: string): number => Number.parseInt(value.slice(1, 3), 16) * 2126 +
  Number.parseInt(value.slice(3, 5), 16) * 7152 +
  Number.parseInt(value.slice(5, 7), 16) * 722;

export const readPalette = (
  declaration: ProgramTexturePalette,
  context: TextureExpressionContext,
  path: string,
  issue: AssetTextureIssue
): ReadonlyMap<string, PaletteRole> | null => {
  const result = new Map<string, PaletteRole>();
  let valid = true;
  const seen = new Set<string>();
  if (declaration === null || typeof declaration !== 'object' ||
    !Array.isArray(declaration.properties)) {
    safeIssue(issue, path, context.ownerSpan, 'asset.texture.invalid-palette',
      'Texture palette is malformed.');
    return null;
  }
  for (const entry of declaration.properties) {
    if (entry === null || typeof entry !== 'object' || typeof entry.name !== 'string') {
      safeIssue(issue, path, declaration.span, 'asset.texture.invalid-palette-role',
        'Palette role declaration is malformed.');
      valid = false;
      continue;
    }
    if (seen.has(entry.name)) {
      safeIssue(issue, path, entry.span, 'asset.texture.duplicate-role',
        'Palette role "' + entry.name + '" is declared more than once.');
      valid = false;
      continue;
    }
    seen.add(entry.name);
    const colors = colorValues(entry.value, context);
    if (colors === null) {
      safeIssue(issue, path, entry.value.span, 'asset.texture.invalid-color',
        'Palette roles require one color or a three-color ramp.');
      valid = false;
      continue;
    }
    if (colors.length === 1) result.set(entry.name, Object.freeze({
      kind: 'accent', color: colors[0]!
    }));
    else if (luma(colors[0]!) < luma(colors[1]!) && luma(colors[1]!) < luma(colors[2]!)) {
      result.set(entry.name, Object.freeze({
        kind: 'ramp', shadow: colors[0]!, base: colors[1]!, light: colors[2]!
      }));
    } else {
      safeIssue(issue, path, entry.value.span, 'asset.texture.invalid-ramp',
        'Palette ramp colors must increase from shadow to base to light.');
      valid = false;
    }
  }
  if (result.size === 0) {
    safeIssue(issue, path, declaration.span, 'asset.texture.empty-palette',
      'Texture palette requires at least one valid role.');
    valid = false;
  }
  return valid ? result : null;
};

export const readRole = (
  expression: ProgramExpr,
  palette: ReadonlyMap<string, PaletteRole>,
  requireRamp: boolean,
  path: string,
  issue: AssetTextureIssue,
  fallback: SourceSpan
): Readonly<{ readonly name: string; readonly role: PaletteRole }> | null => {
  if (expression.kind !== 'name') {
    safeIssue(issue, path, expression.span ?? fallback, 'asset.texture.invalid-role',
      'Paint operations must name a palette role.');
    return null;
  }
  const selected = palette.get(expression.value);
  if (selected === undefined) {
    safeIssue(issue, path, expression.span, 'asset.texture.unknown-role',
      'Unknown palette role "' + expression.value + '".');
    return null;
  }
  if (requireRamp && selected.kind !== 'ramp') {
    safeIssue(issue, path, expression.span, 'asset.texture.ramp-required',
      'This paint operation requires a three-color palette ramp.');
    return null;
  }
  return Object.freeze({ name: expression.value, role: selected });
};

const numberFrom = (
  value: AssetValue | null,
  expectedUnit: 'plain' | 'texel' | 'ratio',
  integral: boolean
): bigint | null => {
  if (value?.kind !== 'number' || value.value.unit !== expectedUnit) return null;
  if (integral && value.value.denominator !== 1n) return null;
  return value.value.numerator * 1n / value.value.denominator;
};

export const readInteger = (
  expression: ProgramExpr,
  context: TextureExpressionContext,
  expectedUnit: 'plain' | 'texel',
  path: string,
  issue: AssetTextureIssue,
  fallback: SourceSpan
): bigint | null => {
  const expected: AssetExpectedType = expectedUnit === 'plain' ? 'integer' : 'texel';
  const value = context.evaluate(expression, expected);
  const result = numberFrom(value, expectedUnit, true);
  if (result === null) safeIssue(issue, path, expression.span ?? fallback,
    'asset.texture.invalid-integer', 'Texture value requires an integral ' + expectedUnit + ' number.');
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
  fallback: SourceSpan
): readonly number[] | null => {
  const values: readonly AssetValue[] = length === 3 && expression.kind === 'vector' &&
    Array.isArray(expression.values) && expression.values.length === 3
    ? expression.values.map((entry) => context.evaluate(entry, 'texel')).filter(
      (entry): entry is AssetValue => entry !== null)
    : (() => {
      const value = context.evaluate(expression, 'vec2<texel>');
      return value?.kind === 'vector' ? value.values : [];
    })();
  if (values.length !== length || values.some((entry) => entry.kind !== 'number')) {
    safeIssue(issue, path, expression.span ?? fallback, 'asset.texture.invalid-vector',
      'Texture coordinates require an integral texel vector.');
    return null;
  }
  const result: number[] = [];
  for (const entry of values) {
    if (entry.kind !== 'number') return null;
    const converted = safeNumber(entry.value.numerator);
    if (entry.value.denominator !== 1n || converted === null) {
      safeIssue(issue, path, expression.span ?? fallback, 'asset.texture.invalid-vector',
        'Texture coordinates require safe integral texels.');
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
  issue: AssetTextureIssue
): string | null => {
  const entries = declaration.properties.filter((entry) => entry.name === 'pixels');
  if (entries.length !== 1 || entries[0] === undefined || entries[0].value.kind !== 'string') {
    safeIssue(issue, path, declaration.span, 'asset.texture.invalid-string',
      'Stamp requires exactly one pixels string.');
    return null;
  }
  return entries[0].value.value;
};

export const toSafeNumber = safeNumber;
