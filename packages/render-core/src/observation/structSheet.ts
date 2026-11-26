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
  createTwilightSkyTexture,
  frameStructureShadows,
  type StructureObservationPayload,
  type StructureObservationSlice,
  type StructureSceneBuildOptions,
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

const FRONT_AZIMUTH: Readonly<Record<string, number>> = {
  east: 90,
  west: -90,
  north: 0,
  south: 180,
};

const detectFrontAzimuth = (payload: StructureObservationPayload): number => {
  const entrySocket = payload.playableMeta.sockets.find((s) => s.kind === 'entry');
  const door = payload.playableMeta.interactables.find((i) => i.kind === 'door');
  return FRONT_AZIMUTH[entrySocket?.normal ?? door?.facing ?? 'south'] ?? 180;
};

const tileSpecs = (
  frontAz: number,
  mode: 'exterior' | 'turnaround',
): readonly ExteriorTileSpec[] =>
  mode === 'exterior'
    ? [
        { label: 'HERO SW', azimuth: -135, elevation: 26, twilight: false },
        { label: 'HERO NE', azimuth: 45, elevation: 26, twilight: false },
        { label: 'FRONT', azimuth: frontAz, elevation: 6, twilight: false },
        { label: 'LEFT', azimuth: frontAz - 90, elevation: 6, twilight: false },
        { label: 'RIGHT', azimuth: frontAz + 90, elevation: 6, twilight: false },
        { label: 'TWILIGHT', azimuth: frontAz - 40, elevation: 24, twilight: true },
      ]
    : [
        { label: 'FRONT', azimuth: frontAz, elevation: 12, twilight: false },
        { label: '3/4', azimuth: 45, elevation: 22, twilight: false },
        { label: 'SIDE', azimuth: frontAz - 90, elevation: 12, twilight: false },
        { label: 'BACK', azimuth: frontAz + 180, elevation: 12, twilight: false },
      ];

const deriveCutSlices = (
  payload: StructureObservationPayload,
): readonly StructureObservationSlice[] =>
  payload.cutSlices && payload.cutSlices.length > 0
    ? payload.cutSlices
    : collectStructureCutBands(payload.floors, payload.size[1]);

const roomWorldBounds = (
  payload: StructureObservationPayload,
  room: StructureObservationPayload['rooms'][number],
) => {
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

type WorldBox = ReturnType<typeof roomWorldBounds>;

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
  const pull = Math.hypot(dx, dz) > 0.25 ? 0.44 : 0;
  const insetX = Math.min(1.1, Math.max(0.65, (b.maxX - b.minX) * 0.24));
  const insetZ = Math.min(1.1, Math.max(0.65, (b.maxZ - b.minZ) * 0.24));
  return {
    label: room.name.toUpperCase(),
    eye: [
      THREE.MathUtils.clamp(cx + dx * pull, b.minX + insetX, b.maxX - insetX),
      Math.min(b.maxY - 0.35, b.minY + 1.65),
      THREE.MathUtils.clamp(cz + dz * pull, b.minZ + insetZ, b.maxZ - insetZ),
    ],
    lookAt: focal,
  };
};

const frameHeroAngles = (
  cam: THREE.PerspectiveCamera,
  b: THREE.Box3,
  az: number,
  el: number,
  zoom: number,
) =>
  frameBoxAtAngles(
    cam,
    b,
    az,
    el,
    zoom * (Math.abs(el) >= 20 && Math.abs(el) < 80 ? 1.15 : 1.08),
    42,
    1.03,
  );

const synthesizeThresholdHeroCam = (
  payload: StructureObservationPayload,
  room: StructureObservationPayload['rooms'][number],
  primaryCam: InteriorCameraSpec,
): InteriorCameraSpec => {
  const b = roomWorldBounds(payload, room);
  const cx = (b.minX + b.maxX) / 2;
  const cz = (b.minZ + b.maxZ) / 2;
  const insetX = Math.min(1.15, Math.max(0.7, (b.maxX - b.minX) * 0.25));
  const insetZ = Math.min(1.15, Math.max(0.7, (b.maxZ - b.minZ) * 0.25));
  const eyeX = THREE.MathUtils.clamp(cx * 2 - primaryCam.eye[0], b.minX + insetX, b.maxX - insetX);
  const eyeZ = THREE.MathUtils.clamp(cz * 2 - primaryCam.eye[2], b.minZ + insetZ, b.maxZ - insetZ);
  return {
    label: 'THRESHOLD / HERO',
    eye: [eyeX, Math.min(b.maxY - 0.35, b.minY + 1.65), eyeZ],
    lookAt: [cx, Math.min(b.maxY - 0.4, b.minY + 1.35), cz],
  };
};

