import type { ProjectDocument } from '@ashfox/engine-core';
import { projectToThreeScene } from '../projection';
import {
  createCaptureSurface,
  disposeCaptureSurface,
  waitForProjectionTextures,
} from '../captureSurface';
import { renderBuildGif } from '../capture/renderBuildGif';
import type { ViewOptions } from './contract';
import {
  applyNodeVisibilityFilter,
  base64Bytes,
  computeTargetFraming,
  createCanvas2d,
  fillBackground,
  renderModelFrames,
} from './modelRender';

interface Payload {
  readonly document?: ProjectDocument;
  readonly png?: string;
  readonly wave?: readonly number[];
}
let loaded: Payload = {};
export const load = (payload: Payload): void => {
  loaded = payload;
};

const capturePngAsset = async (
  png: string,
  v: ViewOptions,
): Promise<{ mime: string; data: string }> => {
  const img = new Image();
  img.src = 'data:image/png;base64,' + png;
  await img.decode();
  const width = img.width * v.scale;
  const height = img.height * v.scale;
  if (width > 4096 || height > 4096) throw new Error('Scaled image exceeds 4096 pixels');
  const { canvas, context } = createCanvas2d(width, height);
  fillBackground(
    context,
    width,
    height,
    v.background === 'environment' ? 'transparent' : v.background,
  );
  context.imageSmoothingEnabled = false;
  context.drawImage(img, 0, 0, width, height);
  return { mime: 'image/png', data: canvas.toDataURL('image/png').split(',')[1] };
};

const captureWaveAsset = (
  wave: readonly number[],
  v: ViewOptions,
): { mime: string; data: string } => {
  const { canvas, context } = createCanvas2d(v.width, v.height);
  fillBackground(context, v.width, v.height, v.background);
  context.strokeStyle = '#dca35f';
  context.beginPath();
  wave.forEach((amplitude, x) => {
    const px = (x / (wave.length - 1)) * v.width;
    context.moveTo(px, ((1 - amplitude) * v.height) / 2);
    context.lineTo(px, ((1 + amplitude) * v.height) / 2);
  });
  context.stroke();
  return { mime: 'image/png', data: canvas.toDataURL('image/png').split(',')[1] };
};

const captureNonModelAsset = async (
  v: ViewOptions,
  replay: boolean,
): Promise<{ mime: string; data: string }> => {
  if (replay) throw new Error('Replay requires a model');
  if (loaded.png) return capturePngAsset(loaded.png, v);
  if (loaded.wave) return captureWaveAsset(loaded.wave, v);
  throw new Error('No renderable asset loaded');
};

const captureBuildReplay = async (
  model: ProjectDocument,
  v: ViewOptions,
): Promise<{ mime: string; data: string }> => {
  const hasUnsupported =
    v.azimuth !== undefined ||
    v.elevation !== undefined ||
    v.width !== 640 ||
    v.height !== 360 ||
    v.fps !== 10 ||
    v.background !== 'environment' ||
    v.zoom !== 1 ||
    Boolean(v.node) ||
    v.wireframe ||
    v.skeleton ||
    !v.textures ||
    Boolean(v.clip) ||
    v.duration !== undefined ||
    v.time !== 0;
  if (hasUnsupported)
    throw new Error(
      'Build replay uses fixed 640x360/10fps and canonical timeline; use camera/environment presets',
    );
  if (v.camera === 'back' || v.camera === 'bottom')
    throw new Error('Build replay camera supports perspective/native/front/left/right/top');
  const result = await renderBuildGif({
    document: model,
    assets: {},
    environment: v.environment,
    cameraMode: v.camera,
    signal: new AbortController().signal,
  });
  return { mime: 'image/gif', data: base64Bytes(result.bytes) };
};

interface SheetTileSpec {
  readonly label: string;
  readonly camera: ViewOptions['camera'];
  readonly azimuth?: number;
  readonly elevation?: number;
  readonly wireframe?: boolean;
  readonly skeleton?: boolean;
}

const SHEET_TILES: Readonly<Record<'turnaround' | 'inspect', readonly SheetTileSpec[]>> = {
  turnaround: [
    { label: 'FRONT', camera: 'front' },
    { label: '3/4', camera: 'perspective', azimuth: 45, elevation: 20 },
    { label: 'SIDE', camera: 'left' },
    { label: 'BACK', camera: 'back' },
  ],
  inspect: [
    { label: '3/4', camera: 'perspective', azimuth: 45, elevation: 20 },
    { label: 'FRONT', camera: 'front' },
    {
      label: 'WIRE+RIG',
      camera: 'perspective',
      azimuth: 45,
      elevation: 20,
      wireframe: true,
      skeleton: true,
    },
    { label: 'TOP', camera: 'top' },
  ],
};

const drawTileBadge = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  label: string,
): void => {
  ctx.font = 'bold 11px monospace';
  const padX = 6;
  const textWidth = Math.ceil(ctx.measureText(label).width);
  ctx.fillStyle = 'rgba(15, 18, 24, 0.78)';
  ctx.fillRect(x + 6, y + 6, textWidth + padX * 2, 18);
  ctx.fillStyle = '#f0f4f8';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, x + 6 + padX, y + 15);
};

