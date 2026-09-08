import type { ProjectDocument } from '@ashfox/engine-core';

export const resolveSelectedNodeId = (
  document: ProjectDocument,
  preferredId: string | null
): string | null => {
  if (preferredId === null) return null;
  if (preferredId && document.scene.nodes[preferredId]) {
    return preferredId;
  }
  return (
    document.scene.roots.find((id) => document.scene.nodes[id]) ??
    Object.keys(document.scene.nodes)[0] ??
    null
  );
};

export const resolveActiveClipId = (
  document: ProjectDocument,
  preferredId: string | null
): string | null => {
  if (preferredId === null) return null;
  return document.animations[preferredId]
    ? preferredId
    : Object.keys(document.animations)[0] ?? null;
};

/**
 * Keeps the visible clip selection aligned with a newly opened project while
 * preserving an existing selection, including an explicit rest-pose choice,
 * during ordinary document edits.
 */
export const synchronizeActiveClipId = (
  document: ProjectDocument,
  preferredId: string | null,
  projectChanged: boolean
): string | null => {
  const firstClipId = Object.keys(document.animations)[0] ?? null;
  if (firstClipId === null) return null;
  if (
    projectChanged ||
    (preferredId !== null && document.animations[preferredId] === undefined)
  ) {
    return firstClipId;
  }
  return preferredId;
};
