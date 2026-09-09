'use client';

import {
  useEffect,
  useRef,
  type PointerEvent as ReactPointerEvent
} from 'react';
import { useLatestValue } from '../../hooks/useLatestValue';
import { applyAnimationPose } from '@ashfox/render-core/animationPose';
import { projectToThreeScene } from '@ashfox/render-core/projection';
import { useViewportRuntime } from './viewport/useViewportRuntime';
import {
  applyCameraCommand,
  applyViewportEnvironment
} from './viewport/viewportRuntime';
import {
  reportViewportFrame
} from './viewport/reportViewportFrame';
import type { ViewportProps } from './viewport/viewportTypes';

export function Viewport({
  document,
  assets,
  options,
  environment,
  cameraCommand,
  activeClipId,
  playhead,
  playing,
  presentationNonce,
  onSelectNode,
  onStats,
  onPresented
}: ViewportProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cameraCommandRef = useLatestValue(cameraCommand);
  const onSelectNodeRef = useLatestValue(onSelectNode);
  const onStatsRef = useLatestValue(onStats);
  const onPresentedRef = useLatestValue(onPresented);
  const presentationStateRef = useLatestValue({
    projectId: document.id,
    revision: document.revision,
    documentReference: document,
    camera: cameraCommand.mode,
    clipId: activeClipId,
    playing,
    timeSeconds: playhead
  });
  const pendingPresentationRef = useRef<number | null>(null);
  const evidenceCaptureRef = useRef<number | null>(null);
  const framedProjectIdRef = useRef<string | null>(null);
  const onFrameRef = useLatestValue((frameNonce: number): void => {
    reportViewportFrame({
      frameNonce,
      presentationNonce: pendingPresentationRef.current,
      presentation: presentationStateRef.current,
      runtime: runtimeRef.current,
      evidenceCaptureRef,
      onPresented: onPresentedRef.current
    });
  });

  const runtimeRef = useViewportRuntime(hostRef, canvasRef, {
    onSelectNode: onSelectNodeRef,
    onStats: onStatsRef,
    onFrame: onFrameRef
  });
  const authoredForward = document.settings.forward;

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;

    if (runtime.projection) {
      runtime.scene.remove(runtime.projection.root);
      runtime.projection.dispose();
    }

    const projection = projectToThreeScene(document, {
      assets,
      showSkeleton: options.showSkeleton,
      showWireframe: options.showWireframe
    });
    runtime.projection = projection;
    runtime.scene.add(projection.root);
    if (framedProjectIdRef.current !== document.id) {
      applyCameraCommand(
        runtime,
        cameraCommandRef.current,
        authoredForward
      );
      framedProjectIdRef.current = document.id;
    }
  }, [
    assets,
    cameraCommandRef,
    document,
    options.showSkeleton,
    options.showWireframe,
    authoredForward,
    runtimeRef
  ]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    const projection = runtime?.projection;
    if (!runtime || !projection) return;
    applyAnimationPose(document, projection, activeClipId, playhead);
  }, [activeClipId, document, playhead, playing, runtimeRef]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    runtime.grid.visible = options.showGrid;
  }, [options.showGrid, runtimeRef]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (runtime) applyViewportEnvironment(runtime, environment);
  }, [environment, runtimeRef]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (runtime) applyCameraCommand(
      runtime,
      cameraCommand,
      authoredForward
    );
  }, [authoredForward, cameraCommand, runtimeRef]);

  useEffect(() => {
    pendingPresentationRef.current =
      presentationNonce > 0 ? presentationNonce : null;
  }, [
    activeClipId,
    cameraCommand,
    document.revision,
    playhead,
    playing,
    presentationNonce
  ]);

  const stopContextMenu = (event: ReactPointerEvent): void => {
    if (event.button === 2) event.preventDefault();
  };

  return (
    <div
      ref={hostRef}
      className="viewport-host"
      data-testid="viewport"
      onPointerDown={stopContextMenu}
    >
      <canvas ref={canvasRef} aria-label="3D project viewport" />
      <div className="viewport-gradient" />
      <div className="viewport-help">
        <span><b>LMB</b> orbit</span>
        <span><b>RMB</b> pan</span>
        <span><b>Wheel</b> zoom</span>
      </div>
    </div>
  );
}
