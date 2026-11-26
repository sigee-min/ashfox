/// <reference path="../gifenc.d.ts" />
import * as THREE from 'three';
import { GIFEncoder, applyPalette, quantize } from 'gifenc';

import { collectStructureCutBands } from '@ashfox/engine-core';
import { applyEyeLevelCamera, frameBoxAtAngles } from '../cameraPresets';
import {
  createCaptureSurface,
  disposeCaptureSurface,
  type CaptureSurface,
} from '../captureSurface';
import {
  buildStructureScene,
  createTwilightSkyTexture,
  frameStructureShadows,
  type StructureObservationPayload,
  type StructureObservationSlice,
  type StructureSceneBuildOptions,
  type StructureSceneHandle,
} from '../structureRender';
import { createViewportEnvironment } from '../viewportEnvironment';
import type { ViewOptions } from './contract';
import { base64Bytes, createCanvas2d, fillBackground } from './modelRender';
import {
  computeInteriorCameras,
  detectFrontAzimuth,
  frameHeroAngles,
  resolveRaycastInteriorCameras,
  resolveSingleAzimuth,
  tileSpecs,
  type ExteriorTileSpec,
  type InteriorCameraSpec,
} from './structCamera';

const drawSheetBadge = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  label: string,
): void => {
  ctx.font = 'bold 11px monospace';
  const padX = 6;
  const textWidth = Math.ceil(ctx.measureText(label).width);
  ctx.fillStyle = 'rgba(15, 18, 24, 0.82)';
  ctx.fillRect(x + 6, y + 6, textWidth + padX * 2, 18);
  ctx.fillStyle = '#f0f4f8';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, x + 6 + padX, y + 15);
};

const drawGridDividers = (
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  cols: number,
  rows: number,
  tileW: number,
  tileH: number,
): void => {
  ctx.fillStyle = '#16191f';
  for (let c = 1; c < cols; c += 1) ctx.fillRect(c * tileW - 1, 0, 2, h);
  for (let r = 1; r < rows; r += 1) ctx.fillRect(0, r * tileH - 1, w, 2);
};

const deriveCutSlices = (
  payload: StructureObservationPayload,
): readonly StructureObservationSlice[] =>
  payload.cutSlices && payload.cutSlices.length > 0
    ? payload.cutSlices
    : collectStructureCutBands(payload.floors, payload.size[1]);

type SheetEnvironmentId = ViewOptions['environment'] | 'blueprint' | 'twilight';

const applySurfaceBackdrop = (
  surface: CaptureSurface,
  backgroundStyle: ViewOptions['background'],
  envId: SheetEnvironmentId,
): (() => void) | null => {
  surface.scene.fog = null;
  if (backgroundStyle !== 'environment') {
    surface.scene.background = null;
    surface.renderer.setClearColor(0x000000, 0);
    return null;
  }
  if (envId === 'blueprint') {
    surface.scene.background = new THREE.Color('#131924');
    return null;
  }
  if (envId === 'twilight') {
    const sky = createTwilightSkyTexture();
    surface.scene.background = sky;
    return () => sky.dispose();
  }
  const env = createViewportEnvironment(envId);
  surface.scene.background = env.background;
  return () => env.dispose();
};

type TileRenderOptions = StructureSceneBuildOptions & {
  readonly envId: SheetEnvironmentId;
  readonly positionCamera: (
    bounds: THREE.Box3,
    camera: THREE.PerspectiveCamera,
    root: THREE.Group,
  ) => void;
};

type SceneCacheEntry = {
  readonly opts: StructureSceneBuildOptions;
  readonly handle: StructureSceneHandle;
};

const sameSceneOptions = (a: StructureSceneBuildOptions, b: StructureSceneBuildOptions): boolean =>
  a.bakedMesh === b.bakedMesh &&
  a.clipY === b.clipY &&
  (a.twilight ?? false) === (b.twilight ?? false) &&
  (a.interiorFill ?? false) === (b.interiorFill ?? false) &&
  a.dioramaBase === b.dioramaBase;

