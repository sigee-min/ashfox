/// <reference path="../gifenc.d.ts" />
import * as THREE from 'three';
import { GIFEncoder, quantize, applyPalette } from 'gifenc';
import type { ProjectDocument } from '@ashfox/engine-core';
import { projectToThreeScene } from '../projection';
import { applyAnimationPose } from '../animationPose';
import {
  createCaptureSurface,
  disposeCaptureSurface,
  waitForProjectionTextures,
} from '../captureSurface';
import { applyCameraPreset, applySignedProjectViewPreset } from '../cameraPresets';
import { renderBuildGif } from '../capture/renderBuildGif';
import type { ViewOptions } from './contract';
interface Payload {
  readonly document?: ProjectDocument;
  readonly png?: string;
  readonly wave?: readonly number[];
}
let loaded: Payload = {};
export const load = (payload: Payload): void => {
  loaded = payload;
};
const base64 = (bytes: Uint8Array): string => {
  let text = '';
  for (let i = 0; i < bytes.length; i += 8192)
    text += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(text);
};
const background = (
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  style: string,
): void => {
  context.clearRect(0, 0, width, height);
  if (style === 'transparent') return;
  context.fillStyle = style === 'light' ? '#eeeeee' : '#24272d';
  context.fillRect(0, 0, width, height);
  if (style === 'checker')
    for (let y = 0; y < height; y += 16)
      for (let x = 0; x < width; x += 16) {
        context.fillStyle = ((x + y) / 16) % 2 ? '#bcbcbc' : '#dedede';
        context.fillRect(x, y, 16, 16);
      }
};
const canvas2d = (width: number, height: number) => {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('2D canvas is unavailable');
  return { canvas, context };
};
const captureNonModelAsset = async (
  v: ViewOptions,
  replay: boolean,
): Promise<{ mime: string; data: string }> => {
  if (replay) throw new Error('Replay requires a model');
  if (loaded.png) {
    const img = new Image();
    img.src = 'data:image/png;base64,' + loaded.png;
    await img.decode();
    const width = img.width * v.scale,
      height = img.height * v.scale;
    if (width > 4096 || height > 4096) throw new Error('Scaled image exceeds 4096 pixels');
    const { canvas, context } = canvas2d(width, height);
    background(
      context,
      width,
      height,
      v.background === 'environment' ? 'transparent' : v.background,
    );
    context.imageSmoothingEnabled = false;
    context.drawImage(img, 0, 0, width, height);
    return { mime: 'image/png', data: canvas.toDataURL('image/png').split(',')[1] };
  }
  if (loaded.wave) {
    const { canvas, context } = canvas2d(v.width, v.height);
    background(context, v.width, v.height, v.background);
    context.strokeStyle = '#dca35f';
    context.beginPath();
    loaded.wave.forEach((amplitude, x) => {
      const px = (x / (loaded.wave!.length - 1)) * v.width;
      context.moveTo(px, ((1 - amplitude) * v.height) / 2);
      context.lineTo(px, ((1 + amplitude) * v.height) / 2);
    });
    context.stroke();
    return { mime: 'image/png', data: canvas.toDataURL('image/png').split(',')[1] };
  }
  throw new Error('No renderable asset loaded');
};

const captureBuildReplay = async (
  model: ProjectDocument,
  v: ViewOptions,
): Promise<{ mime: string; data: string }> => {
  if (
    v.azimuth !== undefined ||
    v.elevation !== undefined ||
    v.width !== 640 ||
    v.height !== 360 ||
    v.fps !== 10 ||
    v.background !== 'environment' ||
    v.zoom !== 1 ||
    v.node ||
    v.wireframe ||
    v.skeleton ||
    !v.textures ||
    v.clip ||
    v.duration !== undefined ||
    v.time !== 0
  )
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
  return { mime: 'image/gif', data: base64(result.bytes) };
};

