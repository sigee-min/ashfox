import { clamp01 } from '@ashfox/internal-contracts';
import type { Vec3 } from '../../../model/identity';
import type { CardinalFacing } from '../../../project/structure/contract';
import {
  SUBVOXEL_UNITS_PER_BLOCK,
  type InteriorOpeningSpan,
  type InteriorRoomInput,
  type InteriorSunShaftConfig,
  type InteriorSunShaftQuad,
  type StyleDnaMood,
  type SubVoxelBoxIR,
} from './contract';
import { parseHexRgb } from './radiosity';

export { emitPlayableInteriorMeta } from './metaHooks';

type ShaftTuple = readonly [Vec3, number, number, string];
const SHAFT_MOODS: Readonly<Record<StyleDnaMood, ShaftTuple>> = {
  warm_hearth: [[0.35, -0.72, 0.6], 0.42, 5.5, '#ffd89b'],
  zen_daylight: [[0.3, -0.75, 0.58], 0.48, 6.0, '#fff4d6'],
  minimal_bright: [[0.32, -0.76, 0.56], 0.38, 5.5, '#ffffff'],
  cyber_neon: [[0.4, -0.68, 0.61], 0.28, 4.5, '#7ae8ff'],
  arcane_dusk: [[0.38, -0.65, 0.65], 0.35, 5.0, '#b59cff'],
  sunbaked_ochre: [[0.25, -0.78, 0.57], 0.55, 6.0, '#ffe094'],
};

const INWARD_VEC: Readonly<Record<CardinalFacing, Vec3>> = {
  north: [0, 0, 1],
  south: [0, 0, -1],
  east: [-1, 0, 0],
  west: [1, 0, 0],
};
const TANGENT_VEC: Readonly<Record<CardinalFacing, Vec3>> = {
  north: [1, 0, 0],
  south: [1, 0, 0],
  east: [0, 0, 1],
  west: [0, 0, 1],
};

export interface TranslucentWindowPane {
  readonly id: string;
  readonly opening_id: string;
  readonly double_sided: true;
  readonly alpha: number;
  readonly color: string;
  readonly box: SubVoxelBoxIR;
}

export interface SunShaftMeshBatch {
  readonly positions: readonly number[];
  readonly normals: readonly number[];
  readonly uvs: readonly number[];
  readonly colors: readonly number[];
  readonly indices: readonly number[];
  readonly doubleSided: true;
  readonly alphaMode: 'BLEND';
}

const normalize = (v: Vec3): Vec3 => {
  const len = Math.hypot(v[0], v[1], v[2]);
  return len > 1e-6 ? [v[0] / len, v[1] / len, v[2] / len] : [0, -1, 0];
};

const addScaled = (a: Vec3, b: Vec3, s: number): Vec3 => [
  a[0] + b[0] * s,
  a[1] + b[1] * s,
  a[2] + b[2] * s,
];
const isLitOpening = (op: InteriorOpeningSpan): boolean =>
  op.kind === 'window' || op.kind === 'bay_window' || op.kind === 'arch' || op.kind === 'arcade';

const defaultSunForRoom = (room: InteriorRoomInput, cfg: InteriorSunShaftConfig): Vec3 => {
  const win = room.openings.find(isLitOpening);
  if (!win) return normalize(cfg.sun_dir);
  const inward = INWARD_VEC[win.wall];
  return normalize([inward[0] * 0.65 + 0.12, -0.72, inward[2] * 0.65 + 0.12]);
};

/** Builds a closed InteriorSunShaftConfig calibrated to style mood. */
export const defaultSunShaftConfig = (
  mood: StyleDnaMood,
  overrides?: Partial<InteriorSunShaftConfig>,
): InteriorSunShaftConfig => {
  const p = SHAFT_MOODS[mood];
  return { sun_dir: p[0], mood, intensity: p[1], shaft_length_b: p[2], ...overrides };
};

const buildShaftSliceQuad = (
  room: InteriorRoomInput,
  op: InteriorOpeningSpan,
  rayDir: Vec3,
  cfg: InteriorSunShaftConfig,
  sliceIdx: number,
): InteriorSunShaftQuad => {
  const inward = INWARD_VEC[op.wall];
  const tangent = TANGENT_VEC[op.wall];
  const cx = (op.from[0] + op.to[0] + 1) * 0.5;
  const cy = (op.from[1] + op.to[1] + 1) * 0.5;
  const cz = (op.from[2] + op.to[2] + 1) * 0.5;
  const span =
    op.wall === 'north' || op.wall === 'south'
      ? op.to[0] - op.from[0] + 1
      : op.to[2] - op.from[2] + 1;
  const halfW = Math.max(0.35, span * 0.42);
  const originCenter: Vec3 = [
    cx + inward[0] * 0.35,
    cy + (sliceIdx === 1 ? 0.25 : 0),
    cz + inward[2] * 0.35,
  ];
  const floorY = room.bounds_from[1] + 1.02;
  const distToFloor =
    rayDir[1] < -0.05 ? (floorY - originCenter[1]) / rayDir[1] : cfg.shaft_length_b;
  const endCenter = addScaled(
    originCenter,
    rayDir,
    Math.max(1.2, Math.min(cfg.shaft_length_b, distToFloor)),
  );
  const axis: Vec3 =
    sliceIdx === 0 ? tangent : normalize([tangent[0] * 0.65, 0.72, tangent[2] * 0.65]);
  const spread = halfW * 1.28;
  return {
    id: `${room.room_id}_shaft_${op.id}_${sliceIdx}`,
    opening_id: op.id,
    corners: [
      addScaled(originCenter, axis, -halfW),
      addScaled(originCenter, axis, halfW),
      addScaled(endCenter, axis, spread),
      addScaled(endCenter, axis, -spread),
    ],
    color: op.stained_glass_color ?? SHAFT_MOODS[cfg.mood][3],
    alpha_top: clamp01(cfg.intensity * (sliceIdx === 0 ? 0.55 : 0.38)),
    alpha_bottom: 0.02,
    floor_patch_center: [endCenter[0], floorY, endCenter[2]],
  };
};

