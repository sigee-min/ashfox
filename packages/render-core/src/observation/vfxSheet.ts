/// <reference path="../gifenc.d.ts" />
import * as THREE from 'three';
import { GIFEncoder, quantize, applyPalette } from 'gifenc';
import type { CompiledVfx, ProjectDocument } from '@ashfox/engine-core';
import { applyAnimationPose } from '../animationPose';
import {
  createCaptureSurface,
  disposeCaptureSurface,
  waitForProjectionTextures,
} from '../captureSurface';
import { projectToThreeScene } from '../projection';
import { createVfxThreeGroup, evaluateVfxThreeGroup, type VfxSceneState } from '../vfxRender';
import type { ViewOptions } from './contract';
import {
  applyNodeVisibilityFilter,
  base64Bytes,
  computeTargetFraming,
  createCanvas2d,
  fillBackground,
  renderModelFrames,
} from './modelRender';

const sampleVfxBounds = (
  vfx: CompiledVfx,
  state: VfxSceneState,
  time: number,
  replay: boolean,
): THREE.Box3 => {
  const bounds = new THREE.Box3();
  const sample = new THREE.Box3();
  const count = replay ? 16 : 1;
  for (let i = 0; i < count; i += 1) {
    const t = replay ? (vfx.durationSeconds * i) / Math.max(1, count - 1) : time;
    evaluateVfxThreeGroup(state, t);
    state.root.updateMatrixWorld(true);
    sample.setFromObject(state.root);
    if (!sample.isEmpty()) bounds.union(sample);
  }
  if (bounds.isEmpty())
    bounds.set(new THREE.Vector3(-0.5, 0, -0.5), new THREE.Vector3(0.5, 1, 0.5));
  return bounds;
};

const setupVfxCamera = (
  surface: ReturnType<typeof createCaptureSurface>,
  bounds: THREE.Box3,
  v: ViewOptions,
): void => {
  const target = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());
  const fovV = THREE.MathUtils.degToRad(surface.camera.fov);
  const fovH = 2 * Math.atan(Math.tan(fovV / 2) * surface.camera.aspect);
  const radius = Math.max(0.2, Math.hypot(size.x, size.y, size.z) * 0.5);
  const halfTan = Math.min(Math.tan(fovV / 2), Math.tan(fovH / 2));
  const dist = Math.max(0.45, ((radius / halfTan) * 0.88) / Math.max(0.1, v.zoom));
  surface.camera.near = Math.min(surface.camera.near, 0.05);
  surface.camera.far = Math.max(surface.camera.far, dist * 10);
  surface.camera.updateProjectionMatrix();
  const defaultAz =
    v.camera === 'left' ? -90 : v.camera === 'right' ? 90 : v.camera === 'front' ? 0 : 35;
  const defaultEl =
    v.camera === 'top'
      ? 85
      : v.camera === 'front' || v.camera === 'left' || v.camera === 'right'
        ? 8
        : 22;
  const a = THREE.MathUtils.degToRad(v.azimuth ?? defaultAz);
  const e = THREE.MathUtils.degToRad(v.elevation ?? defaultEl);
  surface.camera.up.set(0, 1, 0);
  surface.camera.position
    .copy(target)
    .add(
      new THREE.Vector3(
        Math.sin(a) * Math.cos(e),
        Math.sin(e),
        -Math.cos(a) * Math.cos(e),
      ).multiplyScalar(dist),
    );
  surface.camera.lookAt(target);
  surface.scene.fog = null;
  if (v.background !== 'environment') {
    surface.scene.background = null;
    surface.renderer.setClearColor(0x000000, 0);
  }
};

export const captureVfxFlipbook = (
  vfx: CompiledVfx,
  v: ViewOptions,
): { mime: string; data: string } => {
  const cols = Math.max(1, vfx.flipbookManifest.columns);
  const rows = Math.max(1, vfx.flipbookManifest.rows);
  const tileW = Math.max(16, Math.floor(v.width / cols));
  const tileH = Math.max(16, Math.floor(v.height / rows));
  const sheet = createCanvas2d(tileW * cols, tileH * rows);
  fillBackground(
    sheet.context,
    sheet.canvas.width,
    sheet.canvas.height,
    v.background === 'environment' ? 'transparent' : v.background,
  );
  const surface = createCaptureSurface({
    width: tileW,
    height: tileH,
    cameraMode: 'perspective',
    environment: v.environment === 'studio' ? 'night' : v.environment,
    forward: 'north',
  });
  const state = createVfxThreeGroup(vfx);
  try {
    surface.scene.add(state.root);
    const bounds = sampleVfxBounds(vfx, state, v.time, true);
    setupVfxCamera(surface, bounds, v);
    const total = vfx.flipbookManifest.frameCount;
    for (let i = 0; i < total; i += 1) {
      const t = (vfx.durationSeconds * i) / Math.max(1, total - 1);
      evaluateVfxThreeGroup(state, t);
      surface.renderer.render(surface.scene, surface.camera);
      const col = i % cols;
      const row = Math.floor(i / cols);
      sheet.context.drawImage(surface.renderCanvas, col * tileW, row * tileH);
    }
    return { mime: 'image/png', data: sheet.canvas.toDataURL('image/png').split(',')[1]! };
  } finally {
    surface.scene.remove(state.root);
    state.dispose();
    disposeCaptureSurface(surface);
  }
};