const fallbackInteriorCameras = (
  payload: StructureObservationPayload,
): readonly InteriorCameraSpec[] => {
  const [w, h, d] = payload.size;
  const nav = payload.playableMeta.navigation.floorLevels;
  const levels =
    payload.floors.length > 0
      ? payload.floors.map((f) => f.y + 1)
      : nav.length > 0
        ? nav.map((y) => Math.max(1, y))
        : h >= 14
          ? [1, 6]
          : [1];
  const cams = levels.slice(0, 4).map((floorY, idx) => ({
    label: `ROOM ${idx + 1}`,
    eye: [-w * 0.16, Math.min(h - 1.2, floorY + 1.6), d * 0.16] as const,
    lookAt: [w * 0.15, Math.min(h - 1.3, floorY + 1.35), -d * 0.18] as const,
  }));
  if (cams.length !== 3) return cams;
  const y0 = levels[0] ?? 1;
  return [
    ...cams,
    {
      label: 'THRESHOLD / HERO',
      eye: [w * 0.16, Math.min(h - 1.2, y0 + 1.6), -d * 0.16] as const,
      lookAt: [-w * 0.14, Math.min(h - 1.3, y0 + 1.35), d * 0.14] as const,
    },
  ];
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
  if (enclosed.length === 0) return fallbackInteriorCameras(payload);
  const cams = enclosed.map((room) => roomToInteriorCam(payload, room));
  if (cams.length === 3) cams.push(synthesizeThresholdHeroCam(payload, enclosed[0]!, cams[0]!));
  return cams;
};

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
  readonly positionCamera: (bounds: THREE.Box3, camera: THREE.PerspectiveCamera) => void;
};

const renderTileToCanvas = async (
  surface: CaptureSurface,
  tileCanvas: ReturnType<typeof createCanvas2d>,
  payload: StructureObservationPayload,
  v: ViewOptions,
  options: TileRenderOptions,
  signal: AbortSignal,
): Promise<void> => {
  surface.renderer.localClippingEnabled =
    options.clipY !== undefined && options.bakedMesh === undefined;
  const handle = await buildStructureScene(payload, options, signal);
  surface.scene.add(handle.root);
  const disposeBackdrop = applySurfaceBackdrop(surface, v.background, options.envId);
  try {
    frameStructureShadows(surface.scene, handle.bounds, options.twilight ?? false);
    options.positionCamera(handle.bounds, surface.camera);
    surface.renderer.render(surface.scene, surface.camera);
    const bg = v.background === 'environment' ? 'transparent' : v.background;
    fillBackground(tileCanvas.context, tileCanvas.canvas.width, tileCanvas.canvas.height, bg);
    tileCanvas.context.drawImage(surface.renderCanvas, 0, 0);
  } finally {
    disposeBackdrop?.();
    surface.scene.remove(handle.root);
    handle.dispose();
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

const renderConfiguredSheet = (
  cols: number,
  rows: number,
  tiles: readonly SheetTileConfig[],
  payload: StructureObservationPayload,
  v: ViewOptions,
  signal: AbortSignal,
  sheetBg?: string,
) =>
  renderGridSheet(
    cols,
    rows,
    v,
    sheetBg ?? (v.background === 'environment' ? 'transparent' : v.background),
    async (idx, surface, tileCanvas) => {
      const tile = tiles[idx];
      if (!tile) return null;
      await renderTileToCanvas(surface, tileCanvas, payload, v, tile, signal);
      return tile.label;
    },
  );

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

const resolveSingleAzimuth = (payload: StructureObservationPayload, v: ViewOptions): number => {
  if (v.azimuth !== undefined) return v.azimuth;
  const frontAz = detectFrontAzimuth(payload);
  const map: Readonly<Record<string, number>> = {
    front: frontAz,
    back: frontAz + 180,
    left: frontAz - 90,
    right: frontAz + 90,
    top: 0,
  };
  return map[v.camera] ?? 45;
};

const cutawayTiles = (
  slices: readonly StructureObservationSlice[],
  zoom: number,
): readonly SheetTileConfig[] => {
  const base: SheetTileConfig[] = slices.map((s) => ({
    label: s.label,
    bakedMesh: s.bakedMesh,
    document: s.document,
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
  cams: readonly InteriorCameraSpec[],
  envId: SheetEnvironmentId,
): readonly SheetTileConfig[] =>
  cams.map((cam) => ({
    label: cam.label,
    interiorFill: true,
    envId,
    positionCamera: (_b, camObj) => applyEyeLevelCamera(camObj, cam.eye, cam.lookAt, 65),
  }));

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
      tiles: interiorTiles(cams, v.environment),
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
