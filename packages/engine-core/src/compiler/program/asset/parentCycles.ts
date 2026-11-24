interface ParentNode {
  readonly id: string;
  readonly parentId: string | null;
}

/** Internal scene validation; preserve one cycle report per starting node. */
export const parentCycles = (
  nodes: readonly ParentNode[],
  byId: ReadonlyMap<string, ParentNode>,
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

type Resolution = Map<string, string | null>;

interface ParentWalk {
  readonly path: readonly string[];
  readonly current: ParentNode | undefined;
  readonly cycle: string | null;
}

/** Starting within a cycle reports that starting node, while an incoming
 * branch reports the first cycle node it reaches. */
const resolveCycleMembers = (
  path: readonly string[],
  position: number,
  resolved: Resolution,
): void => {
  for (let index = position; index < path.length; index += 1) {
    resolved.set(path[index]!, path[index]!);
  }
};

/** Follows parent links until a root, an already resolved node, or a repeat. */
const walkParents = (
  node: ParentNode,
  byId: ReadonlyMap<string, ParentNode>,
  resolved: Resolution,
): ParentWalk => {
  const path: string[] = [];
  const positions = new Map<string, number>();
  let current: ParentNode | undefined = node;
  while (current !== undefined && current.parentId !== null) {
    if (resolved.has(current.id)) return { path, current, cycle: resolved.get(current.id)! };
    const position = positions.get(current.id);
    if (position !== undefined) {
      resolveCycleMembers(path, position, resolved);
      return { path, current, cycle: current.id };
    }
    positions.set(current.id, path.length);
    path.push(current.id);
    current = byId.get(current.parentId);
  }
  return { path, current, cycle: null };
};

const resolveParentChain = (
  node: ParentNode,
  byId: ReadonlyMap<string, ParentNode>,
  resolved: Resolution,
): void => {
  const { path, current, cycle } = walkParents(node, byId, resolved);
  for (const id of path) if (!resolved.has(id)) resolved.set(id, cycle);
  if (current !== undefined && current.parentId === null) resolved.set(current.id, null);
};

const uniqueParentCycles = (
  nodes: readonly ParentNode[],
  byId: ReadonlyMap<string, ParentNode>,
): readonly string[] => {
  const resolved: Resolution = new Map();
  for (const node of nodes) {
    if (!resolved.has(node.id)) resolveParentChain(node, byId, resolved);
  }
  const cycles: string[] = [];
  for (const node of nodes) {
    const cycle = resolved.get(node.id);
    if (cycle !== undefined && cycle !== null) cycles.push(cycle);
  }
  return cycles;
};
