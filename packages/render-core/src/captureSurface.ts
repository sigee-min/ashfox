import * as THREE from 'three';

import type {
  ProjectDocument,
  ProjectForwardDirection,
  ProjectSignedView
} from '@ashfox/engine-core';

import type { CameraMode } from './cameraPresets';
import {
  applyCameraPreset,
  applySignedProjectViewPreset
} from './cameraPresets';
import type {
  ProjectSceneProjection
} from './sceneTypes';
import {
  addViewportLighting,
  createViewportEnvironment,
  type ViewportEnvironment,
  type ViewportEnvironmentId
} from './viewportEnvironment';
import {
  captureAbortError,
  throwIfCaptureAborted
} from './captureAbort';

export interface CaptureDimensions {
  width: number;
  height: number;
}

interface CaptureSurfaceSharedOptions extends CaptureDimensions {
  environment: ViewportEnvironmentId;
  forward?: ProjectForwardDirection;
}

/** Deterministic exports must use the explicit authored forward, never a camera default. */
export const requiredCaptureForward = (
  document: ProjectDocument
): ProjectForwardDirection => document.settings.forward;

export type CaptureSurfaceOptions = Readonly<
  | CaptureSurfaceSharedOptions & {
      cameraMode: CameraMode;
      signedView?: never;
    }
  | CaptureSurfaceSharedOptions & {
      cameraMode?: never;
      signedView: ProjectSignedView;
    }
>;

export interface CaptureSurface extends CaptureDimensions {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderCanvas: HTMLCanvasElement;
  environment: ViewportEnvironment;
  forward: ProjectForwardDirection;
  /** The exact signed proof view, when this surface was created for one. */
  signedView: ProjectSignedView | null;
}

const createRenderer = (
  canvas: HTMLCanvasElement,
  dimensions: CaptureDimensions
): THREE.WebGLRenderer => {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    preserveDrawingBuffer: true,
    powerPreference: 'high-performance'
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.setPixelRatio(1);
  renderer.setSize(dimensions.width, dimensions.height, false);
  return renderer;
};

export const createCaptureSurface = (
  options: CaptureSurfaceOptions
): CaptureSurface => {
  const renderCanvas = window.document.createElement('canvas');
  const renderer = createRenderer(renderCanvas, options);
  const scene = new THREE.Scene();
  const environment = createViewportEnvironment(options.environment);
  scene.background = environment.background;
  scene.fog = environment.fog;
  addViewportLighting(scene);

  const camera = new THREE.PerspectiveCamera(
    42,
    options.width / options.height,
    0.05,
    300
  );
  const forward = options.forward ?? 'north';
  const signedView = options.signedView ?? null;
  if (options.signedView === undefined) {
    applyCameraPreset(camera, options.cameraMode, undefined, forward);
  } else {
    applySignedProjectViewPreset(camera, options.signedView, undefined, forward);
  }

  return {
    renderer,
    scene,
    camera,
    renderCanvas,
    environment,
    forward,
    signedView,
    width: options.width,
    height: options.height
  };
};

const CAPTURE_FRAME_DISTANCE_SCALE = 0.82;

export const frameCaptureObject = (
  surface: CaptureSurface,
  cameraMode: CameraMode,
  object: THREE.Object3D
): void => {
  const target = surface.signedView === null
    ? applyCameraPreset(
        surface.camera,
        cameraMode,
        object,
        surface.forward
      )
    : applySignedProjectViewPreset(
        surface.camera,
        surface.signedView,
        object,
        surface.forward
      );
  const offset = surface.camera.position
    .clone()
    .sub(target)
    .multiplyScalar(CAPTURE_FRAME_DISTANCE_SCALE);
  surface.camera.position.copy(target).add(offset);
  surface.camera.lookAt(target);
  surface.camera.updateProjectionMatrix();

  // Build replays must keep every authored edge readable.
  // Environment fog remains available in the live viewport, but it should
  // not wash out large models in exported marketing artifacts.
  surface.scene.fog = null;
};

export const renderCaptureSurface = (
  surface: CaptureSurface
): void => {
  surface.renderer.render(surface.scene, surface.camera);
};

export const disposeCaptureSurface = (
  surface: CaptureSurface
): void => {
  surface.environment.dispose();
  surface.renderer.dispose();
};

export const waitForProjectionTextures = async (
  projection: ProjectSceneProjection,
  signal: AbortSignal
): Promise<void> => {
  throwIfCaptureAborted(signal);
  let abort: (() => void) | null = null;
  const aborted = new Promise<never>((_resolve, reject) => {
    abort = () => reject(captureAbortError());
    signal.addEventListener('abort', abort, { once: true });
  });
  try {
    await Promise.race([projection.ready, aborted]);
  } finally {
    if (abort) signal.removeEventListener('abort', abort);
  }
  throwIfCaptureAborted(signal);
  if (projection.readiness.status === 'failed') {
    throw new Error(
      projection.readiness.error ??
      'A project texture could not be decoded.'
    );
  }
  if (projection.readiness.status !== 'ready') {
    throw new Error('Project textures did not reach a ready state.');
  }
};
