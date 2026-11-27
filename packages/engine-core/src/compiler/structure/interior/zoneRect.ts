import {
  MAX_STRUCTURE_DIM,
  type CardinalFacing,
  type IntVec2,
  type IntVec3,
} from '../../../project/structure/contract';
import {
  SUBVOXEL_UNITS_PER_BLOCK,
  type InteriorOpeningSpan,
  type InteriorPropKind,
  type InteriorPropSpec,
  type InteriorRoomInput,
  type InteriorVolumeSpec,
  type MezzanineVolumeSpec,
  type PartitionVolumeSpec,
  type PlatformVolumeSpec,
  type VolumeAnchor,
} from './contract';

export interface VolumeRect {
  readonly ox: number;
  readonly oz: number;
  readonly w: number;
  readonly d: number;
}

export interface ZoneFootprint {
  readonly x0: number;
  readonly x1: number;
  readonly z0: number;
  readonly z1: number;
}

const WEST = new Set<VolumeAnchor>(['west', 'nw', 'sw']);
const EAST = new Set<VolumeAnchor>(['east', 'ne', 'se']);
const NORTH = new Set<VolumeAnchor>(['north', 'nw', 'ne']);
const SOUTH = new Set<VolumeAnchor>(['south', 'sw', 'se']);

/** Anchors a [w, d] footprint inside inclusive [ix0..ix1, iz0..iz1] interior bounds. */
export const resolveAnchor = (
  anchor: VolumeAnchor,
  ix0: number,
  ix1: number,
  iz0: number,
  iz1: number,
  w: number,
  d: number,
): IntVec2 => {
  const [cx, cz] = [Math.floor((ix0 + ix1 - w + 1) / 2), Math.floor((iz0 + iz1 - d + 1) / 2)];
  return [
    Math.max(ix0, WEST.has(anchor) ? ix0 : EAST.has(anchor) ? ix1 - w + 1 : cx),
    Math.max(iz0, NORTH.has(anchor) ? iz0 : SOUTH.has(anchor) ? iz1 - d + 1 : cz),
  ];
};

const mezSpan = (
  min: number,
  max: number,
  on: CardinalFacing,
  lo: CardinalFacing,
  hi: CardinalFacing,
  depth: number,
): IntVec2 =>
  on === hi
    ? [Math.max(min, max - depth + 1), max]
    : on === lo
      ? [min, Math.min(max, min + depth - 1)]
      : [min, max];

/** Resolves block footprint [ox, oz, w, d] for a platform or sunken volume inside room bounds. */
export const resolvePlatformRect = (
  room: Pick<InteriorRoomInput, 'bounds_from' | 'bounds_to'>,
  spec: PlatformVolumeSpec,
): VolumeRect => {
  const [bf, bt] = [room.bounds_from, room.bounds_to];
  const [w, d] = [
    Math.max(1, Math.min(spec.size[0], bt[0] - bf[0] - 1)),
    Math.max(1, Math.min(spec.size[1], bt[2] - bf[2] - 1)),
  ];
  const [ox, oz] =
    spec.from ??
    resolveAnchor(spec.on ?? 'north', bf[0] + 1, bt[0] - 1, bf[2] + 1, bt[2] - 1, w, d);
  return { ox, oz, w, d };
};

/** Resolves block footprint [ox, oz, w, d] for a mezzanine deck inside room bounds. */
export const resolveMezzanineRect = (
  room: Pick<InteriorRoomInput, 'bounds_from' | 'bounds_to'>,
  spec: MezzanineVolumeSpec,
): VolumeRect => {
  const [bf, bt] = [room.bounds_from, room.bounds_to];
  const [ox0, ox1] = mezSpan(bf[0] + 1, bt[0] - 1, spec.on, 'west', 'east', spec.depth);
  const [oz0, oz1] = mezSpan(bf[2] + 1, bt[2] - 1, spec.on, 'north', 'south', spec.depth);
  return { ox: ox0, oz: oz0, w: ox1 - ox0 + 1, d: oz1 - oz0 + 1 };
};

export const rectToFootprint = (rect: VolumeRect): ZoneFootprint => ({
  x0: rect.ox,
  x1: rect.ox + rect.w - 1,
  z0: rect.oz,
  z1: rect.oz + rect.d - 1,
});

/** Resolves inclusive interior [x0..x1, z0..z1] cell bounds for a zone_id or the full room. */
export const resolveZoneRect = (room: InteriorRoomInput, zoneId?: string): ZoneFootprint => {
  if (zoneId) {
    const vol: InteriorVolumeSpec | undefined = room.volumes.find((v) => v.id === zoneId);
    if (vol?.kind === 'platform' || vol?.kind === 'sunken') {
      return rectToFootprint(resolvePlatformRect(room, vol));
    }
    if (vol?.kind === 'mezzanine') {
      return rectToFootprint(resolveMezzanineRect(room, vol));
    }
  }
  return {
    x0: room.bounds_from[0] + 1,
    x1: room.bounds_to[0] - 1,
    z0: room.bounds_from[2] + 1,
    z1: room.bounds_to[2] - 1,
  };
};