const applyNodeVisibilityFilter = (
  model: ProjectDocument,
  projection: ReturnType<typeof projectToThreeScene>,
  nodeId: string,
): void => {
  if (!model.scene.nodes[nodeId]) throw new Error('Unknown node: ' + nodeId);
  const selected = new Set([nodeId]);
  for (let pass = 0; pass < Object.keys(model.scene.nodes).length; pass++)
    for (const n of Object.values(model.scene.nodes))
      if (n.parentId && selected.has(n.parentId)) selected.add(n.id);
  for (const n of Object.values(model.scene.nodes))
    if (n.kind !== 'bone' && !selected.has(n.id))
      projection.objectsByNodeId.get(n.id)!.visible = false;
};

const computeTargetFraming = (
  model: ProjectDocument,
  projection: ReturnType<typeof projectToThreeScene>,
  surface: ReturnType<typeof createCaptureSurface>,
  v: ViewOptions,
  replay: boolean,
  clip: ProjectDocument['animations'][string] | undefined,
): { target: THREE.Vector3; distance: number } => {
  // Stable framing covers sampled poses, so motion does not pump the camera.
  const bounds = new THREE.Box3();
  for (let i = 0; i < (replay && clip ? 33 : 1); i++) {
    applyAnimationPose(
      model,
      projection,
      clip?.id ?? null,
      replay && clip ? (clip.durationSeconds * i) / 32 : v.time,
    );
    projection.root.updateMatrixWorld(true);
    bounds.union(
      new THREE.Box3().setFromObject(
        v.node ? projection.objectsByNodeId.get(v.node)! : projection.root,
      ),
    );
  }
  const target = bounds.getCenter(new THREE.Vector3());
  const box = new THREE.Mesh(
    new THREE.BoxGeometry(...bounds.getSize(new THREE.Vector3()).toArray()),
  );
  box.position.copy(target);
  if (v.camera === 'back' || v.camera === 'bottom')
    applySignedProjectViewPreset(
      surface.camera,
      v.camera === 'back' ? 'rear' : 'down',
      box,
      model.settings.forward,
    );
  else applyCameraPreset(surface.camera, v.camera, box, model.settings.forward);
  const distance = surface.camera.position.distanceTo(target) / v.zoom;
  box.geometry.dispose();
  (box.material as THREE.Material).dispose();
  surface.scene.fog = null;
  if (v.background !== 'environment') {
    surface.scene.background = null;
    surface.renderer.setClearColor(0x000000, 0);
  }
  return { target, distance };
};

