import * as THREE from 'three';

import { collectStructureCutBands } from '@ashfox/engine-core';
import { compareText } from '@ashfox/internal-contracts';
import { applyEyeLevelCamera, frameBoxAtAngles } from '../cameraPresets';
import {
  createCaptureSurface,
  disposeCaptureSurface,
  type CaptureSurface,
} from '../captureSurface';
import {
  buildStructureScene,
  frameStructureShadows,
  type StructureObservationPayload,
  type StructureObservationSlice,
} from '../structureRender';
import { createViewportEnvironment } from '../viewportEnvironment';
import type { ViewOptions } from './contract';
import { createCanvas2d, fillBackground } from './modelRender';

interface InteriorCameraSpec {
  readonly label: string;
  readonly eye: readonly [number, number, number];
  readonly lookAt: readonly [number, number, number];
}

interface ExteriorTileSpec {
  readonly label: string;
  readonly azimuth: number;
  readonly elevation: number;
  readonly twilight: boolean;
}

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
  width: number,
  height: number,
  cols: number,
  rows: number,
  tileW: number,
  tileH: number,
): void => {
  ctx.fillStyle = '#16191f';
  for (let c = 1; c < cols; c += 1) ctx.fillRect(c * tileW - 1, 0, 2, height);
  for (let r = 1; r < rows; r += 1) ctx.fillRect(0, r * tileH - 1, width, 2);
};

const detectFrontAzimuth = (payload: StructureObservationPayload): number => {
  const entrySocket = payload.playableMeta.sockets.find((s) => s.kind === 'entry');
  const door = payload.playableMeta.interactables.find((i) => i.kind === 'door');
  const facing = entrySocket?.normal ?? door?.facing;
  if (facing === 'east') return 90;
  if (facing === 'west') return -90;
  if (facing === 'north') return 0;
  return 180;
};

const exteriorTileSpecs = (payload: StructureObservationPayload): readonly ExteriorTileSpec[] => {
  const frontAz = detectFrontAzimuth(payload);
  return [
    { label: 'HERO SW', azimuth: -135, elevation: 26, twilight: false },
    { label: 'HERO NE', azimuth: 45, elevation: 26, twilight: false },
    { label: 'FRONT', azimuth: frontAz, elevation: 6, twilight: false },
    { label: 'LEFT', azimuth: frontAz - 90, elevation: 6, twilight: false },
    { label: 'RIGHT', azimuth: frontAz + 90, elevation: 6, twilight: false },
    { label: 'TWILIGHT', azimuth: frontAz - 40, elevation: 24, twilight: true },
  ];
};

const deriveCutSlices = (
  payload: StructureObservationPayload,
): readonly StructureObservationSlice[] =>
  payload.cutSlices && payload.cutSlices.length > 0
    ? payload.cutSlices
    : collectStructureCutBands(payload.floors, payload.size[1]);

interface WorldBox {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
  readonly minZ: number;
  readonly maxZ: number;
}

const roomWorldBounds = (
  payload: StructureObservationPayload,
  room: StructureObservationPayload['rooms'][number],
): WorldBox => {
  const [w, _h, d] = payload.size;
  return {
    minX: room.from[0] + 1 - w / 2,
    maxX: room.to[0] - w / 2,
    minY: room.from[1] + 1,
    maxY: room.to[1],
    minZ: room.from[2] + 1 - d / 2,
    maxZ: room.to[2] - d / 2,
  };
};

const insideBox = (p: readonly [number, number, number], b: WorldBox): boolean =>
  p[0] >= b.minX - 0.5 &&
  p[0] <= b.maxX + 0.5 &&
  p[1] >= b.minY - 0.5 &&
  p[1] <= b.maxY + 0.5 &&
  p[2] >= b.minZ - 0.5 &&
  p[2] <= b.maxZ + 0.5;

