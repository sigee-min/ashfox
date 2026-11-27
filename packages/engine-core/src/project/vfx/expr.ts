import type { Vec3 } from '../../model/identity';
import type {
  AshfoxExpr,
  AshfoxNumberExpr,
  AshfoxTransitionStep,
} from '../program/syntax/blockAst';
import type { SourceSpan } from '../source/contract';
import type { VfxCurveEasing, VfxLifeStop, VfxPaletteRole } from '../../vfx/contract';
import { docsHint, formatDidYouMean } from '../source/suggest';
import { VfxInputError } from './contract';

export const failVfx = (
  file: string,
  span: SourceSpan,
  expected: string,
  actual: string,
  candidates?: readonly string[],
): never => {
  const actualText = actual || 'EOF';
  const suggestion = actual && candidates ? formatDidYouMean(actual, candidates) : '';
  throw new VfxInputError({
    code: 'vfx.syntax',
    file,
    pointer: `line:${span.start.line}:${span.start.column}`,
    expected,
    actual: `${actualText}${suggestion}`,
    hint: docsHint('vfx'),
  });
};

const evalNum = (expr: AshfoxNumberExpr): number => {
  const raw = Number(expr.numerator) / Number(expr.denominator);
  if (expr.unit === 'millisecond' && expr.rawUnit === 'ms' && expr.denominator === 1n)
    return raw / 1000;
  if (expr.rawUnit === '%') return raw / 100;
  return raw;
};

export const asNumber = (expr: AshfoxExpr, file: string): number => {
  if (expr.kind === 'number') return evalNum(expr);
  if (expr.kind === 'unary' && expr.operand.kind === 'number') {
    const val = evalNum(expr.operand);
    return expr.operator === '-' ? -val : val;
  }
  return failVfx(file, expr.span, 'number', expr.kind);
};

export const asName = (expr: AshfoxExpr, file: string): string => {
  if (expr.kind === 'path') return expr.value;
  if (expr.kind === 'string') return expr.value;
  return failVfx(file, expr.span, 'identifier', expr.kind);
};

export const asColor = (expr: AshfoxExpr, file: string): string => {
  if (expr.kind === 'color') return expr.value;
  return failVfx(file, expr.span, '#rrggbb color', expr.kind);
};

export const asVec3 = (expr: AshfoxExpr, file: string): Vec3 => {
  if (expr.kind !== 'tuple' || expr.elements.length !== 3) {
    return failVfx(file, expr.span, '3-element tuple', expr.kind);
  }
  return [
    asNumber(expr.elements[0]!, file),
    asNumber(expr.elements[1]!, file),
    asNumber(expr.elements[2]!, file),
  ];
};

export const asPointList = (expr: AshfoxExpr, file: string): readonly Vec3[] => {
  if (expr.kind !== 'list') return failVfx(file, expr.span, 'list of points', expr.kind);
  return Object.freeze(expr.elements.map((el) => asVec3(el, file)));
};

export const asRange = (expr: AshfoxExpr, file: string): readonly [number, number] => {
  if (expr.kind === 'range') return [asNumber(expr.min, file), asNumber(expr.max, file)];
  const single = asNumber(expr, file);
  return [single, single];
};

const toEasing = (name: string | undefined): VfxCurveEasing => {
  if (name === 'ease_out' || name === 'ease_in' || name === 'snap') return name;
  return 'linear';
};

export const asNumberCurve = (expr: AshfoxExpr, file: string): readonly VfxLifeStop<number>[] => {
  if (expr.kind === 'transition') {
    const n = Math.max(1, expr.steps.length - 1);
    return Object.freeze(
      expr.steps.map((step: AshfoxTransitionStep, idx: number) => ({
        t: Number((idx / n).toFixed(4)),
        value: asNumber(step.value, file),
        ...(step.easing ? { easing: toEasing(step.easing.name) } : {}),
      })),
    );
  }
  const single = asNumber(expr, file);
  return Object.freeze([
    { t: 0, value: single },
    { t: 1, value: single },
  ]);
};

const VALID_ROLES = new Set<VfxPaletteRole>(['core', 'mid', 'edge', 'smoke']);

export const asPaletteRole = (expr: AshfoxExpr, file: string): VfxPaletteRole => {
  const name = asName(expr, file);
  if (VALID_ROLES.has(name as VfxPaletteRole)) return name as VfxPaletteRole;
  return failVfx(file, expr.span, 'core | mid | edge | smoke', name, [
    'core',
    'mid',
    'edge',
    'smoke',
  ]);
};

export const asColorRoleList = (expr: AshfoxExpr, file: string): readonly VfxPaletteRole[] => {
  if (expr.kind === 'transition') {
    return Object.freeze(expr.steps.map((s) => asPaletteRole(s.value, file)));
  }
  if (expr.kind === 'list') {
    return Object.freeze(expr.elements.map((e) => asPaletteRole(e, file)));
  }
  return Object.freeze([asPaletteRole(expr, file)]);
};