/** Generates volumetric translucent sun_shaft god-ray quads aligned to sunlit openings + sun angle. */
export const generateInteriorSunShafts = (
  room: InteriorRoomInput,
  config?: Partial<InteriorSunShaftConfig>,
): readonly InteriorSunShaftQuad[] => {
  const cfg = defaultSunShaftConfig(room.style_dna.mood, config);
  const effectiveSun = config?.sun_dir ? normalize(config.sun_dir) : defaultSunForRoom(room, cfg);
  const quads: InteriorSunShaftQuad[] = [];
  for (const opening of room.openings) {
    if (!isLitOpening(opening)) continue;
    const inward = INWARD_VEC[opening.wall];
    if (
      effectiveSun[0] * inward[0] + effectiveSun[1] * inward[1] + effectiveSun[2] * inward[2] <=
      0.05
    )
      continue;
    quads.push(
      buildShaftSliceQuad(room, opening, effectiveSun, cfg, 0),
      buildShaftSliceQuad(room, opening, effectiveSun, cfg, 1),
    );
  }
  return quads;
};

/** Builds double-sided additive/translucent mesh buffers for sun_shaft god-ray quads. */
export const buildSunShaftMeshPrimitives = (
  shafts: readonly InteriorSunShaftQuad[],
): SunShaftMeshBatch => {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const uvCoords = [0, 0, 1, 0, 1, 1, 0, 1];
  for (const q of shafts) {
    const base = positions.length / 3;
    const rgb = parseHexRgb(q.color) ?? [1, 0.94, 0.78];
    const [p0, p1, , p3] = q.corners;
    const [e1x, e1y, e1z] = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
    const [e2x, e2y, e2z] = [p3[0] - p0[0], p3[1] - p0[1], p3[2] - p0[2]];
    const n = normalize([e1y * e2z - e1z * e2y, e1z * e2x - e1x * e2z, e1x * e2y - e1y * e2x]);
    for (let i = 0; i < 4; i += 1) {
      const c = q.corners[i]!;
      positions.push(c[0], c[1], c[2]);
      normals.push(n[0], n[1], n[2]);
      uvs.push(uvCoords[i * 2]!, uvCoords[i * 2 + 1]!);
      colors.push(rgb[0], rgb[1], rgb[2], i < 2 ? q.alpha_top : q.alpha_bottom);
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return { positions, normals, uvs, colors, indices, doubleSided: true, alphaMode: 'BLEND' };
};

const buildPaneForOpening = (roomId: string, op: InteriorOpeningSpan): TranslucentWindowPane => {
  const u = SUBVOXEL_UNITS_PER_BLOCK;
  const alongX = op.wall === 'north' || op.wall === 'south';
  const [x0, y0, z0, x1, y1, z1] = [
    op.from[0] * u,
    op.from[1] * u,
    op.from[2] * u,
    (op.to[0] + 1) * u,
    (op.to[1] + 1) * u,
    (op.to[2] + 1) * u,
  ];
  const from16: Vec3 = [alongX ? x0 + 1 : x0 + 7, y0 + 1, alongX ? z0 + 7 : z0 + 1];
  const to16: Vec3 = [alongX ? x1 - 1 : x0 + 9, y1 - 1, alongX ? z0 + 9 : z1 - 1];
  const color = op.stained_glass_color ?? '#9ad6eb';
  return {
    id: `${roomId}_pane_${op.id}`,
    opening_id: op.id,
    double_sided: true,
    alpha: op.stained_glass_color ? 0.48 : 0.28,
    color,
    box: {
      id: `${roomId}_pane_${op.id}_box`,
      from_16: from16,
      to_16: to16,
      tile_id: op.stained_glass_color ? 'stained_glass' : 'glass',
      layer: 'translucent',
      color_tint: color,
      semantic_tag: 'window_pane_double_sided',
    },
  };
};

/** Generates translucent double-sided window panes in 1/16 sub-voxel IR for window openings. */
export const generateTranslucentWindowPanes = (
  room: InteriorRoomInput,
): readonly TranslucentWindowPane[] =>
  room.openings
    .filter((op) => op.kind === 'window' || op.kind === 'bay_window')
    .map((op) => buildPaneForOpening(room.room_id, op));