const pickZoneFocalTarget = (
  payload: StructureObservationPayload,
  b: WorldBox,
): readonly [number, number, number] => {
  const item = payload.playableMeta.interactables.find(
    (i) => i.kind !== 'door' && insideBox(i.position, b),
  );
  if (item) return [item.position[0], Math.min(b.maxY - 0.4, b.minY + 1.2), item.position[2]];
  const light = payload.playableMeta.lights.find((l) => insideBox(l.position, b));
  if (light) return [light.position[0], Math.min(b.maxY - 0.4, b.minY + 1.35), light.position[2]];
  return [(b.minX + b.maxX) / 2, Math.min(b.maxY - 0.4, b.minY + 1.35), (b.minZ + b.maxZ) / 2];
};

const roomToInteriorCam = (
  payload: StructureObservationPayload,
  room: StructureObservationPayload['rooms'][number],
): InteriorCameraSpec => {
  const b = roomWorldBounds(payload, room);
  const cx = (b.minX + b.maxX) / 2;
  const cz = (b.minZ + b.maxZ) / 2;
  const focal = pickZoneFocalTarget(payload, b);
  const dx = cx - focal[0];
  const dz = cz - focal[2];
  const pull = Math.hypot(dx, dz) > 0.25 ? 0.58 : 0;
  return {
    label: room.name.toUpperCase(),
    eye: [
      THREE.MathUtils.clamp(cx + dx * pull, b.minX + 0.85, b.maxX - 0.85),
      Math.min(b.maxY - 0.35, b.minY + 1.6),
      THREE.MathUtils.clamp(cz + dz * pull, b.minZ + 0.85, b.maxZ - 0.85),
    ],
    lookAt: focal,
  };
};

const computeInteriorCameras = (
  payload: StructureObservationPayload,
): readonly InteriorCameraSpec[] => {
  const enclosed = payload.rooms
    .filter((r) => r.enclosed && r.kind !== 'courtyard')
    .sort(
      (a, b) =>
        (b.to[0] - b.from[0]) * (b.to[2] - b.from[2]) -
          (a.to[0] - a.from[0]) * (a.to[2] - a.from[2]) || compareText(a.name, b.name),
    )
    .slice(0, 4);
  if (enclosed.length > 0) return enclosed.map((room) => roomToInteriorCam(payload, room));
  const [w, h, d] = payload.size;
  const levels =
    payload.floors.length > 0
      ? payload.floors.map((f) => f.y + 1)
      : payload.playableMeta.navigation.floorLevels.length > 0
        ? payload.playableMeta.navigation.floorLevels.map((y) => Math.max(1, y))
        : h >= 14
          ? [1, 6]
          : [1];
  return levels.slice(0, 4).map((floorY, idx) => ({
    label: `ROOM ${idx + 1}`,
    eye: [-w * 0.16, Math.min(h - 1.2, floorY + 1.6), d * 0.16] as const,
    lookAt: [w * 0.15, Math.min(h - 1.3, floorY + 1.35), -d * 0.18] as const,
  }));
};

const applySurfaceBackdrop = (
  surface: CaptureSurface,
  backgroundStyle: ViewOptions['background'],
  envId: ViewOptions['environment'] | 'blueprint',
): void => {
  surface.scene.fog = null;
  if (backgroundStyle !== 'environment') {
    surface.scene.background = null;
    surface.renderer.setClearColor(0x000000, 0);
    return;
  }
  if (envId === 'blueprint') {
    surface.scene.background = new THREE.Color('#131924');
    return;
  }
  const env = createViewportEnvironment(envId);
  surface.scene.background = env.background;
  env.dispose();
};

