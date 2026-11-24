'use strict';

const assert = require('node:assert/strict');
const {
  complexityViolations,
  exceedances,
  functionMetrics,
  tightenedBaseline,
} = require('./complexity');

const metricsFor = (source) => functionMetrics('fixture.ts', source);
const byKey = (source) => new Map(metricsFor(source).map((metric) => [metric.key, metric]));

// Sonar reference cases: nesting increments, else-if, logical sequences.
const sample = byKey(
  [
    'export const sum = (items: number[], flag: boolean): number => {',
    '  let total = 0;',
    '  for (const item of items) {', // +1
    '    if (item > 0 && flag) {', // +2 (nesting 1), && +1
    '      total += item;',
    '    } else if (item < 0 || !flag || item === 2) {', // +1, || +1
    '      total -= item;',
    '    } else {', // +1
    '      total += flag ? 1 : 0;', // +3 (nesting 2)
    '    }',
    '  }',
    '  return total;',
    '};',
    '',
  ].join('\n'),
).get('fixture.ts::sum');
assert.equal(sample.cognitive, 10);
assert.equal(sample.nesting, 2);
assert.equal(sample.lines, 13);

// Mixed logical operators count one increment per operator change.
assert.equal(
  byKey('const f = (a: boolean, b: boolean, c: boolean) => a && b || c && a;\n').get(
    'fixture.ts::f',
  ).cognitive,
  3,
);

// Nested callbacks add nesting to their enclosing function and are not scored twice.
const nested = byKey(
  [
    'class Walker {',
    '  run(values: number[]): void {',
    '    values.forEach((value) => {',
    '      if (value) console.log(value);', // +2 (nesting 1 from callback)
    '    });',
    '  }',
    '}',
    '',
  ].join('\n'),
);
assert.equal(nested.get('fixture.ts::Walker/run').cognitive, 2);
assert.equal(nested.get('fixture.ts::Walker/run/<forEach callback>').cognitive, 0);
assert.equal(nested.get('fixture.ts::Walker/run/<forEach callback>').nesting, 1);

// Duplicate names get stable ordinals.
assert.deepEqual(
  metricsFor('[1].map(() => 1);\n[2].map(() => 2);\n').map((metric) => metric.key),
  ['fixture.ts::<map callback>', 'fixture.ts::<map callback>#2'],
);

const policy = { maxFunctionLines: 5, maxNestingDepth: 1, maxCognitiveComplexity: 2 };
const current = exceedances(
  [
    { key: 'a', lines: 9, nesting: 1, cognitive: 1 },
    { key: 'b', lines: 2, nesting: 3, cognitive: 4 },
    { key: 'c', lines: 1, nesting: 0, cognitive: 0 },
  ],
  policy,
);
assert.deepEqual(current, { a: { lines: 9 }, b: { nesting: 3, cognitive: 4 } });

assert.deepEqual(complexityViolations(current, current), []);
assert.deepEqual(complexityViolations(current, { a: { lines: 9 } }), [
  'b: new nesting 3 exceeds the limit',
  'b: new cognitive 4 exceeds the limit',
]);
assert.deepEqual(complexityViolations(current, { a: { lines: 8 }, b: current.b }), [
  'a: lines grew from 8 to 9',
]);
assert.deepEqual(complexityViolations({}, { a: { lines: 9 } }), [
  'a: baseline lines 9 is stale (now within limit); run npm run quality:complexity:tighten',
]);
assert.match(complexityViolations({ a: { lines: 7 } }, { a: { lines: 9 } })[0], /stale \(now 7\)/);

// Tightening never admits growth or new entries unless explicitly accepted.
assert.deepEqual(
  tightenedBaseline({ a: { lines: 7 }, b: { nesting: 3 } }, { a: { lines: 9 } }, false),
  {
    a: { lines: 7 },
  },
);
assert.deepEqual(tightenedBaseline({ a: { lines: 10 } }, { a: { lines: 9 } }, false), {});
assert.deepEqual(tightenedBaseline({ b: { nesting: 3 } }, {}, true), { b: { nesting: 3 } });

console.log('ashfox complexity gate tests ok');
