/// <reference path="../gifenc.d.ts" />
import * as THREE from 'three';
import { GIFEncoder, quantize, applyPalette } from 'gifenc';
import type { ProjectDocument } from '@ashfox/engine-core';
import { projectToThreeScene } from '../projection';
import { applyAnimationPose } from '../animationPose';
import { type createCaptureSurface } from '../captureSurface';
import { applyCameraPreset, applySignedProjectViewPreset } from '../cameraPresets';
import { createGroundContactShadow, fitDirectionalShadowBounds } from '../viewportEnvironment';
import type { ViewOptions } from './contract';

export const base64Bytes = (bytes: Uint8Array): string => {
  let text = '';
  for (let i = 0; i < bytes.length; i += 8192)
    text += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(text);
};

export const fillBackground = (
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  style: string,
): void => {
  context.clearRect(0, 0, width, height);
  if (style === 'transparent') return;
  context.fillStyle = style === 'light' ? '#eeeeee' : '#24272d';
  context.fillRect(0, 0, width, height);
  if (style !== 'checker') return;
  for (let y = 0; y < height; y += 16)
    for (let x = 0; x < width; x += 16) {
      context.fillStyle = ((x + y) / 16) % 2 ? '#bcbcbc' : '#dedede';
      context.fillRect(x, y, 16, 16);
    }
};

export const createCanvas2d = (width: number, height: number) => {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('2D canvas is unavailable');
  return { canvas, context };
};

const buildChildrenByParent = (nodes: ProjectDocument['scene']['nodes']): Map<string, string[]> => {
  const childrenByParent = new Map<string, string[]>();
  for (const node of Object.values(nodes)) {
    if (!node.parentId) continue;
    const children = childrenByParent.get(node.parentId);
    if (children) children.push(node.id);
    else childrenByParent.set(node.parentId, [node.id]);
  }
  return childrenByParent;
};

export const applyNodeVisibilityFilter = (
  model: ProjectDocument,
  projection: ReturnType<typeof projectToThreeScene>,
  nodeId: string,
): void => {
  const { nodes } = model.scene;
  if (!nodes[nodeId]) throw new Error('Unknown node: ' + nodeId);
  const childrenByParent = buildChildrenByParent(nodes);
  const selected = new Set([nodeId]);
  const queue = [nodeId];
  for (let head = 0; head < queue.length; head++) {
    const currentId = queue[head];
    if (currentId === undefined) continue;
    const children = childrenByParent.get(currentId);
    if (!children) continue;
    for (const childId of children) {
      if (selected.has(childId)) continue;
      selected.add(childId);
      queue.push(childId);
    }
  }
  for (const n of Object.values(nodes))
    if (n.kind !== 'bone' && !selected.has(n.id))
      projection.objectsByNodeId.get(n.id)!.visible = false;
};

const sampleAnimatedBounds = (
  model: ProjectDocument,
  projection: ReturnType<typeof projectToThreeScene>,
  v: ViewOptions,
  replay: boolean,
  clip: ProjectDocument['animations'][string] | undefined,
): THREE.Box3 => {
  const bounds = new THREE.Box3();
  const sampleBounds = new THREE.Box3();
  const sampleCount = replay && clip ? 33 : 1;
  for (let i = 0; i < sampleCount; i++) {
    const time = replay && clip ? (clip.durationSeconds * i) / 32 : v.time;
    applyAnimationPose(model, projection, clip?.id ?? null, time);
    projection.root.updateMatrixWorld(true);
    const rootObject = v.node ? projection.objectsByNodeId.get(v.node)! : projection.root;
    bounds.union(sampleBounds.setFromObject(rootObject));
  }
  return bounds;
};

