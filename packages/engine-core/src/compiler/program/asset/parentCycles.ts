interface ParentNode {
  readonly id: string;
  readonly parentId: string | null;
}

/** Internal scene validation; preserve one cycle report per starting node. */
export const parentCycles = (
  nodes: readonly ParentNode[],
  byId: ReadonlyMap<string, ParentNode>
): readonly string[] => {
  // Duplicate IDs are already invalid. Keep their original first-match walk
  // so even malformed scenes retain the same diagnostic multiplicity/order.
  if (byId.size === nodes.length) return uniqueParentCycles(nodes, byId);
  const cycles: string[] = [];
  for (const node of nodes) {
    const visited = new Set<string>();
    let current: ParentNode | undefined = node;
    while (current?.parentId !== null && current !== undefined) {
      if (visited.has(current.id)) {
        cycles.push(current.id);
        break;
      }
      visited.add(current.id);
      current = byId.get(current.parentId);
    }
  }
  return cycles;
};

const uniqueParentCycles = (
  nodes: readonly ParentNode[],
  byId: ReadonlyMap<string, ParentNode>
): readonly string[] => {
  const resolved = new Map<string, string | null>();
  for (const node of nodes) {
    if (resolved.has(node.id)) continue;
    const path: string[] = [];
    const positions = new Map<string, number>();
    let current: ParentNode | undefined = node;
    let cycle: string | null = null;
    while (current !== undefined && current.parentId !== null) {
      if (resolved.has(current.id)) {
        cycle = resolved.get(current.id)!;
        break;
      }
      const position = positions.get(current.id);
      if (position !== undefined) {
        cycle = current.id;
        // Starting within a cycle reports that starting node, while an
        // incoming branch reports the first cycle node it reaches.
        for (let index = position; index < path.length; index += 1) {
          resolved.set(path[index]!, path[index]!);
        }
        break;
      }
      positions.set(current.id, path.length);
      path.push(current.id);
      current = byId.get(current.parentId);
    }
    for (const id of path) if (!resolved.has(id)) resolved.set(id, cycle);
    if (current !== undefined && current.parentId === null) resolved.set(current.id, null);
  }
  const cycles: string[] = [];
  for (const node of nodes) {
    const cycle = resolved.get(node.id);
    if (cycle !== undefined && cycle !== null) cycles.push(cycle);
  }
  return cycles;
};