const acquireCachedScene = async (
  cache: SceneCacheEntry[],
  payload: StructureObservationPayload,
  options: TileRenderOptions,
  signal: AbortSignal,
): Promise<StructureSceneHandle> => {
  const hit = cache.find((entry) => sameSceneOptions(entry.opts, options));
  if (hit) return hit.handle;
  const handle = await buildStructureScene(payload, options, signal);
  cache.push({ opts: options, handle });
  return handle;
};

const renderTileToCanvas = async (
  surface: CaptureSurface,
  tileCanvas: ReturnType<typeof createCanvas2d>,
  payload: StructureObservationPayload,
  v: ViewOptions,
  options: TileRenderOptions,
  sceneCache: SceneCacheEntry[],
  signal: AbortSignal,
): Promise<void> => {
  surface.renderer.localClippingEnabled =
    options.clipY !== undefined && options.bakedMesh === undefined;
  const handle = await acquireCachedScene(sceneCache, payload, options, signal);
  surface.scene.add(handle.root);
  const disposeBackdrop = applySurfaceBackdrop(surface, v.background, options.envId);
  try {
    frameStructureShadows(surface.scene, handle.bounds, options.twilight ?? false);
    options.positionCamera(handle.bounds, surface.camera, handle.root);
    surface.renderer.render(surface.scene, surface.camera);
    const bg = v.background === 'environment' ? 'transparent' : v.background;
    fillBackground(tileCanvas.context, tileCanvas.canvas.width, tileCanvas.canvas.height, bg);
    tileCanvas.context.drawImage(surface.renderCanvas, 0, 0);
  } finally {
    disposeBackdrop?.();
    surface.scene.remove(handle.root);
  }
};

const renderGridSheet = async (
  cols: number,
  rows: number,
  v: ViewOptions,
  sheetBg: string,
  renderItem: (
    idx: number,
    surface: CaptureSurface,
    tileCanvas: ReturnType<typeof createCanvas2d>,
  ) => Promise<string | null>,
): Promise<{ mime: string; data: string }> => {
  const tileW = Math.max(16, Math.floor(v.width / cols));
  const tileH = Math.max(16, Math.floor(v.height / rows));
  const sheetCanvas = createCanvas2d(v.width, v.height);
  fillBackground(sheetCanvas.context, v.width, v.height, sheetBg);
  const surface = createCaptureSurface({
    width: tileW,
    height: tileH,
    cameraMode: 'perspective',
    environment: v.environment,
    forward: 'north',
  });
  const tileCanvas = createCanvas2d(tileW, tileH);
  try {
    const total = cols * rows;
    for (let idx = 0; idx < total; idx += 1) {
      const label = await renderItem(idx, surface, tileCanvas);
      if (label === null) continue;
      const dx = (idx % cols) * tileW;
      const dy = Math.floor(idx / cols) * tileH;
      sheetCanvas.context.drawImage(tileCanvas.canvas, dx, dy);
      if (label.length > 0) drawSheetBadge(sheetCanvas.context, dx, dy, label);
    }
    drawGridDividers(sheetCanvas.context, v.width, v.height, cols, rows, tileW, tileH);
    return { mime: 'image/png', data: sheetCanvas.canvas.toDataURL('image/png').split(',')[1] };
  } finally {
    disposeCaptureSurface(surface);
  }
};

type SheetTileConfig = TileRenderOptions & { readonly label: string };

const renderConfiguredSheet = async (
  cols: number,
  rows: number,
  tiles: readonly SheetTileConfig[],
  payload: StructureObservationPayload,
  v: ViewOptions,
  signal: AbortSignal,
  sheetBg?: string,
) => {
  const sceneCache: SceneCacheEntry[] = [];
  try {
    return await renderGridSheet(
      cols,
      rows,
      v,
      sheetBg ?? (v.background === 'environment' ? 'transparent' : v.background),
      async (idx, surface, tileCanvas) => {
        const tile = tiles[idx];
        if (!tile) return null;
        await renderTileToCanvas(surface, tileCanvas, payload, v, tile, sceneCache, signal);
        return tile.label;
      },
    );
  } finally {
    for (const entry of sceneCache) entry.handle.dispose();
  }
};

