import assert from 'node:assert/strict';
import { compileAssetExpression } from '../../../src/compiler/program/asset/valueCompile';
import { evaluateAssetExpression } from '../../../src/compiler/program/asset/valueEvaluate';
import type { ProgramExpr } from '../../../src/project/program/syntax/contract';
import type { AssetValueType } from '../../../src/project/program/asset/contract';

const span = { start: { offset: 0, line: 1, column: 1 }, end: { offset: 1, line: 1, column: 2 } };
const number = (n: bigint, unit: 'unit' | 'ratio' | 'plain' | 'texel' = 'unit', d = 1n): ProgramExpr => ({
  kind: 'number', numerator: n, denominator: d, unit, rawUnit: unit === 'plain' ? '' : unit,
  text: String(n), span
});
const vector = (...values: ProgramExpr[]): ProgramExpr => ({ kind: 'vector', values, span });
const call = (name: string, ...args: ProgramExpr[]): ProgramExpr => ({ kind: 'call', name, args, span });
const evaluate = (expression: ProgramExpr, expected: AssetValueType) => {
  const typed = compileAssetExpression(expression, new Map(), expected);
  assert.equal(typed.ok, true, JSON.stringify(typed, (_, value) => typeof value === 'bigint' ? String(value) : value));
  if (!typed.ok) throw new Error('Compilation failed');
  return evaluateAssetExpression(typed.value, new Map());
};

{
  const result = evaluate(call('texels', number(3n, 'unit', 2n), number(2n, 'plain')), 'texel');
  assert.equal(result.ok, true);
  if (result.ok && result.value.kind === 'number') assert.deepEqual(result.value.value,
    { numerator: 3n, denominator: 1n, unit: 'texel' });
  for (const density of [0n, -1n]) {
    assert.equal(evaluate(call('texels', number(2n), number(density, 'plain')), 'texel').ok, false);
  }
  assert.equal(evaluate(call('texels', number(3n, 'unit', 2n), number(1n, 'plain')), 'texel').ok, false);
  assert.equal(compileAssetExpression(call('texels', number(2n, 'texel'), number(1n, 'plain')), new Map(), 'texel').ok, false);
}

{
  const point = vector(number(-3n, 'unit', 2n), number(2n), number(4n));
  for (const axis of ['x', 'y', 'z']) {
    const reflected = call('mirror_' + axis, point, number(1n));
    const restored = evaluate(call('mirror_' + axis, reflected, number(1n)), 'vec3<unit>');
    const original = evaluate(point, 'vec3<unit>');
    assert.equal(restored.ok, true);
    assert.deepEqual(restored, original);
  }
}

{
  const anchor = vector(number(0n), number(0n), number(0n));
  const size = vector(number(5n), number(4n), number(6n));
  const align = vector(number(1n, 'ratio', 2n), number(0n, 'ratio'), number(1n, 'ratio'));
  const result = evaluate(call('box_origin', anchor, size, align), 'vec3<unit>');
  assert.equal(result.ok, true);
  if (result.ok && result.value.kind === 'vector') assert.deepEqual(result.value.values.map((v) => v.value), [
    { numerator: -5n, denominator: 2n, unit: 'unit' },
    { numerator: 0n, denominator: 1n, unit: 'unit' },
    { numerator: -6n, denominator: 1n, unit: 'unit' }
  ]);
  const badAlign = vector(number(2n, 'ratio'), number(0n, 'ratio'), number(0n, 'ratio'));
  assert.equal(evaluate(call('box_origin', anchor, size, badAlign), 'vec3<unit>').ok, false);
  const badSize = vector(number(0n), number(4n), number(6n));
  assert.equal(evaluate(call('box_origin', anchor, badSize, align), 'vec3<unit>').ok, false);
}
