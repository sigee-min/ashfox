import type {
  ProjectDocument
} from '@ashfox/engine-core';
import type { ProjectAssets } from '@ashfox/render-core/assets';
import type { CameraMode } from '@ashfox/render-core/cameraPresets';
import type { ViewportEnvironmentId } from '@ashfox/render-core/viewportEnvironment';
import type { PixelFrameEvidence } from '@ashfox/render-core/pixelFrameEvidence';

export interface ViewportOptions {
  showGrid: boolean;
  showSkeleton: boolean;
  showWireframe: boolean;
}

export interface CameraCommand {
  mode: CameraMode;
  nonce: number;
}

export interface ViewportStats {
  calls: number;
  triangles: number;
}

export interface ViewportPresentationFrame {
  presentationNonce: number;
  frameNonce: number;
  projectId: string;
  revision: string;
  /** Internal ownership guard; never serialized into the public result. */
  documentReference: object;
  camera: CameraMode;
  cameraMatrix: readonly number[];
  frameEvidence: PixelFrameEvidence | null;
  frameEvidenceError: string | null;
  clipId: string | null;
  playing: boolean;
  timeSeconds: number;
  projectionStatus: 'pending' | 'ready' | 'failed';
  projectionError: string | null;
}

export interface ViewportProps {
  document: ProjectDocument;
  assets: ProjectAssets;
  options: ViewportOptions;
  environment: ViewportEnvironmentId;
  cameraCommand: CameraCommand;
  activeClipId: string | null;
  playhead: number;
  playing: boolean;
  presentationNonce: number;
  onSelectNode: (nodeId: string | null) => void;
  onStats: (stats: ViewportStats) => void;
  onPresented: (frame: ViewportPresentationFrame) => void;
}