/** Clamps a partition span to the room interior XZ footprint, returning null if empty or out-of-room. */
export const resolvePartitionSpan = (
  room: Pick<InteriorRoomInput, 'bounds_from' | 'bounds_to'>,
  spec: PartitionVolumeSpec,
): readonly [number, number] | null => {
  const ax = spec.axis === 'x';
  const minU = (ax ? room.bounds_from[0] : room.bounds_from[2]) + 1;
  const maxU = (ax ? room.bounds_to[0] : room.bounds_to[2]) - 1;
  const minF = (ax ? room.bounds_from[2] : room.bounds_from[0]) + 1;
  const maxF = (ax ? room.bounds_to[2] : room.bounds_to[0]) - 1;
  if (spec.at_pos < minF || spec.at_pos > maxF) return null;
  const lo = Math.max(minU, spec.span_from);
  const hi = Math.min(maxU, spec.span_to);
  if (lo > hi || hi - lo + 1 > MAX_STRUCTURE_DIM) return null;
  return [lo, hi];
};

/** Resolves partition doorway [doorAt, doorW] shared across geometry, lowering, and solver. */
export const resolvePartitionDoorway = (
  spec: PartitionVolumeSpec,
): { readonly doorAt: number; readonly doorW: number } => ({
  doorAt: spec.doorway_at ?? Math.floor((spec.span_from + spec.span_to) / 2),
  doorW: spec.doorway_width === 0 ? 0 : Math.max(2, spec.doorway_width ?? 2),
});

const CW_FACING: readonly CardinalFacing[] = ['north', 'east', 'south', 'west'];

const diningSeatOffsets = (
  wB: number,
  dB: number,
  seatCount: number,
): readonly [number, number, CardinalFacing][] => {
  const seats: [number, number, CardinalFacing][] = [];
  for (let i = 0; i < wB && seats.length < seatCount; i += 1) {
    seats.push([i, -1, 'south']);
    if (seats.length < seatCount) seats.push([i, dB, 'north']);
  }
  if (seats.length < seatCount) seats.push([-1, 0, 'east']);
  if (seats.length < seatCount) seats.push([wB, 0, 'west']);
  return seats;
};

const rotateChairOffset = (
  lx: number,
  lz: number,
  relFacing: CardinalFacing,
  wB: number,
  dB: number,
  tableFacing: CardinalFacing,
): readonly [number, number, CardinalFacing] => {
  const rotIdx = CW_FACING.indexOf(tableFacing);
  const nextFacing = CW_FACING[(CW_FACING.indexOf(relFacing) + rotIdx) % 4]!;
  if (tableFacing === 'east') return [dB - 1 - lz, lx, nextFacing];
  if (tableFacing === 'south') return [wB - 1 - lx, dB - 1 - lz, nextFacing];
  if (tableFacing === 'west') return [lz, wB - 1 - lx, nextFacing];
  return [lx, lz, nextFacing];
};

/** Snaps a cardinal facing to the nearest 90-deg multiple of deg, returning remainder degrees. */
export const snapRotateFacing = (
  facing: CardinalFacing,
  deg: number,
): { readonly facing: CardinalFacing; readonly remDeg: number } => {
  if (Math.abs(deg) <= 1e-4) return { facing, remDeg: 0 };
  const steps = Math.round(deg / 90);
  const idx = CW_FACING.indexOf(facing);
  return {
    facing: CW_FACING[(((idx + steps) % 4) + 4) % 4]!,
    remDeg: deg - steps * 90,
  };
};

export interface DiningChairPose {
  readonly cx: number;
  readonly cz: number;
  readonly facing: CardinalFacing;
  readonly remDeg: number;
}

/** Computes world XZ centers and orientations for all chairs of a dining_set at [ox, oz]. */
export const diningChairPoses = (
  spec: InteriorPropSpec,
  ox: number = spec.at[0],
  oz: number = spec.at[2],
): readonly DiningChairPose[] => {
  if (spec.kind !== 'dining_set') return [];
  const [wB, dB] = spec.size ?? [2, 1];
  const [rw, rd] = spec.facing === 'east' || spec.facing === 'west' ? [dB, wB] : [wB, dB];
  const count = spec.seat_count ?? Math.max(2, wB * 2);
  const yaw = spec.rotation_deg ?? 0;
  const [px, pz] = [ox + rw / 2, oz + rd / 2];
  return diningSeatOffsets(wB, dB, count).map(([lx, lz, relFacing]) => {
    const [rx, rz, baseFacing] = rotateChairOffset(lx, lz, relFacing, wB, dB, spec.facing);
    const [cx, cz] = rotatePointXZ(ox + rx + 0.5, oz + rz + 0.5, px, pz, yaw);
    const rot = snapRotateFacing(baseFacing, yaw);
    return { cx, cz, facing: rot.facing, remDeg: rot.remDeg };
  });
};

