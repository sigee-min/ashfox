import assert from 'node:assert/strict';

import type { ProgramExpr, ProgramUnit } from '../../../src/project/program/syntax/contract';
import type { SourceSpan } from '../../../src/project/source/contract';
import {
  assetExactNumber,
  assetNumberValue,
  assetVectorValue,
  type AssetValue,
  type AssetValueResult,
} from '../../../src/compiler/program/asset/value/contract';
import { compileAssetExpression } from '../../../src/compiler/program/asset/valueCompile';
import {
  evaluateAssetExpression,
  toAssetCanonicalNumber,
} from '../../../src/compiler/program/asset/valueEvaluate';

const span = (offset = 0): SourceSpan =>
  Object.freeze({
    start: Object.freeze({ offset, line: 1, column: offset + 1 }),
    end: Object.freeze({ offset: offset + 1, line: 1, column: offset + 2 }),
  });

const number = (
  numerator: bigint,
  denominator = 1n,
  unit: ProgramUnit = 'plain',
  rawUnit = unit === 'plain' ? '' : unit,
): ProgramExpr =>
  Object.freeze({
    kind: 'number' as const,
    numerator,
    denominator,
    text: numerator.toString(),
    unit,
    rawUnit,
    span: span(),
  });

const call = (name: string, args: readonly ProgramExpr[]): ProgramExpr =>
  Object.freeze({
    kind: 'call' as const,
    name,
    args: Object.freeze([...args]),
    span: span(),
  });

const binary = (
  operator: '+' | '-' | '*' | '/' | '%' | '==' | '!=' | '<' | '<=' | '>' | '>=',
  left: ProgramExpr,
  right: ProgramExpr,
): ProgramExpr =>
  Object.freeze({
    kind: 'binary' as const,
    operator,
    left,
    right,
    span: span(),
  });

const member = (object: ProgramExpr, value: 'x' | 'y' | 'z'): ProgramExpr =>
  Object.freeze({
    kind: 'member' as const,
    object,
    member: value,
    span: span(),
  });

const expectValue = <T>(result: AssetValueResult<T>): T => {
  if (!result.ok) {
    throw new Error(result.diagnostics.map((item) => item.code).join(', '));
  }
  return result.value;
};

const vector = (first: bigint, second: bigint, third: bigint): ProgramExpr =>
  call('vec3', [number(first, 1n, 'unit'), number(second, 1n, 'unit'), number(third, 1n, 'unit')]);

{
  const exact = assetExactNumber(6n, -12n, 'unit');
  assert.deepEqual(exact, { numerator: -1n, denominator: 2n, unit: 'unit' });
  const expression = number(1n, 2n, 'plain', '');
  const typed = expectValue(compileAssetExpression(expression, new Map(), 'unit'));
  assert.equal(typed.type, 'unit');
  assert.equal(typed.kind, 'number');
  if (typed.kind === 'number') {
    assert.equal(typed.value.numerator, 1n);
    assert.equal(typed.value.denominator, 2n);
    assert.equal(typed.value.unit, 'unit');
  }
  const value = expectValue(evaluateAssetExpression(typed, new Map()));
  assert.equal(value.kind, 'number');
  if (value.kind === 'number')
    assert.deepEqual(value.value, {
      numerator: 1n,
      denominator: 2n,
      unit: 'unit',
    });
}

{
  const boundPlain: ProgramExpr = Object.freeze({
    kind: 'name',
    value: 'offset',
    span: span(),
  });
  const result = compileAssetExpression(boundPlain, new Map([['offset', 'plain']]), 'unit');
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.diagnostics[0]?.code, 'asset.value.type-mismatch');
}

{
  const sum = binary('+', vector(1n, 2n, 3n), vector(4n, 5n, 6n));
  const typed = expectValue(compileAssetExpression(sum, new Map(), 'vec3<unit>'));
  const value = expectValue(evaluateAssetExpression(typed, new Map()));
  assert.equal(value.kind, 'vector');
  if (value.kind === 'vector') {
    assert.equal(value.type, 'vec3<unit>');
    assert.deepEqual(
      value.values.map((entry) => entry.value.numerator),
      [5n, 7n, 9n],
    );
  }
  const y = expectValue(
    compileAssetExpression(member(vector(8n, 9n, 10n), 'y'), new Map(), 'unit'),
  );
  const yValue = expectValue(evaluateAssetExpression(y, new Map()));
  assert.equal(yValue.kind, 'number');
  if (yValue.kind === 'number') assert.equal(yValue.value.numerator, 9n);
}

