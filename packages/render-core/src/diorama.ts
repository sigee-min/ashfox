import * as THREE from 'three';

import type { StructureProduct } from '@ashfox/engine-core';

type PlayableMeta = StructureProduct['playableMeta'];
type CardinalFacing = PlayableMeta['interactables'][number]['facing'];

interface DioramaPalette {
  readonly grass: string;
  readonly grassDark: string;
  readonly soil: string;
  readonly stone: string;
  readonly cobble: string;
  readonly cobbleMoss: string;
}

const DAY_PALETTE: DioramaPalette = {
  grass: '#5f8f44',
  grassDark: '#4f7a38',
  soil: '#6b4c35',
  stone: '#4e545c',
  cobble: '#6e7378',
  cobbleMoss: '#5b6c52',
};

const TWILIGHT_PALETTE: DioramaPalette = {
  grass: '#4e6d56',
  grassDark: '#3d5844',
  soil: '#4e3c36',
  stone: '#3a4152',
  cobble: '#555d6b',
  cobbleMoss: '#4a5c53',
};

const FACING_DELTA: Readonly<Record<CardinalFacing, readonly [number, number]>> = {
  north: [0, -1],
  south: [0, 1],
  east: [1, 0],
  west: [-1, 0],
};

const createMeadowTexture = (
  baseHex: string,
  accentHex: string,
  repeatX: number,
  repeatZ: number,
): THREE.Texture | null => {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = 16;
  canvas.height = 16;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = baseHex;
  ctx.fillRect(0, 0, 16, 16);
  ctx.fillStyle = accentHex;
  for (let y = 0; y < 16; y += 1) {
    for (let x = 0; x < 16; x += 1) {
      const hash = ((x * 73 + y * 151 + x * y * 19) & 0xff) / 255;
      if (hash > 0.68) ctx.fillRect(x, y, 1, 1);
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(Math.max(1, Math.round(repeatX)), Math.max(1, Math.round(repeatZ)));
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
};

const pushQuad = (
  positions: number[],
  normals: number[],
  indices: number[],
  p0: readonly [number, number, number],
  p1: readonly [number, number, number],
  p2: readonly [number, number, number],
  p3: readonly [number, number, number],
): void => {
  const base = positions.length / 3;
  positions.push(...p0, ...p1, ...p2, ...p3);
  const ax = p1[0] - p0[0];
  const ay = p1[1] - p0[1];
  const az = p1[2] - p0[2];
  const bx = p2[0] - p0[0];
  const by = p2[1] - p0[1];
  const bz = p2[2] - p0[2];
  const nx = ay * bz - az * by;
  const ny = az * bx - ax * bz;
  const nz = ax * by - ay * bx;
  const len = Math.hypot(nx, ny, nz) || 1;
  for (let i = 0; i < 4; i += 1) normals.push(nx / len, ny / len, nz / len);
  indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
};

const createBevelSkirtGeometry = (
  topW: number,
  topD: number,
  botW: number,
  botD: number,
  topY: number,
  botY: number,
): THREE.BufferGeometry => {
  const tx = topW / 2;
  const tz = topD / 2;
  const bx = Math.max(0.8, botW / 2);
  const bz = Math.max(0.8, botD / 2);
  const pos: number[] = [];
  const norm: number[] = [];
  const idx: number[] = [];
  pushQuad(pos, norm, idx, [-tx, topY, tz], [-bx, botY, bz], [bx, botY, bz], [tx, topY, tz]);
  pushQuad(pos, norm, idx, [tx, topY, -tz], [bx, botY, -bz], [-bx, botY, -bz], [-tx, topY, -tz]);
  pushQuad(pos, norm, idx, [tx, topY, tz], [bx, botY, bz], [bx, botY, -bz], [tx, topY, -tz]);
  pushQuad(pos, norm, idx, [-tx, topY, -tz], [-bx, botY, -bz], [-bx, botY, bz], [-tx, topY, tz]);
  pushQuad(pos, norm, idx, [-bx, botY, bz], [-bx, botY, -bz], [bx, botY, -bz], [bx, botY, bz]);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(norm, 3));
  geo.setIndex(idx);
  geo.computeBoundingSphere();
  return geo;
};

interface EntryApron {
  readonly x: number;
  readonly z: number;
  readonly facing: CardinalFacing;
}

const inferOutwardFacing = (x: number, z: number, halfW: number, halfD: number): CardinalFacing => {
  const rx = Math.abs(x) / Math.max(1, halfW);
  const rz = Math.abs(z) / Math.max(1, halfD);
  if (rx > rz) return x >= 0 ? 'east' : 'west';
  return z >= 0 ? 'south' : 'north';
};

const collectEntryAprons = (
  size: readonly [number, number, number],
  playableMeta: PlayableMeta,
): readonly EntryApron[] => {
  const halfW = size[0] / 2;
  const halfD = size[2] / 2;
  const candidates: EntryApron[] = playableMeta.sockets
    .filter((s) => s.schema === 'std.entry' && s.position[1] <= 2)
    .map((s) => ({ x: s.position[0], z: s.position[2], facing: s.normal }));
  if (candidates.length === 0) {
    for (const item of playableMeta.interactables) {
      if (item.kind === 'door' && item.position[1] <= 2) {
        const [wx, _wy, wz] = item.position;
        candidates.push({ x: wx, z: wz, facing: inferOutwardFacing(wx, wz, halfW, halfD) });
      }
    }
  }
  const unique: EntryApron[] = [];
  for (const c of candidates) {
    if (unique.some((u) => Math.hypot(u.x - c.x, u.z - c.z) < 1.6)) continue;
    unique.push(c);
    if (unique.length >= 3) break;
  }
  return unique;
};

const addCobbleBox = (
  group: THREE.Group,
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  material: THREE.Material,
  disposables: (() => void)[],
): void => {
  const geo = new THREE.BoxGeometry(w, h, d);
  const mesh = new THREE.Mesh(geo, material);
  mesh.position.set(x, y, z);
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  group.add(mesh);
  disposables.push(() => geo.dispose());
};

const appendEntryPath = (
  group: THREE.Group,
  apron: EntryApron,
  halfW: number,
  halfD: number,
  cobbleMat: THREE.Material,
  mossMat: THREE.Material,
  disposables: (() => void)[],
): void => {
  const [dx, dz] = FACING_DELTA[apron.facing];
  const edgeDist =
    dx !== 0 ? Math.max(1.2, halfW - dx * apron.x) : Math.max(1.2, halfD - dz * apron.z);
  const pathLen = Math.min(edgeDist, 4.2);
  const mainLen = pathLen * 0.72;
  const cx = apron.x + dx * (mainLen * 0.5 + 0.25);
  const cz = apron.z + dz * (mainLen * 0.5 + 0.25);
  const isX = dx !== 0;
  addCobbleBox(
    group,
    isX ? mainLen : 1.7,
    0.024,
    isX ? 1.7 : mainLen,
    cx,
    -0.012,
    cz,
    cobbleMat,
    disposables,
  );
  const step1 = mainLen + 0.65;
  const step2 = mainLen + 1.25;
  if (step1 <= edgeDist) {
    addCobbleBox(
      group,
      isX ? 0.65 : 1.15,
      0.022,
      isX ? 1.15 : 0.65,
      apron.x + dx * step1 - dz * 0.18,
      -0.011,
      apron.z + dz * step1 + dx * 0.18,
      mossMat,
      disposables,
    );
  }
  if (step2 <= edgeDist) {
    addCobbleBox(
      group,
      isX ? 0.52 : 0.9,
      0.02,
      isX ? 0.9 : 0.52,
      apron.x + dx * step2 + dz * 0.22,
      -0.01,
      apron.z + dz * step2 - dx * 0.22,
      cobbleMat,
      disposables,
    );
  }
};

const createDioramaMaterials = (
  palette: DioramaPalette,
  topW: number,
  topD: number,
  disposables: (() => void)[],
) => {
  const grassTex = createMeadowTexture(palette.grass, palette.grassDark, topW / 2, topD / 2);
  const makeMat = (
    color: string,
    roughness: number,
    metalness: number,
    map: THREE.Texture | null = null,
  ) => new THREE.MeshStandardMaterial({ color, map, roughness, metalness });
  const grassMat = makeMat(grassTex ? '#ffffff' : palette.grass, 0.94, 0.02, grassTex);
  const soilMat = makeMat(palette.soil, 0.96, 0.02);
  const stoneMat = makeMat(palette.stone, 0.92, 0.04);
  const cobbleMat = makeMat(palette.cobble, 0.9, 0.04);
  const mossMat = makeMat(palette.cobbleMoss, 0.92, 0.03);
  disposables.push(() => {
    grassTex?.dispose();
    grassMat.dispose();
    soilMat.dispose();
    stoneMat.dispose();
    cobbleMat.dispose();
    mossMat.dispose();
  });
  return { grassMat, soilMat, stoneMat, cobbleMat, mossMat };
};

const addDioramaLayer = (
  group: THREE.Group,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  yOffset: number,
  disposables: (() => void)[],
): void => {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.y = yOffset;
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  group.add(mesh);
  disposables.push(() => geometry.dispose());
};

/** Builds a layered observation-only voxel diorama island strictly at y <= 0. */
export const createObservationDiorama = (
  size: readonly [number, number, number],
  playableMeta: PlayableMeta,
  twilight: boolean,
  disposables: (() => void)[],
): THREE.Group => {
  const group = new THREE.Group();
  group.name = 'ashfoxObservationDiorama';
  const palette = twilight ? TWILIGHT_PALETTE : DAY_PALETTE;
  const margin = Math.max(2.2, Math.min(3.8, Math.max(size[0], size[2]) * 0.18));
  const topW = size[0] + margin * 2;
  const topD = size[2] + margin * 2;
  const mats = createDioramaMaterials(palette, topW, topD, disposables);
  addDioramaLayer(
    group,
    new THREE.BoxGeometry(topW, 0.16, topD),
    mats.grassMat,
    -0.088,
    disposables,
  );
  addDioramaLayer(
    group,
    createBevelSkirtGeometry(topW - 0.14, topD - 0.14, topW - 0.72, topD - 0.72, -0.168, -0.46),
    mats.soilMat,
    0,
    disposables,
  );
  addDioramaLayer(
    group,
    createBevelSkirtGeometry(topW - 0.72, topD - 0.72, topW - 1.65, topD - 1.65, -0.46, -0.85),
    mats.stoneMat,
    0,
    disposables,
  );
  for (const apron of collectEntryAprons(size, playableMeta)) {
    appendEntryPath(
      group,
      apron,
      topW / 2 - 0.3,
      topD / 2 - 0.3,
      mats.cobbleMat,
      mats.mossMat,
      disposables,
    );
  }
  return group;
};
