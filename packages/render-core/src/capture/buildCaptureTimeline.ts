import type {
  ProjectDocument,
  SceneNode
} from '@ashfox/engine-core';
import { effectivelyVisibleSceneNodeIds } from '@ashfox/engine-core';

import { resolveBuildReviewClip } from './buildReviewClip';

export const BUILD_CAPTURE_FPS = 10;
export const MAX_BUILD_CAPTURE_FRAMES = 300;

export type BuildCaptureCategory =
  | 'start'
  | 'geometry'
  | 'texture'
  | 'motion'
  | 'complete';

export interface BuildCaptureEvent {
  readonly id: string;
  readonly category: BuildCaptureCategory;
  readonly label: string;
  readonly nodeId: string | null;
  readonly holdFrames: number;
}

export interface BuildCaptureFrame {
  readonly index: number;
  readonly eventIndex: number;
  readonly eventFrameIndex: number;
  readonly event: BuildCaptureEvent;
  readonly progress: number;
}

export interface BuildCapturePlan {
  readonly fps: number;
  readonly events: readonly BuildCaptureEvent[];
  readonly frames: readonly BuildCaptureFrame[];
}

const renderableNodes = (
  document: ProjectDocument
): readonly Extract<SceneNode, { kind: 'cube' | 'plane' }>[] => {
  const effectivelyVisible = effectivelyVisibleSceneNodeIds(document);
  return Object.values(document.scene.nodes).filter(
    (node): node is Extract<SceneNode, { kind: 'cube' | 'plane' }> =>
      effectivelyVisible.has(node.id) &&
      (node.kind === 'cube' || node.kind === 'plane')
  );
};

const nodeHasTexture = (
  node: Extract<SceneNode, { kind: 'cube' | 'plane' }>
): boolean => Object.values(node.faces).some(
  (face) => face.enabled && face.textureId !== null
);

const event = (
  id: string,
  category: BuildCaptureCategory,
  label: string,
  nodeId: string | null,
  holdFrames: number
): BuildCaptureEvent => Object.freeze({
  id,
  category,
  label,
  nodeId,
  holdFrames
});

const buildEvents = (
  document: ProjectDocument
): readonly BuildCaptureEvent[] => {
  const nodes = renderableNodes(document);
  if (nodes.length === 0) {
    throw new Error('Build replay requires visible model geometry.');
  }
  const events: BuildCaptureEvent[] = [
    event('start', 'start', 'Start from an empty scene', null, 5)
  ];
  for (const node of nodes) {
    events.push(event(
      `geometry:${node.id}`,
      'geometry',
      `Place ${node.kind} · ${node.id}`,
      node.id,
      1
    ));
  }
  for (const node of nodes) {
    if (!nodeHasTexture(node)) continue;
    events.push(event(
      `texture:${node.id}`,
      'texture',
      `Apply texture · ${node.id}`,
      node.id,
      1
    ));
  }
  if (resolveBuildReviewClip(document) !== null) {
    events.push(event(
      'motion',
      'motion',
      'Activate canonical authored idle motion',
      null,
      12
    ));
  }
  events.push(event(
    'complete',
    'complete',
    'Build complete',
    null,
    15
  ));
  return Object.freeze(events);
};

export const createBuildCapturePlan = (
  document: ProjectDocument
): BuildCapturePlan => {
  const events = buildEvents(document);
  const requestedFrames = events.reduce(
    (total, current) => total + current.holdFrames,
    0
  );
  if (requestedFrames > MAX_BUILD_CAPTURE_FRAMES) {
    throw new Error(
      `Build replay needs ${requestedFrames} frames; the exact limit is ` +
      `${MAX_BUILD_CAPTURE_FRAMES}. Reduce explicit renderable elements.`
    );
  }
  const frames: BuildCaptureFrame[] = [];
  for (let eventIndex = 0; eventIndex < events.length; eventIndex += 1) {
    const current = events[eventIndex];
    if (!current) continue;
    for (
      let eventFrameIndex = 0;
      eventFrameIndex < current.holdFrames;
      eventFrameIndex += 1
    ) {
      frames.push({
        index: frames.length,
        eventIndex,
        eventFrameIndex,
        event: current,
        progress: 0
      });
    }
  }
  const lastFrameIndex = Math.max(1, frames.length - 1);
  return Object.freeze({
    fps: BUILD_CAPTURE_FPS,
    events,
    frames: Object.freeze(frames.map((frame) => Object.freeze({
      ...frame,
      progress: frame.index / lastFrameIndex
    })))
  });
};