/** Resolves clamped mezzanine deck vertical offset in blocks above the interior floor. */
export const resolveMezzanineYOffset = (
  room: Pick<InteriorRoomInput, 'bounds_from' | 'bounds_to'>,
  requestedYOffsetB?: number,
): number => {
  const [iy0, iy1] = [room.bounds_from[1] + 1, room.bounds_to[1] - 1];
  const fallback = Math.max(3, Math.floor((iy1 - iy0 + 1) * 0.5));
  return Math.max(2, Math.min(iy1 - iy0 - 1, requestedYOffsetB ?? fallback));
};

export interface RotatableBox16 {
  readonly from_16: readonly [number, number, number];
  readonly to_16: readonly [number, number, number];
  readonly pivot_16?: readonly [number, number, number];
  readonly rotation_y_deg?: number;
}

/** Computes world XZ sub-voxel AABB [minX, minZ, maxX, maxZ] after Y-rotation around pivot_16. */
export const rotatedBoxBounds16 = (
  box: RotatableBox16,
): readonly [number, number, number, number] => {
  const [x0, , z0] = box.from_16;
  const [x1, , z1] = box.to_16;
  const rad = ((box.rotation_y_deg ?? 0) * Math.PI) / 180;
  if (!box.pivot_16 || Math.abs(rad) <= 1e-4) return [x0, z0, x1, z1];
  const [px, , pz] = box.pivot_16;
  const [cos, sin] = [Math.cos(rad), Math.sin(rad)];
  let [minX, minZ, maxX, maxZ] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const cx of [x0, x1]) {
    for (const cz of [z0, z1]) {
      const rx = px + (cx - px) * cos - (cz - pz) * sin;
      const rz = pz + (cx - px) * sin + (cz - pz) * cos;
      minX = Math.min(minX, rx);
      minZ = Math.min(minZ, rz);
      maxX = Math.max(maxX, rx);
      maxZ = Math.max(maxZ, rz);
    }
  }
  return [minX, minZ, maxX, maxZ];
};

/** Returns inclusive block cell [bx0, bz0, bx1, bz1] range overlapped by a possibly yawed box. */
export const boxCellRange16 = (box: RotatableBox16): readonly [number, number, number, number] => {
  const u = SUBVOXEL_UNITS_PER_BLOCK;
  const [rx0, rz0, rx1, rz1] = rotatedBoxBounds16(box);
  return [
    Math.floor(rx0 / u),
    Math.floor(rz0 / u),
    Math.floor((rx1 - 0.01) / u),
    Math.floor((rz1 - 0.01) / u),
  ];
};

const rotatePointXZ = (
  x: number,
  z: number,
  px: number,
  pz: number,
  deg: number,
): readonly [number, number] => {
  const rad = (deg * Math.PI) / 180;
  if (Math.abs(rad) <= 1e-4) return [x, z];
  const [cos, sin] = [Math.cos(rad), Math.sin(rad)];
  return [px + (x - px) * cos - (z - pz) * sin, pz + (x - px) * sin + (z - pz) * cos];
};

const propBoxRange = (
  spec: InteriorPropSpec,
  x: number,
  z: number,
): readonly [number, number, number, number] => {
  const [wB, dB] = spec.size ?? [1, 1];
  const [rw, rd] = spec.facing === 'east' || spec.facing === 'west' ? [dB, wB] : [wB, dB];
  const u = SUBVOXEL_UNITS_PER_BLOCK;
  return boxCellRange16({
    from_16: [x * u, 0, z * u],
    to_16: [(x + rw) * u, u, (z + rd) * u],
    pivot_16: [(x + rw / 2) * u, 0, (z + rd / 2) * u],
    rotation_y_deg: spec.rotation_deg ?? 0,
  });
};

/** Checks whether a prop's rotated XZ footprint fits inside bounds without enumerating cells. */
export const propFitsBounds = (
  spec: InteriorPropSpec,
  x: number,
  z: number,
  bounds: ZoneFootprint,
): boolean => {
  const [bx0, bz0, bx1, bz1] = propBoxRange(spec, x, z);
  if (bx0 < bounds.x0 || bx1 > bounds.x1 || bz0 < bounds.z0 || bz1 > bounds.z1) return false;
  return diningChairPoses(spec, x, z).every((pose) => {
    const [cx, cz] = [Math.floor(pose.cx), Math.floor(pose.cz)];
    return cx >= bounds.x0 && cx <= bounds.x1 && cz >= bounds.z0 && cz <= bounds.z1;
  });
};

