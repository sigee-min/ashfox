import * as THREE from 'three';

import { compareText } from '@ashfox/internal-contracts';
import { frameBoxAtAngles } from '../cameraPresets';
import type { StructureObservationPayload } from '../structureRender';
import type { ViewOptions } from './contract';

export interface InteriorCameraSpec {
  readonly label: string;
  readonly eye: readonly [number, number, number];
  readonly lookAt: readonly [number, number, number];
}

export interface ExteriorTileSpec {
  readonly label: string;
  readonly azimuth: number;
  readonly elevation: number;
  readonly twilight: boolean;
}

const FRONT_AZIMUTH: Readonly<Record<string, number>> = {
  east: 90,
  west: -90,
  north: 0,
  south: 180,
};

export const detectFrontAzimuth = (payload: StructureObservationPayload): number => {
  const entrySocket = payload.playableMeta.sockets.find((s) => s.kind === 'entry');
  const door = payload.playableMeta.interactables.find((i) => i.kind === 'door');
  return FRONT_AZIMUTH[entrySocket?.normal ?? door?.facing ?? 'south'] ?? 180;
};

export const tileSpecs = (
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

export const frameHeroAngles = (
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

export const computeInteriorCameras = (
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

export const resolveSingleAzimuth = (
  payload: StructureObservationPayload,
  v: ViewOptions,
): number => {
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
