import assert from 'node:assert/strict';
import { hasChartOverlap } from '../../../src/compiler/program/asset/texture/overlap';

type Rectangle = Parameters<typeof hasChartOverlap>[0][number];
const box = (x: number, y: number, width = 1, height = 1): Rectangle =>
  ({ origin: [x, y], abiWidth: width, abiHeight: height });
const reference = (rectangles: readonly Rectangle[]): boolean => rectangles.some((a, i) =>
  rectangles.slice(i + 1).some(b => a.origin[0] < b.origin[0] + b.abiWidth &&
    b.origin[0] < a.origin[0] + a.abiWidth && a.origin[1] < b.origin[1] + b.abiHeight &&
    b.origin[1] < a.origin[1] + a.abiHeight));
for (const rectangles of [[], [box(0, 0)], [box(0, 0), box(1, 0)],
  [box(0, 0), box(0, 1)], [box(0, 0), box(1, 1)], [box(0, 0), box(0, 0)],
  [box(0, 0, 10, 10), box(2, 2)], [box(0, 2, 10, 1), box(2, 0, 1, 10)]]) {
  assert.equal(hasChartOverlap(rectangles), reference(rectangles));
}
let seed = 42;
const random = (limit: number): number => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed % limit;
};
for (let trial = 0; trial < 500; trial++) {
  const rectangles = Array.from({ length: 40 }, () =>
    box(random(200), random(200), random(8) + 1, random(8) + 1));
  assert.equal(hasChartOverlap(rectangles), reference(rectangles));
  assert.equal(hasChartOverlap(rectangles.reverse()), reference(rectangles));
}
// Both axes and a grid exercise compression and same-coordinate event ordering.
for (const rectangles of [
  Array.from({ length: 4000 }, (_, i) => box(i, 0)),
  Array.from({ length: 4000 }, (_, i) => box(0, i)),
  Array.from({ length: 4096 }, (_, i) => box(i % 64, Math.floor(i / 64)))
]) {
  assert.equal(hasChartOverlap(rectangles), false);
  assert.equal(hasChartOverlap([...rectangles, rectangles[rectangles.length - 1]!]), true);
}
console.log('Chart overlap: reference parity, touching edges, containment, crossing and large disjoint layouts pass');