const renderTileToCanvas = async (
  surface: CaptureSurface,
  tileCanvas: ReturnType<typeof createCanvas2d>,
  payload: StructureObservationPayload,
  v: ViewOptions,
  options: {
    readonly bakedMesh?: StructureObservationPayload['bakedMesh'];
    readonly document?: StructureObservationPayload['document'];
    readonly clipY?: number;
    readonly twilight?: boolean;
    readonly interiorFill?: boolean;
    readonly envId: ViewOptions['environment'] | 'blueprint';
    readonly positionCamera: (bounds: THREE.Box3) => void;
  },
  signal: AbortSignal,
): Promise<void> => {
  surface.renderer.localClippingEnabled =
    options.clipY !== undefined && options.bakedMesh === undefined;
  const handle = await buildStructureScene(
    payload,
    {
      bakedMesh: options.bakedMesh,
      document: options.document,
      clipY: options.clipY,
      twilight: options.twilight,
      interiorFill: options.interiorFill,
    },
    signal,
  );
  surface.scene.add(handle.root);
  try {
    applySurfaceBackdrop(surface, v.background, options.envId);
    frameStructureShadows(surface.scene, handle.bounds, options.twilight ?? false);
    options.positionCamera(handle.bounds);
    surface.renderer.render(surface.scene, surface.camera);
    const bg = v.background === 'environment' ? 'transparent' : v.background;
    fillBackground(tileCanvas.context, tileCanvas.canvas.width, tileCanvas.canvas.height, bg);
    tileCanvas.context.drawImage(surface.renderCanvas, 0, 0);
  } finally {
    surface.scene.remove(handle.root);
    handle.dispose();
  }
};

const renderGridSheet = async (
  cols: number,
  rows: number,
  v: ViewOptions,
  renderItem: (
    idx: number,
    surface: CaptureSurface,
    tileCanvas: ReturnType<typeof createCanvas2d>,
  ) => Promise<string>,
): Promise<{ mime: string; data: string }> => {
  const tileW = Math.max(16, Math.floor(v.width / cols));
  const tileH = Math.max(16, Math.floor(v.height / rows));
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
    forward: 'north',
  });
  const tileCanvas = createCanvas2d(tileW, tileH);
  try {
    const total = cols * rows;
    for (let idx = 0; idx < total; idx += 1) {
      const label = await renderItem(idx, surface, tileCanvas);
      if (!label) continue;
      const dx = (idx % cols) * tileW;
      const dy = Math.floor(idx / cols) * tileH;
      sheetCanvas.context.drawImage(tileCanvas.canvas, dx, dy);
      drawSheetBadge(sheetCanvas.context, dx, dy, label);
    }
    drawGridDividers(sheetCanvas.context, v.width, v.height, cols, rows, tileW, tileH);
    return { mime: 'image/png', data: sheetCanvas.canvas.toDataURL('image/png').split(',')[1] };
  } finally {
    disposeCaptureSurface(surface);
  }
};

const renderExteriorSheet = (
  payload: StructureObservationPayload,
  v: ViewOptions,
  signal: AbortSignal,
) => {
  const specs = exteriorTileSpecs(payload);
  return renderGridSheet(2, 3, v, async (idx, surface, tileCanvas) => {
    const spec = specs[idx]!;
    await renderTileToCanvas(
      surface,
      tileCanvas,
      payload,
      v,
      {
        twilight: spec.twilight,
        envId: spec.twilight ? 'evening' : v.environment === 'studio' ? 'day' : v.environment,
        positionCamera: (bounds) =>
          frameBoxAtAngles(
            surface.camera,
            bounds,
            spec.azimuth,
            spec.elevation,
            v.zoom * (spec.elevation >= 20 ? 1.32 : 1.08),
            42,
          ),
      },
      signal,
    );
    return spec.label;
  });
};

const renderCutawaySheet = (
  payload: StructureObservationPayload,
  v: ViewOptions,
  signal: AbortSignal,
) => {
  const slices = deriveCutSlices(payload);
  const rows = Math.max(1, Math.ceil(slices.length / 2));
  return renderGridSheet(2, rows, v, async (idx, surface, tileCanvas) => {
    const slice = slices[idx];
    if (!slice) return '';
    await renderTileToCanvas(
      surface,
      tileCanvas,
      payload,
      v,
      {
        bakedMesh: slice.bakedMesh,
        document: slice.document,
        clipY: slice.cutY,
        envId: 'blueprint',
        positionCamera: (bounds) => frameBoxAtAngles(surface.camera, bounds, 35, 62, v.zoom, 42),
      },
      signal,
    );
    return slice.label;
  });
};