const encodeVfxGifFrames = (
  vfx: CompiledVfx,
  state: VfxSceneState,
  surface: ReturnType<typeof createCaptureSurface>,
  output: ReturnType<typeof createCanvas2d>,
  v: ViewOptions,
  bg: ViewOptions['background'],
): { mime: string; data: string } => {
  const frames = Math.max(4, Math.min(60, Math.ceil((v.duration ?? vfx.durationSeconds) * v.fps)));
  const encoder = GIFEncoder();
  for (let i = 0; i < frames; i += 1) {
    evaluateVfxThreeGroup(state, (i / Math.max(1, frames - 1)) * vfx.durationSeconds);
    surface.renderer.render(surface.scene, surface.camera);
    fillBackground(output.context, v.width, v.height, bg);
    output.context.drawImage(surface.renderCanvas, 0, 0);
    const rgba = output.context.getImageData(0, 0, v.width, v.height).data;
    const palette = quantize(rgba, 128, { format: 'rgba4444' });
    const idx = palette.findIndex((c) => c.length === 4 && c[3] === 0);
    encoder.writeFrame(applyPalette(rgba, palette, 'rgba4444'), v.width, v.height, {
      palette,
      delay: 1000 / v.fps,
      repeat: i === 0 ? 0 : undefined,
      transparent: idx >= 0,
      transparentIndex: idx >= 0 ? idx : undefined,
      dispose: 2,
    });
  }
  encoder.finish();
  return { mime: 'image/gif', data: base64Bytes(encoder.bytes()) };
};

export const captureVfxMedia = (
  vfx: CompiledVfx,
  v: ViewOptions,
  replay: boolean,
): { mime: string; data: string } => {
  if (!replay && v.sheet === 'flipbook') return captureVfxFlipbook(vfx, v);
  const surface = createCaptureSurface({
    width: v.width,
    height: v.height,
    cameraMode: 'perspective',
    environment: v.environment === 'studio' ? 'night' : v.environment,
    forward: 'north',
  });
  const state = createVfxThreeGroup(vfx);
  const output = createCanvas2d(v.width, v.height);
  try {
    surface.scene.add(state.root);
    const bounds = sampleVfxBounds(vfx, state, v.time, replay);
    setupVfxCamera(surface, bounds, v);
    const bg = v.background === 'environment' ? 'dark' : v.background;
    if (!replay) {
      evaluateVfxThreeGroup(state, v.time);
      surface.renderer.render(surface.scene, surface.camera);
      fillBackground(output.context, v.width, v.height, bg);
      output.context.drawImage(surface.renderCanvas, 0, 0);
      return { mime: 'image/png', data: output.canvas.toDataURL('image/png').split(',')[1]! };
    }
    return encodeVfxGifFrames(vfx, state, surface, output, v, bg);
  } finally {
    surface.scene.remove(state.root);
    state.dispose();
    disposeCaptureSurface(surface);
  }
};

const renderFlipbookTiles = (
  model: ProjectDocument,
  projection: ReturnType<typeof projectToThreeScene>,
  surface: ReturnType<typeof createCaptureSurface>,
  sheet: ReturnType<typeof createCanvas2d>,
  v: ViewOptions,
  clip: ProjectDocument['animations'][string] | undefined,
  tileW: number,
  tileH: number,
): void => {
  const tile = createCanvas2d(tileW, tileH);
  const { target, distance } = computeTargetFraming(model, projection, surface, v, true, clip);
  const dur = clip?.durationSeconds ?? v.duration ?? 1;
  const tileView: ViewOptions = { ...v, width: tileW, height: tileH, sheet: undefined };
  for (let i = 0; i < 16; i += 1) {
    const t = (dur * i) / 16;
    applyAnimationPose(model, projection, clip?.id ?? null, t);
    renderModelFrames(
      model,
      projection,
      surface,
      tile,
      { ...tileView, time: t },
      false,
      clip,
      1,
      target,
      distance,
    );
    sheet.context.drawImage(tile.canvas, (i % 4) * tileW, Math.floor(i / 4) * tileH);
  }
};

export const captureModelFlipbook = async (
  model: ProjectDocument,
  v: ViewOptions,
  clip: ProjectDocument['animations'][string] | undefined,
): Promise<{ mime: string; data: string }> => {
  const tileW = Math.max(16, Math.floor(v.width / 4));
  const tileH = Math.max(16, Math.floor(v.height / 4));
  const sheet = createCanvas2d(tileW * 4, tileH * 4);
  const bg = v.background === 'environment' ? 'transparent' : v.background;
  fillBackground(sheet.context, sheet.canvas.width, sheet.canvas.height, bg);
  const projection = projectToThreeScene(model, {
    assets: {},
    showSkeleton: v.skeleton,
    showTextures: v.textures,
    showWireframe: v.wireframe,
  });
  const surface = createCaptureSurface({
    width: tileW,
    height: tileH,
    cameraMode: 'perspective',
    environment: v.environment,
    forward: model.settings.forward,
  });
  try {
    surface.scene.add(projection.root);
    await waitForProjectionTextures(projection, new AbortController().signal);
    if (v.node) applyNodeVisibilityFilter(model, projection, v.node);
    renderFlipbookTiles(model, projection, surface, sheet, v, clip, tileW, tileH);
    return { mime: 'image/png', data: sheet.canvas.toDataURL('image/png').split(',')[1]! };
  } finally {
    surface.scene.remove(projection.root);
    projection.dispose();
    disposeCaptureSurface(surface);
  }
};