const angleTiles = (
  defaultEnv: SheetEnvironmentId,
  specs: readonly ExteriorTileSpec[],
  zoom: number,
): readonly SheetTileConfig[] =>
  specs.map((spec) => ({
    label: spec.label,
    twilight: spec.twilight,
    envId: spec.twilight ? 'twilight' : defaultEnv,
    positionCamera: (bounds, cam) =>
      frameHeroAngles(cam, bounds, spec.azimuth, spec.elevation, zoom),
  }));

const cutawayTiles = (
  slices: readonly StructureObservationSlice[],
  zoom: number,
): readonly SheetTileConfig[] => {
  const base: SheetTileConfig[] = slices.map((s) => ({
    label: s.label,
    bakedMesh: s.bakedMesh,
    clipY: s.cutY,
    envId: 'blueprint',
    positionCamera: (b, cam) => frameBoxAtAngles(cam, b, 35, 58, zoom * 1.18, 42, 1.04),
  }));
  if (base.length === 3) {
    base.push({
      label: 'ISOMETRIC OVERVIEW',
      envId: 'blueprint',
      dioramaBase: false,
      positionCamera: (b, cam) => frameBoxAtAngles(cam, b, -135, 24, zoom * 1.12, 42, 1.03),
    });
  }
  return base;
};

const interiorTiles = (
  payload: StructureObservationPayload,
  cams: readonly InteriorCameraSpec[],
  envId: SheetEnvironmentId,
): readonly SheetTileConfig[] => {
  let raycastCams: readonly InteriorCameraSpec[] | null = null;
  return cams.map((cam, idx) => ({
    label: cam.label,
    interiorFill: true,
    envId,
    positionCamera: (_b, camObj, root) => {
      if (!raycastCams) raycastCams = resolveRaycastInteriorCameras(root, payload);
      const chosen = raycastCams[idx] ?? cam;
      applyEyeLevelCamera(camObj, chosen.eye, chosen.lookAt, 65);
    },
  }));
};

const buildSheetPlan = (
  payload: StructureObservationPayload,
  v: ViewOptions,
): { cols: number; rows: number; tiles: readonly SheetTileConfig[]; sheetBg?: string } => {
  const frontAz = detectFrontAzimuth(payload);
  if (v.sheet === 'exterior') {
    const dayEnv = v.environment === 'studio' ? 'day' : v.environment;
    return { cols: 2, rows: 3, tiles: angleTiles(dayEnv, tileSpecs(frontAz, 'exterior'), v.zoom) };
  }
  if (v.sheet === 'cutaway') {
    const slices = deriveCutSlices(payload);
    const tiles = cutawayTiles(slices, v.zoom);
    const sheetBg = v.background === 'environment' ? '#131924' : v.background;
    return { cols: 2, rows: Math.max(1, Math.ceil(tiles.length / 2)), tiles, sheetBg };
  }
  if (v.sheet === 'interior') {
    const cams = computeInteriorCameras(payload);
    const cols = cams.length === 1 ? 1 : 2;
    return {
      cols,
      rows: Math.max(1, Math.ceil(cams.length / cols)),
      tiles: interiorTiles(payload, cams, v.environment),
    };
  }
  if (v.sheet === 'turnaround') {
    return {
      cols: 2,
      rows: 2,
      tiles: angleTiles(v.environment, tileSpecs(frontAz, 'turnaround'), v.zoom),
    };
  }
  const az = resolveSingleAzimuth(payload, v);
  const el = v.elevation ?? (v.camera === 'top' ? 88 : v.camera === 'bottom' ? -88 : 22);
  const single: SheetTileConfig = {
    label: '',
    clipY: v.cutaway,
    ...(el < 0 ? { dioramaBase: false } : {}),
    envId: v.environment,
    positionCamera: (b, cam) => frameHeroAngles(cam, b, az, el, v.zoom),
  };
  return { cols: 1, rows: 1, tiles: [single] };
};

/** Captures single-view or 3-mode architectural sheets for structures. */
export const captureStructureObservation = async (
  payload: StructureObservationPayload,
  v: ViewOptions,
  signal: AbortSignal,
): Promise<{ mime: string; data: string }> => {
  const plan = buildSheetPlan(payload, v);
  return renderConfiguredSheet(plan.cols, plan.rows, plan.tiles, payload, v, signal, plan.sheetBg);
};