export const computeTargetFraming = (
  model: ProjectDocument,
  projection: ReturnType<typeof projectToThreeScene>,
  surface: ReturnType<typeof createCaptureSurface>,
  v: ViewOptions,
  replay: boolean,
  clip: ProjectDocument['animations'][string] | undefined,
): { target: THREE.Vector3; distance: number } => {
  // Stable framing covers sampled poses, so motion does not pump the camera.
  const bounds = sampleAnimatedBounds(model, projection, v, replay, clip);
  const target = bounds.getCenter(new THREE.Vector3());
  if (v.camera === 'back' || v.camera === 'bottom')
    applySignedProjectViewPreset(
      surface.camera,
      v.camera === 'back' ? 'rear' : 'down',
      bounds,
      model.settings.forward,
    );
  else applyCameraPreset(surface.camera, v.camera, bounds, model.settings.forward);
  const distance = surface.camera.position.distanceTo(target) / v.zoom;
  fitDirectionalShadowBounds(surface.scene, bounds);
  surface.scene.fog = null;
  if (v.background !== 'environment') {
    surface.scene.background = null;
    surface.renderer.setClearColor(0x000000, 0);
  }
  return { target, distance };
};

const positionFrameCamera = (
  camera: THREE.PerspectiveCamera,
  v: ViewOptions,
  replay: boolean,
  frameIndex: number,
  frames: number,
  target: THREE.Vector3,
  distance: number,
): void => {
  const useOrbit =
    v.azimuth !== undefined || v.elevation !== undefined || (replay && v.mode === 'turntable');
  if (!useOrbit) {
    camera.position.sub(target).normalize().multiplyScalar(distance).add(target);
    camera.lookAt(target);
    return;
  }
  const turntableOffset = replay && v.mode === 'turntable' ? (360 * frameIndex) / frames : 0;
  const a = THREE.MathUtils.degToRad((v.azimuth ?? 45) + turntableOffset);
  const e = THREE.MathUtils.degToRad(v.elevation ?? 20);
  camera.up.set(0, 1, 0);
  camera.position
    .copy(target)
    .add(
      new THREE.Vector3(
        Math.sin(a) * Math.cos(e),
        Math.sin(e),
        -Math.cos(a) * Math.cos(e),
      ).multiplyScalar(distance),
    );
  camera.lookAt(target);
};

const writeGifFrame = (
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

const shouldAttachGroundShadow = (v: ViewOptions): boolean =>
  !v.wireframe &&
  !v.node &&
  v.camera !== 'bottom' &&
  (v.elevation === undefined || v.elevation >= 0);

export const renderModelFrames = (
  model: ProjectDocument,
  projection: ReturnType<typeof projectToThreeScene>,
  surface: ReturnType<typeof createCaptureSurface>,
  output: ReturnType<typeof createCanvas2d>,
  v: ViewOptions,
  replay: boolean,
  clip: ProjectDocument['animations'][string] | undefined,
  frames: number,
  target: THREE.Vector3,
  distance: number,
): { mime: string; data: string } => {
  const encoder = GIFEncoder();
  const bg = v.background === 'environment' ? 'transparent' : v.background;
  let groundShadow: ReturnType<typeof createGroundContactShadow> | null = null;
  if (shouldAttachGroundShadow(v)) {
    applyAnimationPose(model, projection, clip?.id ?? null, v.time);
    projection.root.updateMatrixWorld(true);
    groundShadow = createGroundContactShadow(new THREE.Box3().setFromObject(projection.root), {
      studioStage: v.background === 'environment',
    });
    surface.scene.add(groundShadow.object);
  }
  try {
    for (let i = 0; i < frames; i++) {
      const time = replay && clip ? (v.time + i / v.fps) % clip.durationSeconds : v.time;
      applyAnimationPose(model, projection, clip?.id ?? null, time);
      positionFrameCamera(surface.camera, v, replay, i, frames, target, distance);
      surface.renderer.render(surface.scene, surface.camera);
      fillBackground(output.context, v.width, v.height, bg);
      output.context.drawImage(surface.renderCanvas, 0, 0);
      if (!replay) {
        return { mime: 'image/png', data: output.canvas.toDataURL('image/png').split(',')[1] };
      }
      writeGifFrame(encoder, output, v, i);
    }
    encoder.finish();
    return { mime: 'image/gif', data: base64Bytes(encoder.bytes()) };
  } finally {
    if (groundShadow) {
      surface.scene.remove(groundShadow.object);
      groundShadow.dispose();
    }
  }
};
