import type { Vec3 } from '../../model/identity';
import type { AshfoxExpr, AshfoxTransitionStep } from '../program/syntax/blockAst';
import {
  assertClosedChoice,
  createDomainFail,
  decodeSignedNumber,
} from '../program/syntax/blockLowering';
import type { VfxCurveEasing, VfxLifeStop, VfxPaletteRole } from '../../vfx/contract';
import { VfxInputError } from './contract';

export const failVfx = createDomainFail('vfx.syntax', 'vfx', (detail) => {
  throw new VfxInputError(detail);
});

export type VfxParamEnv = ReadonlyMap<string, AshfoxExpr>;

const resolveExprRef = (expr: AshfoxExpr, env?: VfxParamEnv, depth = 0): AshfoxExpr => {
  if (!env || depth > 16) return expr;
  if (expr.kind === 'path' && env.has(expr.value)) {
    return resolveExprRef(env.get(expr.value)!, env, depth + 1);
  }
  return expr;
};

const evalBinary = (
  op: string,
  left: number,
  right: number,
  file: string,
  expr: AshfoxExpr,
): number => {
  if (op === '+') return left + right;
  if (op === '-') return left - right;
  if (op === '*') return left * right;
  if (op === '/') {
    if (right === 0) return failVfx(file, expr.span, 'non-zero divisor', '0');
    return left / right;
  }
  if (op === '%') {
    if (right === 0) return failVfx(file, expr.span, 'non-zero divisor', '0');
    return left % right;
  }
  return failVfx(file, expr.span, 'arithmetic operator', op);
};

export const asNumber = (expr: AshfoxExpr, file: string, env?: VfxParamEnv, depth = 0): number => {
  if (depth > 16) return failVfx(file, expr.span, 'bounded expression', 'deep recursion');
  const resolved = resolveExprRef(expr, env, depth);
  if (resolved.kind === 'unary') {
    const val = asNumber(resolved.operand, file, env, depth + 1);
    return resolved.operator === '-' ? -val : val;
  }
  if (resolved.kind === 'binary') {
    const left = asNumber(resolved.left, file, env, depth + 1);
    const right = asNumber(resolved.right, file, env, depth + 1);
    return evalBinary(resolved.operator, left, right, file, resolved);
  }
  const decoded = decodeSignedNumber(resolved, 'any');
  if (decoded.ok) return decoded.value;
  return failVfx(file, decoded.span, 'number', decoded.actual);
};

export const asName = (expr: AshfoxExpr, file: string, env?: VfxParamEnv): string => {
  const resolved = resolveExprRef(expr, env);
  if (resolved.kind === 'path') return resolved.value;
  if (resolved.kind === 'string') return resolved.value;
  return failVfx(file, resolved.span, 'identifier', resolved.kind);
};

export const asColor = (expr: AshfoxExpr, file: string, env?: VfxParamEnv): string => {
  const resolved = resolveExprRef(expr, env);
  if (resolved.kind === 'color') return resolved.value;
  return failVfx(file, resolved.span, '#rrggbb color', resolved.kind);
};

export const asVec3 = (expr: AshfoxExpr, file: string, env?: VfxParamEnv): Vec3 => {
  const resolved = resolveExprRef(expr, env);
  if (resolved.kind !== 'tuple' || resolved.elements.length !== 3) {
    return failVfx(file, resolved.span, '3-element tuple', resolved.kind);
  }
  return [
    asNumber(resolved.elements[0]!, file, env),
    asNumber(resolved.elements[1]!, file, env),
    asNumber(resolved.elements[2]!, file, env),
  ];
};

export const asPointList = (expr: AshfoxExpr, file: string, env?: VfxParamEnv): readonly Vec3[] => {
  const resolved = resolveExprRef(expr, env);
  if (resolved.kind !== 'list')
    return failVfx(file, resolved.span, 'list of points', resolved.kind);
  return Object.freeze(resolved.elements.map((el) => asVec3(el, file, env)));
};

export const asRange = (
  expr: AshfoxExpr,
  file: string,
  env?: VfxParamEnv,
): readonly [number, number] => {
  const resolved = resolveExprRef(expr, env);
  if (resolved.kind === 'range') {
    return [asNumber(resolved.min, file, env), asNumber(resolved.max, file, env)];
  }
  const single = asNumber(resolved, file, env);
  return [single, single];
};

const toEasing = (name: string | undefined): VfxCurveEasing => {
  if (name === 'ease_out' || name === 'ease_in' || name === 'snap') return name;
  return 'linear';
};

export const asNumberCurve = (
  expr: AshfoxExpr,
  file: string,
  env?: VfxParamEnv,
): readonly VfxLifeStop<number>[] => {
  const resolved = resolveExprRef(expr, env);
  if (resolved.kind === 'transition') {
    const n = Math.max(1, resolved.steps.length - 1);
    return Object.freeze(
      resolved.steps.map((step: AshfoxTransitionStep, idx: number) => ({
        t: Number((idx / n).toFixed(4)),
        value: asNumber(step.value, file, env),
        ...(step.easing ? { easing: toEasing(step.easing.name) } : {}),
      })),
    );
  }
  const single = asNumber(resolved, file, env);
  return Object.freeze([
    { t: 0, value: single },
    { t: 1, value: single },
  ]);
};

const VALID_ROLES = new Set<VfxPaletteRole>(['core', 'mid', 'edge', 'smoke']);

export const asPaletteRole = (expr: AshfoxExpr, file: string, env?: VfxParamEnv): VfxPaletteRole =>
  assertClosedChoice(
    asName(expr, file, env),
    VALID_ROLES,
    file,
    expr.span,
    'core | mid | edge | smoke',
    failVfx,
  );

export const asColorRoleList = (
  expr: AshfoxExpr,
  file: string,
  env?: VfxParamEnv,
): readonly VfxPaletteRole[] => {
  const resolved = resolveExprRef(expr, env);
  if (resolved.kind === 'transition') {
    return Object.freeze(resolved.steps.map((s) => asPaletteRole(s.value, file, env)));
  }
  if (resolved.kind === 'list') {
    return Object.freeze(resolved.elements.map((e) => asPaletteRole(e, file, env)));
  }
  return Object.freeze([asPaletteRole(resolved, file, env)]);
};