const writeStructGifFrame = (
  encoder: ReturnType<typeof GIFEncoder>,
  output: ReturnType<typeof createCanvas2d>,
  v: ViewOptions,
  index: number,
): void => {
  const rgba = output.context.getImageData(0, 0, v.width, v.height).data;
  const palette = quantize(rgba, 128, { format: 'rgba4444' });
  const transparentIndex = palette.findIndex((color) => color.length === 4 && color[3] === 0);
  encoder.writeFrame(applyPalette(rgba, palette, 'rgba4444'), v.width, v.height, {
    palette,
    delay: 1000 / v.fps,
    repeat: index === 0 ? 0 : undefined,
    transparent: transparentIndex >= 0,
    transparentIndex: transparentIndex >= 0 ? transparentIndex : undefined,
    dispose: 2,
  });
  if (encoder.bytesView().length > 32 * 1024 * 1024) throw new Error('GIF exceeds 32 MiB');
};

const attachBuildClipPlane = (root: THREE.Group, plane: THREE.Plane): void => {
  root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const mat of mats) if (mat) mat.clippingPlanes = [plane];
  });
};

const prepareBuildClip = (
  surface: CaptureSurface,
  root: THREE.Group,
  v: ViewOptions,
): THREE.Plane | null => {
  if (v.mode !== 'build' || v.cutaway !== undefined) {
    surface.renderer.localClippingEnabled = v.cutaway !== undefined;
    return null;
  }
  const plane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 1);
  surface.renderer.localClippingEnabled = true;
  attachBuildClipPlane(root, plane);
  return plane;
};

const renderStructureGifFrames = (
  payload: StructureObservationPayload,
  surface: CaptureSurface,
  output: ReturnType<typeof createCanvas2d>,
  handle: StructureSceneHandle,
  v: ViewOptions,
  frames: number,
  clipPlane: THREE.Plane | null,
): Uint8Array => {
  const baseAz = resolveSingleAzimuth(payload, v);
  const el = v.elevation ?? (v.camera === 'top' ? 88 : v.camera === 'bottom' ? -88 : 22);
  const bg = v.background === 'environment' ? 'transparent' : v.background;
  const encoder = GIFEncoder();
  for (let i = 0; i < frames; i += 1) {
    if (clipPlane) clipPlane.constant = 1 + (payload.size[1] * (i + 1)) / frames;
    frameHeroAngles(surface.camera, handle.bounds, baseAz + (360 * i) / frames, el, v.zoom);
    surface.renderer.render(surface.scene, surface.camera);
    fillBackground(output.context, v.width, v.height, bg);
    output.context.drawImage(surface.renderCanvas, 0, 0);
    writeStructGifFrame(encoder, output, v, i);
  }
  encoder.finish();
  return encoder.bytes();
};

/** Renders structure turntable or build-reveal GIF directly from bakedMesh. */
export const captureStructureGif = async (
  payload: StructureObservationPayload,
  v: ViewOptions,
  signal: AbortSignal,
): Promise<{ mime: string; data: string }> => {
  const frames = Math.ceil((v.duration ?? 3) * v.fps);
  if (frames > 300 || frames * v.width * v.height > 100000000)
    throw new Error('Replay exceeds 300 frames or 100 million pixels');
  const twilight = v.environment === 'evening' || v.environment === 'night';
  const handle = await buildStructureScene(payload, { clipY: v.cutaway, twilight }, signal);
  const surface = createCaptureSurface({
    width: v.width,
    height: v.height,
    cameraMode: 'perspective',
    environment: v.environment,
    forward: 'north',
  });
  const output = createCanvas2d(v.width, v.height);
  const disposeBackdrop = applySurfaceBackdrop(surface, v.background, v.environment);
  try {
    surface.scene.add(handle.root);
    frameStructureShadows(surface.scene, handle.bounds, twilight);
    const clipPlane = prepareBuildClip(surface, handle.root, v);
    const bytes = renderStructureGifFrames(payload, surface, output, handle, v, frames, clipPlane);
    return { mime: 'image/gif', data: base64Bytes(bytes) };
  } finally {
    disposeBackdrop?.();
    surface.scene.remove(handle.root);
    handle.dispose();
    disposeCaptureSurface(surface);
  }
};
