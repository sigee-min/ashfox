import type { CardinalFacing, IntVec2 } from '../../../project/structure/contract';
import type {
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