{
  const scalar = number(2n);
  const expressions: readonly [ProgramExpr, readonly bigint[]][] = [
    [binary('*', vector(1n, 2n, 3n), scalar), [2n, 4n, 6n]],
    [binary('*', scalar, vector(1n, 2n, 3n)), [2n, 4n, 6n]],
    [binary('/', vector(2n, 4n, 6n), scalar), [1n, 2n, 3n]],
  ];
  for (const [expression, expected] of expressions) {
    const typed = expectValue(compileAssetExpression(expression, new Map(), 'vec3<unit>'));
    const value = expectValue(evaluateAssetExpression(typed, new Map()));
    assert.equal(value.kind, 'vector');
    if (value.kind === 'vector') {
      assert.deepEqual(
        value.values.map((entry) => entry.value.numerator),
        expected,
      );
      assert.deepEqual(
        value.values.map((entry) => entry.value.denominator),
        [1n, 1n, 1n],
      );
    }
  }
}

{
  const contextual = member(call('vec3', [number(1n), number(2n), number(3n)]), 'x');
  const typed = expectValue(compileAssetExpression(contextual, new Map(), 'unit'));
  const value = expectValue(evaluateAssetExpression(typed, new Map()));
  assert.equal(value.kind, 'number');
  if (value.kind === 'number') {
    assert.equal(value.type, 'unit');
    assert.equal(value.value.numerator, 1n);
  }
}

{
  const mismatch = binary('+', number(1n, 1n, 'unit'), number(1n, 1n, 'degree'));
  const result = compileAssetExpression(mismatch, new Map(), 'unit');
  assert.equal(result.ok, false);
  if (!result.ok)
    assert.ok(result.diagnostics.some((item) => item.code === 'asset.value.unit-mismatch'));
}

{
  const unsafe = toAssetCanonicalNumber(
    assetExactNumber(9007199254740993n, 1n, 'plain'),
    { minimum: -1e20, maximum: 1e20, integral: true },
    span(),
  );
  assert.equal(unsafe.ok, false);
  if (!unsafe.ok) assert.equal(unsafe.diagnostics[0]?.code, 'asset.value.unsafe-number');
}

{
  const unknownName: ProgramExpr = Object.freeze({
    kind: 'name',
    value: 'missing',
    span: span(),
  });
  const nameResult = compileAssetExpression(unknownName, new Map(), 'unit');
  assert.equal(nameResult.ok, false);
  if (!nameResult.ok) assert.equal(nameResult.diagnostics[0]?.code, 'asset.value.unknown-name');

  const callResult = compileAssetExpression(call('unknown', []), new Map());
  assert.equal(callResult.ok, false);
  if (!callResult.ok) assert.equal(callResult.diagnostics[0]?.code, 'asset.value.unknown-call');

  const zero = binary('/', number(1n, 1n, 'unit'), number(0n));
  const zeroTyped = expectValue(compileAssetExpression(zero, new Map(), 'unit'));
  const zeroResult = evaluateAssetExpression(zeroTyped, new Map());
  assert.equal(zeroResult.ok, false);
  if (!zeroResult.ok) assert.equal(zeroResult.diagnostics[0]?.code, 'asset.value.division-by-zero');
}

{
  const invalidType = compileAssetExpression(
    Object.freeze({ kind: 'name' as const, value: 'x', span: span() }),
    new Map([['x', 'bogus' as never]]),
    'unit',
  );
  assert.equal(invalidType.ok, false);
  if (!invalidType.ok)
    assert.equal(invalidType.diagnostics[0]?.code, 'asset.value.invalid-environment');

  const typed = expectValue(
    compileAssetExpression(
      Object.freeze({ kind: 'name' as const, value: 'x', span: span() }),
      new Map([['x', 'unit']]),
      'unit',
    ),
  );
  const malformedNumber = Object.freeze({
    kind: 'number' as const,
    type: 'unit' as const,
    value: { numerator: 1n, denominator: 1 as never, unit: 'unit' as const },
  }) as AssetValue;
  const malformedResult = evaluateAssetExpression(typed, new Map([['x', malformedNumber]]));
  assert.equal(malformedResult.ok, false);
  if (!malformedResult.ok)
    assert.equal(malformedResult.diagnostics[0]?.code, 'asset.value.invalid-environment');
}

