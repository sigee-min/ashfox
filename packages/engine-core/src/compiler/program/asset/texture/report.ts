import type { ProgramTextureDecl } from '../../../../project/program/syntax/contract';
import type { SourceSpan } from '../../../../project/source/contract';
import type { AssetTexelValue, TypedSurface, TypedSurfaceContract } from '../contract';
import type { AssetTextureIssue } from './contract';
import {
  createTextureExpressionContext,
  toSafeNumber,
  type TextureExpressionContext,
} from './expressions';

export type TextureReporter = {
  readonly path: string;
  readonly owner: SourceSpan;
  readonly issue: AssetTextureIssue;
  bad: boolean;
  sinkFailed: boolean;
  report: (span: SourceSpan, code: string, message: string, hint?: string) => void;
};

export const createTextureReporter = (
  path: string,
  owner: SourceSpan,
  issue: AssetTextureIssue,
): TextureReporter => {
  const result = { path, owner, issue, bad: false, sinkFailed: false } as TextureReporter;
  result.report = (span, code, message, hint): void => {
    result.bad = true;
    try {
      issue(path, span, code, message, hint);
    } catch (error) {
      result.sinkFailed = true;
      throw error;
    }
  };
  return result;
};

export const propertyIssue =
  (report: TextureReporter): AssetTextureIssue =>
  (_path, span, code, message, hint): void =>
    report.report(span, code, message, hint);

export const ownEntries = <T>(value: Readonly<Record<string, T>>): readonly [string, T][] =>
  Object.keys(value)
    .sort()
    .map((key) => [key, value[key]!] as [string, T]);

export const integerContract = (
  value: AssetTexelValue,
  report: TextureReporter,
  span: SourceSpan,
  label: string,
): number | null => {
  const exact = value === null || typeof value !== 'object' ? null : value.value;
  if (
    exact === null ||
    typeof exact !== 'object' ||
    typeof exact.numerator !== 'bigint' ||
    typeof exact.denominator !== 'bigint' ||
    typeof exact.unit !== 'string'
  ) {
    report.report(span, 'asset.texture.invalid-contract', label + ' is malformed.');
    return null;
  }
  if (exact.unit !== 'texel' || exact.denominator !== 1n) {
    report.report(span, 'asset.texture.invalid-contract', label + ' must be an integral texel.');
    return null;
  }
  const converted = toSafeNumber(exact.numerator);
  if (converted === null || converted <= 0 || converted > 4096) {
    report.report(span, 'asset.texture.invalid-contract', label + ' is outside the atlas limit.');
    return null;
  }
  return converted;
};

export const surfacePayload = (
  surface: TypedSurface,
  report: TextureReporter,
): ProgramTextureDecl | null => {
  const source = surface.textureSource;
  if (
    source === null ||
    typeof source !== 'object' ||
    source.payload === null ||
    typeof source.payload !== 'object' ||
    !Array.isArray(source.payload.statements)
  ) {
    report.report(
      source?.span ?? surface.span,
      'asset.missing-surface-texture',
      'A concrete surface must directly own a texture payload.',
    );
    return null;
  }
  return source.payload;
};

export const expressionContextFor = (
  surface: TypedSurface,
  contract: TypedSurfaceContract,
  path: string,
  report: TextureReporter,
): TextureExpressionContext | null =>
  createTextureExpressionContext(
    surface.slots,
    contract.slots,
    path,
    surface.span,
    propertyIssue(report),
  );