const renderModelFrames = (
  model: ProjectDocument,
  projection: ReturnType<typeof projectToThreeScene>,
  surface: ReturnType<typeof createCaptureSurface>,
  output: ReturnType<typeof canvas2d>,
  v: ViewOptions,
  replay: boolean,
  clip: ProjectDocument['animations'][string] | undefined,
  frames: number,
  target: THREE.Vector3,
  distance: number,
): { mime: string; data: string } => {
  const encoder = GIFEncoder();
  for (let i = 0; i < frames; i++) {
    applyAnimationPose(
      model,
      projection,
      clip?.id ?? null,
      replay && clip ? (v.time + i / v.fps) % clip.durationSeconds : v.time,
    );
    if (
      v.azimuth !== undefined ||
      v.elevation !== undefined ||
      (replay && v.mode === 'turntable')
    ) {
      const a = THREE.MathUtils.degToRad(
        (v.azimuth ?? 45) + (replay && v.mode === 'turntable' ? (360 * i) / frames : 0),
      );
      const e = THREE.MathUtils.degToRad(v.elevation ?? 20);
      surface.camera.up.set(0, 1, 0);
      surface.camera.position
        .copy(target)
        .add(
          new THREE.Vector3(
            Math.sin(a) * Math.cos(e),
            Math.sin(e),
            -Math.cos(a) * Math.cos(e),
          ).multiplyScalar(distance),
        );
    } else surface.camera.position.sub(target).normalize().multiplyScalar(distance).add(target);
    surface.camera.lookAt(target);
    surface.renderer.render(surface.scene, surface.camera);
    background(
      output.context,
      v.width,
      v.height,
      v.background === 'environment' ? 'transparent' : v.background,
    );
    output.context.drawImage(surface.renderCanvas, 0, 0);
    if (!replay)
      return { mime: 'image/png', data: output.canvas.toDataURL('image/png').split(',')[1] };
    const rgba = output.context.getImageData(0, 0, v.width, v.height).data;
    const palette = quantize(rgba, 128, { format: 'rgba4444' });
    const transparentIndex = palette.findIndex((color) => color.length === 4 && color[3] === 0);
    encoder.writeFrame(applyPalette(rgba, palette, 'rgba4444'), v.width, v.height, {
      palette,
      delay: 1000 / v.fps,
      repeat: i === 0 ? 0 : undefined,
      transparent: transparentIndex >= 0,
      transparentIndex: transparentIndex >= 0 ? transparentIndex : undefined,
      dispose: 2,
    });
    if (encoder.bytesView().length > 32 * 1024 * 1024) throw new Error('GIF exceeds 32 MiB');
  }
  encoder.finish();
  return { mime: 'image/gif', data: base64(encoder.bytes()) };
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

const captureSheet = async (
  model: ProjectDocument,
  v: ViewOptions,
  clip: ProjectDocument['animations'][string] | undefined,
): Promise<{ mime: string; data: string }> => {
  const tileW = Math.max(16, Math.floor(v.width / 2));
  const tileH = Math.max(16, Math.floor(v.height / 2));
  const sheetCanvas = canvas2d(v.width, v.height);
  background(
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
  const tileCanvas = canvas2d(tileW, tileH);
  const specs = SHEET_TILES[v.sheet!];
  try {
    for (let idx = 0; idx < specs.length; idx++) {
      const spec = specs[idx]!;
      const tv: ViewOptions = {
        ...v,
        width: tileW,
        height: tileH,
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
        const { target, distance } = computeTargetFraming(
          model,
          projection,
          surface,
          tv,
          false,
          clip,
        );
        renderModelFrames(
          model,
          projection,
          surface,
          tileCanvas,
          tv,
          false,
          clip,
          1,
          target,
          distance,
        );
        const dx = (idx % 2) * tileW;
        const dy = Math.floor(idx / 2) * tileH;
        sheetCanvas.context.drawImage(tileCanvas.canvas, dx, dy);
        drawTileBadge(sheetCanvas.context, dx, dy, spec.label);
      } finally {
        surface.scene.remove(projection.root);
        projection.dispose();
      }
    }
    sheetCanvas.context.fillStyle = '#16191f';
    sheetCanvas.context.fillRect(tileW - 1, 0, 2, v.height);
    sheetCanvas.context.fillRect(0, tileH - 1, v.width, 2);
    return { mime: 'image/png', data: sheetCanvas.canvas.toDataURL('image/png').split(',')[1] };
  } finally {
    disposeCaptureSurface(surface);
  }
};

export const capture = async (
  v: ViewOptions,
  replay: boolean,
): Promise<{ mime: string; data: string }> => {
  if (!loaded.document) return captureNonModelAsset(v, replay);
  const model = loaded.document;
  if (replay && v.mode === 'build') return captureBuildReplay(model, v);
  const clip = v.clip
    ? Object.values(model.animations).find((c) => c.id === v.clip || c.name === v.clip)
    : undefined;
  if (v.clip && !clip) throw new Error('Unknown clip: ' + v.clip);
  if (replay && v.mode === 'motion' && !clip) throw new Error('Motion replay requires --clip');
  if (v.time > 0 && !clip) throw new Error('A nonzero time requires --clip');
  if (clip && v.time > clip.durationSeconds) throw new Error('Time exceeds clip duration');
  if (!replay && v.sheet !== undefined) return captureSheet(model, v, clip);
  const duration = v.duration ?? clip?.durationSeconds ?? 3;
  const frames = replay ? Math.ceil(duration * v.fps) : 1;
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
  const output = canvas2d(v.width, v.height);
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