{
  const degree = assetNumberValue(assetExactNumber(1n, 1n, 'degree'));
  const wrongVector = Object.freeze({
    kind: 'vector' as const,
    type: 'vec3<unit>' as const,
    values: Object.freeze([degree, degree, degree]),
  }) as AssetValue;
  const typed = expectValue(
    compileAssetExpression(
      Object.freeze({ kind: 'name' as const, value: 'v', span: span() }),
      new Map([['v', 'vec3<unit>']]),
      'vec3<unit>',
    ),
  );
  const wrongResult = evaluateAssetExpression(typed, new Map([['v', wrongVector]]));
  assert.equal(wrongResult.ok, false);
  if (!wrongResult.ok)
    assert.equal(wrongResult.diagnostics[0]?.code, 'asset.value.invalid-environment');

  const cyclic = {
    kind: 'vector' as const,
    type: 'vec3<unit>' as const,
    values: [] as never[],
  } as AssetValue;
  Object.assign(cyclic, { values: [cyclic, cyclic, cyclic] });
  const cycleResult = evaluateAssetExpression(typed, new Map([['v', cyclic]]));
  assert.equal(cycleResult.ok, false);
  if (!cycleResult.ok)
    assert.equal(cycleResult.diagnostics[0]?.code, 'asset.value.invalid-environment');
}

{
  const giant = number(1n << 513n, 1n, 'unit');
  const compileResult = compileAssetExpression(giant, new Map(), 'unit');
  assert.equal(compileResult.ok, false);
  if (!compileResult.ok)
    assert.equal(compileResult.diagnostics[0]?.code, 'asset.value.rational-limit');

  const large = number(1n << 300n, 1n, 'unit');
  const product = binary('*', number(1n << 300n), large);
  const typed = expectValue(compileAssetExpression(product, new Map(), 'unit'));
  const evalResult = evaluateAssetExpression(typed, new Map());
  assert.equal(evalResult.ok, false);
  if (!evalResult.ok) assert.equal(evalResult.diagnostics[0]?.code, 'asset.value.rational-limit');
}

{
  let deep: ProgramExpr = number(1n, 1n, 'unit');
  for (let index = 0; index < 20000; index += 1) {
    deep = Object.freeze({
      kind: 'unary' as const,
      operator: '+' as const,
      operand: deep,
      span: span(),
    });
  }
  const result = compileAssetExpression(deep, new Map(), 'unit');
  assert.equal(result.ok, false);
  if (!result.ok)
    assert.ok(result.diagnostics.some((item) => item.code === 'asset.value.expression-limit'));
}

{
  const typed = expectValue(compileAssetExpression(number(7n, 1n, 'unit'), new Map(), 'unit'));
  const value = expectValue(evaluateAssetExpression(typed, new Map()));
  assert.ok(Object.isFrozen(typed));
  assert.ok(Object.isFrozen(typed.span));
  assert.ok(Object.isFrozen(value));
  assert.equal(value.kind, 'number');
  if (value.kind === 'number') {
    assert.ok(Object.isFrozen(value.value));
    assert.throws(() => Object.defineProperty(value.value, 'numerator', { value: 9n }));
  }
  const input = assetNumberValue(assetExactNumber(3n, 1n, 'unit'));
  assert.ok(Object.isFrozen(input));

  const first = {
    kind: 'number' as const,
    type: 'unit' as const,
    value: { numerator: 3n, denominator: 1n, unit: 'unit' as const },
  };
  const clonedVector = assetVectorValue([first, first, first], 'vec3<unit>');
  first.value.numerator = 99n;
  assert.ok(Object.isFrozen(clonedVector.values[0]));
  assert.ok(Object.isFrozen(clonedVector.values[0]!.value));
  assert.equal(clonedVector.values[0]!.value.numerator, 3n);
}