/** Returns occupied block coordinates for a prop at [x, z], clipped to bounds and compilation caps. */
export const propFootprintCoords = (
  spec: InteriorPropSpec,
  x: number,
  z: number,
  bounds?: ZoneFootprint,
): readonly (readonly [number, number])[] => {
  const [bx0, bz0, bx1, bz1] = propBoxRange(spec, x, z);
  const cx0 = bounds ? Math.max(bx0, bounds.x0) : bx0;
  const cz0 = bounds ? Math.max(bz0, bounds.z0) : bz0;
  const cx1 = bounds ? Math.min(bx1, bounds.x1) : bx1;
  const cz1 = bounds ? Math.min(bz1, bounds.z1) : bz1;
  const spanArea = cx1 >= cx0 && cz1 >= cz0 ? (cx1 - cx0 + 1) * (cz1 - cz0 + 1) : 0;
  if (spanArea === 0 || spanArea > MAX_STRUCTURE_DIM * MAX_STRUCTURE_DIM) return [];
  const out: [number, number][] = [];
  for (let cz = cz0; cz <= cz1; cz += 1) {
    for (let cx = cx0; cx <= cx1; cx += 1) out.push([cx, cz]);
  }
  for (const pose of diningChairPoses(spec, x, z)) {
    out.push([Math.floor(pose.cx), Math.floor(pose.cz)]);
  }
  return out;
};

export const DIRS_4: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

export const TALL_WALL_PROPS = new Set<InteriorPropKind>(
  'shelving,cabinet,fireplace,barrel_rack,display_case'.split(',') as InteriorPropKind[],
);

export const DEFAULT_PROP_SIZE: Readonly<Record<string, IntVec2>> = {
  dining_set: [3, 1],
  low_table: [2, 1],
  sofa: [2, 1],
  sofas: [2, 1],
  counter: [3, 1],
  l_counter: [3, 1],
  console_terminal: [3, 1],
  fireplace: [2, 1],
  shelving: [2, 1],
  barrel_rack: [2, 1],
};

export const cellKey = (x: number, z: number): string => `${x},${z}`;

export const openingInwardCell = (op: InteriorOpeningSpan): IntVec3 => {
  const cx = Math.floor((op.from[0] + op.to[0]) / 2);
  const cz = Math.floor((op.from[2] + op.to[2]) / 2);
  if (op.wall === 'north') return [cx, op.from[1], cz + 1];
  if (op.wall === 'south') return [cx, op.from[1], cz - 1];
  if (op.wall === 'west') return [cx + 1, op.from[1], cz];
  return [cx - 1, op.from[1], cz];
};

export interface CellSpan {
  readonly y0: number;
  readonly y1: number;
}
export type OccupiedMap = Map<string, CellSpan[]>;

export const addOccupied = (map: OccupiedMap, k: string, y0: number, y1: number): void => {
  const list = map.get(k);
  if (list) list.push({ y0, y1 });
  else map.set(k, [{ y0, y1 }]);
};

export const isCellBlockedAt = (map: OccupiedMap, k: string, span: CellSpan): boolean =>
  map.get(k)?.some((s) => s.y0 < span.y1 - 1e-3 && span.y0 < s.y1 - 1e-3) ?? false;

export const propSpanY = (spec: InteriorPropSpec): CellSpan => ({
  y0: spec.at[1],
  y1: spec.at[1] + (TALL_WALL_PROPS.has(spec.kind) ? 1.95 : 1.5),
});

export const collectDoorClearZones = (openings: readonly InteriorOpeningSpan[]): OccupiedMap => {
  const zones: OccupiedMap = new Map();
  for (const op of openings) {
    if (op.kind === 'window' || op.kind === 'bay_window') continue;
    const [ix, , iz] = openingInwardCell(op);
    const [y0, y1] = [op.from[1], op.to[1] + 1];
    addOccupied(zones, cellKey(ix, iz), y0, y1);
    for (const [dx, dz] of DIRS_4) addOccupied(zones, cellKey(ix + dx, iz + dz), y0, y1);
  }
  return zones;
};

export const collectWindowZones = (openings: readonly InteriorOpeningSpan[]): OccupiedMap => {
  const zones: OccupiedMap = new Map();
  for (const o of openings) {
    if (o.kind !== 'window' && o.kind !== 'bay_window') continue;
    const [x, , z] = openingInwardCell(o);
    addOccupied(zones, cellKey(x, z), o.from[1], o.to[1] + 1);
  }
  return zones;
};
