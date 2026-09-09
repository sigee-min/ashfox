import type { ProjectDocument } from '@ashfox/engine-core';

import type { CameraMode } from '@ashfox/render-core/cameraPresets';
import type { ViewportEnvironmentId } from '@ashfox/render-core/viewportEnvironment';
import type { ArtifactFile } from '../files/artifactFile';
import type { FileOperationState } from '../files/fileOperationState';
import {
  BUILD_CAPTURE_FPS,
  createBuildCapturePlan
} from '@ashfox/render-core/capture/buildCaptureTimeline';
import type { GifCaptureFile } from './gifCaptureFile';
import type { GifCaptureRequest } from './gifCaptureRequest';

export interface CaptureMenuAuthority {
  readonly document: ProjectDocument;
  readonly environment: ViewportEnvironmentId;
  readonly cameraMode: CameraMode;
  readonly operation: Readonly<FileOperationState<ArtifactFile>>;
  readonly captureFile: GifCaptureFile | null;
  readonly canDownload: boolean;
  readonly blockedReason: string | null;
}

export interface CapturePlanSummary {
  readonly frames: number;
  readonly events: number;
  readonly error: string | null;
}

export interface CapturePlanReader {
  readonly read: (authority: CaptureMenuAuthority) => CapturePlanSummary;
}

export interface CaptureMenuViewModel {
  readonly headingMeta: string;
  readonly capturing: boolean;
  readonly ready: boolean;
  readonly framesLabel: string;
  readonly eventsLabel: string;
  readonly cameraLabel: string;
  readonly statusMessage: string;
  readonly statusTone: 'default' | 'error';
  readonly startLabel: string;
  readonly startDisabled: boolean;
  readonly downloadDisabled: boolean;
}

const failedPlan = (error: unknown): CapturePlanSummary => Object.freeze({
  frames: 0,
  events: 0,
  error: error instanceof Error
    ? error.message
    : 'Build replay is unavailable.'
});

export const capturePlanReader: CapturePlanReader = Object.freeze({
  read: (authority: CaptureMenuAuthority) => {
    try {
      const plan = createBuildCapturePlan(authority.document);
      return Object.freeze({
        frames: plan.frames.length,
        events: plan.events.length,
        error: null
      });
    } catch (error: unknown) {
      return failedPlan(error);
    }
  }
});

const readyMessage = (file: GifCaptureFile | null): string | null =>
  file === null
    ? null
    : `Ready · ${file.frameCount} frames · ${file.eventCount} replay steps`;

export const presentCaptureMenu = (
  authority: CaptureMenuAuthority,
  reader: CapturePlanReader = capturePlanReader
): CaptureMenuViewModel => {
  const plan = reader.read(authority);
  const capturing =
    authority.operation.phase === 'running' &&
    authority.operation.kind === 'capture';
  const captureMessage =
    authority.operation.kind === 'capture' &&
    authority.operation.phase !== 'succeeded'
      ? authority.operation.message
      : null;
  const captureFailed =
    authority.operation.kind === 'capture' &&
    authority.operation.phase === 'failed';
  const blocked = authority.blockedReason !== null;
  return Object.freeze({
    headingMeta: `${BUILD_CAPTURE_FPS} fps · 640 × 360 · browser local`,
    capturing,
    ready: authority.captureFile !== null,
    framesLabel: `${plan.frames} frames`,
    eventsLabel: `${plan.events} replay steps`,
    cameraLabel: `${authority.cameraMode} camera`,
    statusMessage: capturing
      ? authority.operation.message
      : plan.error ?? captureMessage ?? authority.blockedReason ??
        readyMessage(authority.captureFile) ??
        'Starts from an empty scene, places every visible element in deterministic canonical element order, applies each element\'s complete owning texture set atomically, activates canonical authored idle motion when available, and holds on the complete model.',
    statusTone: plan.error || captureFailed ? 'error' : 'default',
    startLabel: authority.captureFile
      ? 'Capture again'
      : 'Capture build replay',
    startDisabled: plan.error !== null || blocked,
    downloadDisabled: !authority.canDownload
  });
};

export const captureRequestPort = Object.freeze({
  create: (authority: CaptureMenuAuthority): GifCaptureRequest =>
    Object.freeze({
      kind: 'build',
      environment: authority.environment,
      cameraMode: authority.cameraMode
    })
});
