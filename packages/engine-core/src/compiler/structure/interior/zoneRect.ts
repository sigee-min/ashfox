import type { CardinalFacing, IntVec2 } from '../../../project/structure/contract';
import type {
  InteriorPropSpec,
  InteriorRoomInput,
  InteriorVolumeSpec,
  MezzanineVolumeSpec,
  PartitionVolumeSpec,
  PlatformVolumeSpec,
  VolumeAnchor,
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

/** Resolves partition doorway [doorAt, doorW] shared across geometry, lowering, and solver. */
export const resolvePartitionDoorway = (
  spec: PartitionVolumeSpec,
): { readonly doorAt: number; readonly doorW: number } => ({
  doorAt: spec.doorway_at ?? Math.floor((spec.span_from + spec.span_to) / 2),
  doorW: spec.doorway_width === 0 ? 0 : Math.max(2, spec.doorway_width ?? 2),
});

const CW_FACING: readonly CardinalFacing[] = ['north', 'east', 'south', 'west'];

/** Computes unrotated chair cell offsets and facing around a dining table footprint. */
export const diningSeatOffsets = (
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

/** Rotates a local dining chair cell offset and facing into world-facing orientation. */
export const rotateChairOffset = (
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

/** Returns rotated [dx, dz] cell offsets of generated dining chairs relative to table origin. */
export const diningChairCellOffsets = (
  spec: InteriorPropSpec,
): readonly (readonly [number, number])[] => {
  if (spec.kind !== 'dining_set') return [];
  const [wB, dB] = spec.size ?? [2, 1];
  const count = spec.seat_count ?? Math.max(2, wB * 2);
  return diningSeatOffsets(wB, dB, count).map(([lx, lz, relFacing]) => {
    const [rx, rz] = rotateChairOffset(lx, lz, relFacing, wB, dB, spec.facing);
    return [rx, rz] as const;
  });
};
