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
  const entrySocket = payload.playableMeta.sockets.find((s) => s.schema === 'std.entry');
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

const collectSolidMeshes = (root: THREE.Group): THREE.Object3D[] => {
  const meshes: THREE.Object3D[] = [];
  root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    const layer = obj.userData?.ashfoxLayer;
    if (layer === 'sun_shaft' || layer === 'translucent') return;
    meshes.push(obj);
  });
  return meshes;
};

const scoreCameraRayClearance = (
  raycaster: THREE.Raycaster,
  meshes: readonly THREE.Object3D[],
  eye: readonly [number, number, number],
  lookAt: readonly [number, number, number],
): number => {
  const origin = new THREE.Vector3(eye[0], eye[1], eye[2]);
  const target = new THREE.Vector3(lookAt[0], lookAt[1], lookAt[2]);
  const toTarget = target.clone().sub(origin);
  const dist = toTarget.length();
  if (dist < 0.8) return -1;
  const fwd = toTarget.clone().divideScalar(dist);
  raycaster.set(origin, fwd);
  raycaster.far = dist * 0.92;
  const hits = raycaster.intersectObjects(meshes as THREE.Object3D[], false);
  if (hits.length > 0 && hits[0]!.distance < dist * 0.72) return -1;
  const side = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
  let minSideDist = dist;
  for (const ang of [-0.28, 0.28, -0.5, 0.5]) {
    const dir = fwd.clone().addScaledVector(side, ang).normalize();
    raycaster.set(origin, dir);
    raycaster.far = 2.0;
    const sh = raycaster.intersectObjects(meshes as THREE.Object3D[], false);
    if (sh.length > 0) minSideDist = Math.min(minSideDist, sh[0]!.distance);
  }
  if (minSideDist < 0.32) return -1;
  return dist + minSideDist * 1.5;
};

const buildCandidateViews = (
  b: WorldBox,
  focal: readonly [number, number, number],
  fallback: InteriorCameraSpec,
): readonly InteriorCameraSpec[] => {
  const insetX = Math.min(0.95, Math.max(0.45, (b.maxX - b.minX) * 0.16));
  const insetZ = Math.min(0.95, Math.max(0.45, (b.maxZ - b.minZ) * 0.16));
  const [x0, x1] = [b.minX + insetX, b.maxX - insetX];
  const [z0, z1] = [b.minZ + insetZ, b.maxZ - insetZ];
  const [cx, cz] = [(b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2];
  const eyeY = Math.min(b.maxY - 0.35, b.minY + 1.55);
  const look: readonly [number, number, number] = [cx, Math.min(b.maxY - 0.45, b.minY + 1.25), cz];
  const pts: readonly (readonly [number, number])[] = [
    [x0, z1],
    [x1, z1],
    [x0, z0],
    [x1, z0],
    [cx, z1],
    [x1, cz],
    [x0, cz],
    [cx, z0],
  ];
  return [
    fallback,
    ...pts.map(([ex, ez]) => ({
      label: fallback.label,
      eye: [ex, eyeY, ez] as const,
      lookAt: focal,
    })),
    ...pts
      .slice(0, 4)
      .map(([ex, ez]) => ({ label: fallback.label, eye: [ex, eyeY, ez] as const, lookAt: look })),
  ];
};

const pickClearRoomCamera = (
  raycaster: THREE.Raycaster,
  meshes: readonly THREE.Object3D[],
  payload: StructureObservationPayload,
  room: StructureObservationPayload['rooms'][number],
): InteriorCameraSpec => {
  const fallback = roomToInteriorCam(payload, room);
  if (meshes.length === 0) return fallback;
  const b = roomWorldBounds(payload, room);
  const focal = pickZoneFocalTarget(payload, b);
  let bestCam = fallback;
  let bestScore = -1;
  for (const cand of buildCandidateViews(b, focal, fallback)) {
    const score = scoreCameraRayClearance(raycaster, meshes, cand.eye, cand.lookAt);
    if (score > bestScore) {
      bestScore = score;
      bestCam = cand;
    }
  }
  return bestCam;
};

/** Selects raycast-clear interior cameras avoiding pillars, stairs, beams, and furniture obstructions. */
export const resolveRaycastInteriorCameras = (
  root: THREE.Group,
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
  const meshes = collectSolidMeshes(root);
  const raycaster = new THREE.Raycaster();
  const cams = enclosed.map((room) => pickClearRoomCamera(raycaster, meshes, payload, room));
  if (cams.length === 3) {
    const hero = synthesizeThresholdHeroCam(payload, enclosed[0]!, cams[0]!);
    const clear = scoreCameraRayClearance(raycaster, meshes, hero.eye, hero.lookAt);
    cams.push(clear >= 0 ? hero : pickClearRoomCamera(raycaster, meshes, payload, enclosed[0]!));
    cams[3] = { ...cams[3]!, label: 'THRESHOLD / HERO' };
  }
  return cams;
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