const renderSheetTile = async (
  model: ProjectDocument,
  v: ViewOptions,
  clip: ProjectDocument['animations'][string] | undefined,
  surface: ReturnType<typeof createCaptureSurface>,
  tileCanvas: ReturnType<typeof createCanvas2d>,
  spec: SheetTileSpec,
): Promise<void> => {
  const tv: ViewOptions = {
    ...v,
    width: tileCanvas.canvas.width,
    height: tileCanvas.canvas.height,
    camera: spec.camera,
    azimuth: spec.azimuth,
    elevation: spec.elevation,
    wireframe: spec.wireframe ?? v.wireframe,
    skeleton: spec.skeleton ?? v.skeleton,
    sheet: undefined,
  };
  const projection = projectToThreeScene(model, {
    assets: {},
    showSkeleton: tv.skeleton,
    showTextures: tv.textures,
    showWireframe: tv.wireframe,
  });
  surface.scene.add(projection.root);
  try {
    await waitForProjectionTextures(projection, new AbortController().signal);
    if (v.node) applyNodeVisibilityFilter(model, projection, v.node);
    const { target, distance } = computeTargetFraming(model, projection, surface, tv, false, clip);
    renderModelFrames(model, projection, surface, tileCanvas, tv, false, clip, 1, target, distance);
  } finally {
    surface.scene.remove(projection.root);
    projection.dispose();
  }
};

const captureSheet = async (
  model: ProjectDocument,
  v: ViewOptions,
  clip: ProjectDocument['animations'][string] | undefined,
): Promise<{ mime: string; data: string }> => {
  const tileW = Math.max(16, Math.floor(v.width / 2));
  const tileH = Math.max(16, Math.floor(v.height / 2));
  const sheetCanvas = createCanvas2d(v.width, v.height);
  fillBackground(
    sheetCanvas.context,
    v.width,
    v.height,
    v.background === 'environment' ? 'transparent' : v.background,
  );
  const surface = createCaptureSurface({
    width: tileW,
    height: tileH,
    cameraMode: 'perspective',
    environment: v.environment,
    forward: model.settings.forward,
  });
  const tileCanvas = createCanvas2d(tileW, tileH);
  try {
    for (const [idx, spec] of SHEET_TILES[v.sheet!].entries()) {
      await renderSheetTile(model, v, clip, surface, tileCanvas, spec);
      const dx = (idx % 2) * tileW;
      const dy = Math.floor(idx / 2) * tileH;
      sheetCanvas.context.drawImage(tileCanvas.canvas, dx, dy);
      drawTileBadge(sheetCanvas.context, dx, dy, spec.label);
    }
    sheetCanvas.context.fillStyle = '#16191f';
    sheetCanvas.context.fillRect(tileW - 1, 0, 2, v.height);
    sheetCanvas.context.fillRect(0, tileH - 1, v.width, 2);
    return { mime: 'image/png', data: sheetCanvas.canvas.toDataURL('image/png').split(',')[1] };
  } finally {
    disposeCaptureSurface(surface);
  }
};

const resolveValidatedClip = (
  model: ProjectDocument,
  v: ViewOptions,
  replay: boolean,
): ProjectDocument['animations'][string] | undefined => {
  const clip = v.clip
    ? Object.values(model.animations).find((c) => c.id === v.clip || c.name === v.clip)
    : undefined;
  if (v.clip && !clip) throw new Error('Unknown clip: ' + v.clip);
  if (replay && v.mode === 'motion' && !clip) throw new Error('Motion replay requires --clip');
  if (v.time > 0 && !clip) throw new Error('A nonzero time requires --clip');
  if (clip && v.time > clip.durationSeconds) throw new Error('Time exceeds clip duration');
  return clip;
};

export const capture = async (
  v: ViewOptions,
  replay: boolean,
): Promise<{ mime: string; data: string }> => {
  if (!loaded.document) return captureNonModelAsset(v, replay);
  const model = loaded.document;
  if (replay && v.mode === 'build') return captureBuildReplay(model, v);
  const clip = resolveValidatedClip(model, v, replay);
  if (!replay && v.sheet !== undefined) return captureSheet(model, v, clip);
  const frames = replay ? Math.ceil((v.duration ?? clip?.durationSeconds ?? 3) * v.fps) : 1;
  if (frames > 300 || frames * v.width * v.height > 100000000)
    throw new Error('Replay exceeds 300 frames or 100 million pixels');
  const projection = projectToThreeScene(model, {
    assets: {},
    showSkeleton: v.skeleton,
    showTextures: v.textures,
    showWireframe: v.wireframe,
  });
  const surface = createCaptureSurface({
    width: v.width,
    height: v.height,
    cameraMode: 'perspective',
    environment: v.environment,
    forward: model.settings.forward,
  });
  const output = createCanvas2d(v.width, v.height);
  try {
    surface.scene.add(projection.root);
    await waitForProjectionTextures(projection, new AbortController().signal);
    if (v.node) applyNodeVisibilityFilter(model, projection, v.node);
    const { target, distance } = computeTargetFraming(model, projection, surface, v, replay, clip);
    return renderModelFrames(
      model,
      projection,
      surface,
      output,
      v,
      replay,
      clip,
      frames,
      target,
      distance,
    );
  } finally {
    projection.dispose();
    disposeCaptureSurface(surface);
  }
};
