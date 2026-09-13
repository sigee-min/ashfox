import assert from 'node:assert/strict';
import { parentCycles } from '../../../src/compiler/program/asset/parentCycles';

interface Node { readonly id: string; readonly parentId: string | null }
const index = (nodes: readonly Node[]): Map<string, Node> => {
  const result = new Map<string, Node>();
  for (const node of nodes) if (!result.has(node.id)) result.set(node.id, node);
  return result;
};
// Deliberately independent per-start walk: the previous observable behavior.
const reference = (nodes: readonly Node[]): string[] => {
  const byId = index(nodes), result: string[] = [];
  for (const node of nodes) {
    const path = new Set<string>();
    let current: Node | undefined = node;
    while (current !== undefined && current.parentId !== null) {
      if (path.has(current.id)) { result.push(current.id); break; }
      path.add(current.id);
      current = byId.get(current.parentId);
    }
  }
  return result;
};
const check = (nodes: readonly Node[]): void => {
  assert.deepEqual(parentCycles(nodes, index(nodes)), reference(nodes));
};
check([]);
check([{ id: 'self', parentId: 'self' }]);
const cyclic = [
  { id: 'branch', parentId: 'b' }, { id: 'a', parentId: 'b' },
  { id: 'b', parentId: 'c' }, { id: 'c', parentId: 'a' },
  { id: 'missing', parentId: 'absent' }, { id: 'root', parentId: null }
];
assert.deepEqual(parentCycles(cyclic, index(cyclic)), ['b', 'a', 'b', 'c']);
check([...cyclic].reverse());
// Mix roots, missing parents, convergent branches, disconnected cycles and duplicates.
let seed = 941;
const random = (limit: number): number => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed % limit;
};
for (let trial = 0; trial < 300; trial++) {
  const nodes: Node[] = Array.from({ length: 40 }, (_, i) => {
    const parent = random(43);
    return { id: String(i), parentId: parent === 42 ? null : String(parent) };
  });
  if (trial % 3 === 0) nodes.push({ id: '0', parentId: trial % 2 ? null : '0' });
  check(nodes);
  check(nodes.reverse());
}
// A deterministic work bound, rather than a flaky timing assertion. Deep input
// also proves that the traversal does not depend on the JavaScript call stack.
let reads = 0;
const count = 20000;
const chain = Array.from({ length: count }, (_, i): Node => ({
  id: String(i), get parentId() { reads++; return i + 1 < count ? String(i + 1) : null; }
}));
assert.deepEqual(parentCycles(chain, index(chain)), []);
assert.ok(reads < count * 5, `Expected linear parent reads, got ${reads}`);
console.log('Scene parent cycles: diagnostic parity, malformed graphs and linear deep-chain traversal pass');
