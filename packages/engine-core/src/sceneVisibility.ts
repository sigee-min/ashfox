import type { ProjectDocument, SceneNode } from './model';

const resolveSceneNodeEffectiveVisibility = (
  document: ProjectDocument,
  nodeId: string,
  memo: Map<string, boolean>,
  visiting: Set<string>,
): boolean => {
  const cached = memo.get(nodeId);
  if (cached !== undefined) return cached;
  if (visiting.has(nodeId)) {
    memo.set(nodeId, false);
    return false;
  }

  const node: SceneNode | undefined = document.scene.nodes[nodeId];
  if (!node || !node.visible) {
    memo.set(nodeId, false);
    return false;
  }
  if (node.parentId === null) {
    memo.set(nodeId, true);
    return true;
  }

  visiting.add(nodeId);
  const visible = resolveSceneNodeEffectiveVisibility(document, node.parentId, memo, visiting);
  visiting.delete(nodeId);
  memo.set(nodeId, visible);
  return visible;
};

export const isSceneNodeEffectivelyVisible = (document: ProjectDocument, nodeId: string): boolean =>
  resolveSceneNodeEffectiveVisibility(document, nodeId, new Map(), new Set());

export const effectivelyVisibleSceneNodeIds = (document: ProjectDocument): ReadonlySet<string> => {
  const memo = new Map<string, boolean>();
  const visibleIds = new Set<string>();
  for (const nodeId of Object.keys(document.scene.nodes)) {
    if (resolveSceneNodeEffectiveVisibility(document, nodeId, memo, new Set())) {
      visibleIds.add(nodeId);
    }
  }
  return visibleIds;
};