const renderInteriorSheet = (
  payload: StructureObservationPayload,
  v: ViewOptions,
  signal: AbortSignal,
) => {
  const cams = computeInteriorCameras(payload);
  const cols = cams.length === 1 ? 1 : 2;
  const rows = Math.max(1, Math.ceil(cams.length / cols));
  return renderGridSheet(cols, rows, v, async (idx, surface, tileCanvas) => {
    const cam = cams[idx];
    if (!cam) return '';
    await renderTileToCanvas(
      surface,
      tileCanvas,
      payload,
      v,
      {
        interiorFill: true,
        envId: v.environment,
        positionCamera: () => applyEyeLevelCamera(surface.camera, cam.eye, cam.lookAt, 65),
      },
      signal,
    );
    return cam.label;
  });
};

const renderTurnaroundSheet = (
  payload: StructureObservationPayload,
  v: ViewOptions,
  signal: AbortSignal,
) => {
  const frontAz = detectFrontAzimuth(payload);
  const turnSpecs = [
    { label: 'FRONT', azimuth: frontAz, elevation: 12 },
    { label: '3/4', azimuth: 45, elevation: 22 },
    { label: 'SIDE', azimuth: frontAz - 90, elevation: 12 },
    { label: 'BACK', azimuth: frontAz + 180, elevation: 12 },
  ];
  return renderGridSheet(2, 2, v, async (idx, surface, tileCanvas) => {
    const spec = turnSpecs[idx]!;
    await renderTileToCanvas(
      surface,
      tileCanvas,
      payload,
      v,
      {
        envId: v.environment,
        positionCamera: (bounds) =>
          frameBoxAtAngles(
            surface.camera,
            bounds,
            spec.azimuth,
            spec.elevation,
            v.zoom * (spec.elevation >= 20 ? 1.32 : 1.08),
            42,
          ),
      },
      signal,
    );
    return spec.label;
  });
};

const resolveSingleAzimuth = (payload: StructureObservationPayload, v: ViewOptions): number => {
  if (v.azimuth !== undefined) return v.azimuth;
  const frontAz = detectFrontAzimuth(payload);
  if (v.camera === 'front') return frontAz;
  if (v.camera === 'back') return frontAz + 180;
  if (v.camera === 'left') return frontAz - 90;
  if (v.camera === 'right') return frontAz + 90;
  if (v.camera === 'top') return 0;
  return 45;
};

/** Captures single-view or 3-mode architectural sheets for structures. */
export const captureStructureObservation = async (
  payload: StructureObservationPayload,
  v: ViewOptions,
  signal: AbortSignal,
): Promise<{ mime: string; data: string }> => {
  if (v.sheet === 'exterior') return renderExteriorSheet(payload, v, signal);
  if (v.sheet === 'cutaway') return renderCutawaySheet(payload, v, signal);
  if (v.sheet === 'interior') return renderInteriorSheet(payload, v, signal);
  if (v.sheet === 'turnaround') return renderTurnaroundSheet(payload, v, signal);

  const surface = createCaptureSurface({
    width: v.width,
    height: v.height,
    cameraMode: 'perspective',
    environment: v.environment,
    forward: 'north',
  });
  const output = createCanvas2d(v.width, v.height);
  const singleAz = resolveSingleAzimuth(payload, v);
  const singleEl = v.elevation ?? (v.camera === 'top' ? 88 : v.camera === 'bottom' ? -88 : 22);
  try {
    await renderTileToCanvas(
      surface,
      output,
      payload,
      v,
      {
        clipY: v.cutaway,
        envId: v.environment,
        positionCamera: (bounds) =>
          frameBoxAtAngles(surface.camera, bounds, singleAz, singleEl, v.zoom, 42),
      },
      signal,
    );
    return { mime: 'image/png', data: output.canvas.toDataURL('image/png').split(',')[1] };
  } finally {
    disposeCaptureSurface(surface);
  }
};
