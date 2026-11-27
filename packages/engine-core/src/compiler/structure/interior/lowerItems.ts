import type { CardinalFacing, IntVec2 } from '../../../project/structure/contract';
import type {
  InteriorAnchor,
  InteriorGroupAst,
  InteriorStoryAst,
  InteriorSubItemAst,
  InteriorVolumeAst,
} from '../../../project/structure/interiorDef';
import type { StructureRoomMeta } from '../contract';
import {
  SUBVOXEL_UNITS_PER_BLOCK,
  type AlcoveKind,
  type InteriorArchitectureSpec,
  type InteriorPropSpec,
  type InteriorVolumeSpec,
  type PartitionStyle,
  type RailingStyle,
  type TrussStyle,
} from './contract';
import {
  ANCHOR_FACING,
  convertPropAst,
  expandDraperyForRoom,
  placeWallLineProp,
  resolvePropSize,
  scopeGroupSubItem,
  wallLineStep,
} from './lowerProps';
import {
  rectToFootprint,
  resolveMezzanineRect,
  resolveMezzanineYOffset,
  resolvePlatformRect,
  type ZoneFootprint,
} from './zoneRect';

export { convertPropAst, expandDraperyForRoom, resolvePropSize, scopeGroupSubItem, wallLineStep };

const OPPOSITE_WALL: Readonly<Record<CardinalFacing, CardinalFacing>> = {
  north: 'south',
  south: 'north',
  east: 'west',
  west: 'east',
};

const convertAlcoveAst = (
  v: Extract<InteriorVolumeAst, { kind: 'alcove' }>,
  room: StructureRoomMeta,
  fallbackWall: CardinalFacing,
): Extract<InteriorVolumeSpec, { kind: 'alcove' }> => {
  const wall = v.wall ?? fallbackWall;
  const span =
    wall === 'north' || wall === 'south'
      ? room.to[0] - room.from[0] - 1
      : room.to[2] - room.from[2] - 1;
  const width = Math.min(span, v.width_b ?? 2);
  return {
    kind: 'alcove',
    id: v.id,
    alcove_kind: v.alcove_kind as AlcoveKind,
    wall,
    at_u: v.at_u ?? Math.max(0, Math.floor((span - width) / 2)),
    width_b: width,
    height_b: Math.min(room.to[1] - room.from[1] - 1, v.height_b ?? 3),
    ...(v.depth_16 !== undefined ? { depth_16: v.depth_16 } : {}),
    ...(v.y_offset_16 !== undefined ? { y_offset_16: v.y_offset_16 } : {}),
  };
};

const lowerNestedItems = (
  items: readonly InteriorSubItemAst[],
  room: StructureRoomMeta,
  on: InteriorAnchor,
  yB: number,
  zoneId: string | undefined,
  volumes: InteriorVolumeSpec[],
  props: InteriorPropSpec[],
  stories: InteriorStoryAst[],
  zone?: ZoneFootprint,
): void => {
  const fallbackWall = OPPOSITE_WALL[ANCHOR_FACING[on]];
  for (const sub of items) {
    if (sub.item === 'alcove') volumes.push(convertAlcoveAst(sub.spec, room, fallbackWall));
    else if (sub.item === 'story') stories.push(sub.spec);
    else {
      const converted = convertPropAst(sub.spec, room, on, yB, zoneId, zone);
      if (converted) props.push(converted);
    }
  }
};

const lowerPlatformVolume = (
  v: Extract<InteriorVolumeAst, { kind: 'platform' | 'sunken' }>,
  room: StructureRoomMeta,
  volumes: InteriorVolumeSpec[],
  props: InteriorPropSpec[],
  stories: InteriorStoryAst[],
): void => {
  const size: IntVec2 = v.size ?? [3, 2];
  const yB = room.from[1] + 1 + v.height_16 / SUBVOXEL_UNITS_PER_BLOCK;
  const volSpec: Extract<InteriorVolumeSpec, { kind: 'platform' | 'sunken' }> = {
    kind: v.kind,
    id: v.id,
    ...(v.on ? { on: v.on } : {}),
    ...(v.from ? { from: v.from } : {}),
    size,
    height_16: v.height_16,
    ...(v.step_facing ? { step_facing: v.step_facing } : {}),
    ...(v.floor_pattern
      ? {
          floor_pattern: v.floor_pattern as InteriorArchitectureSpec['floor_pattern'],
        }
      : {}),
    ...(v.trim_tile ? { trim_tile: v.trim_tile } : {}),
    ...(v.railing ? { railing: v.railing as RailingStyle } : {}),
  };
  volumes.push(volSpec);
  const zone = rectToFootprint(
    resolvePlatformRect({ bounds_from: room.from, bounds_to: room.to }, volSpec),
  );
  lowerNestedItems(v.nested, room, v.on ?? 'north', yB, v.id, volumes, props, stories, zone);
};

const lowerMezzanineVolume = (
  v: Extract<InteriorVolumeAst, { kind: 'mezzanine' }>,
  room: StructureRoomMeta,
  volumes: InteriorVolumeSpec[],
  props: InteriorPropSpec[],
  stories: InteriorStoryAst[],
): void => {
  const yOff = resolveMezzanineYOffset(
    { bounds_from: room.from, bounds_to: room.to },
    v.y_offset_b,
  );
  const mezSpec: Extract<InteriorVolumeSpec, { kind: 'mezzanine' }> = {
    kind: 'mezzanine',
    id: v.id,
    on: v.on,
    depth: v.depth,
    y_offset_b: yOff,
    railing: v.railing as RailingStyle,
    ...(v.stair_at ? { stair_at: v.stair_at } : {}),
    ...(v.support_pillars !== undefined ? { support_pillars: v.support_pillars } : {}),
  };
  volumes.push(mezSpec);
  const zone = rectToFootprint(
    resolveMezzanineRect({ bounds_from: room.from, bounds_to: room.to }, mezSpec),
  );
  lowerNestedItems(
    v.nested,
    room,
    v.on,
    room.from[1] + 1 + yOff,
    v.id,
    volumes,
    props,
    stories,
    zone,
  );
};

const lowerPartitionVolume = (
  v: Extract<InteriorVolumeAst, { kind: 'partition' }>,
  room: StructureRoomMeta,
): Extract<InteriorVolumeSpec, { kind: 'partition' }> => {
  const ax = v.axis === 'x';
  const spanFrom = v.span_from ?? (ax ? room.from[0] + 1 : room.from[2] + 1);
  const spanTo = v.span_to ?? (ax ? room.to[0] - 1 : room.to[2] - 1);
  const mid = Math.floor((ax ? room.from[2] + room.to[2] : room.from[0] + room.to[0]) / 2);
  return {
    kind: 'partition',
    id: v.id,
    style: v.style as PartitionStyle,
    axis: v.axis,
    at_pos: v.at_pos > 0 ? v.at_pos : mid,
    span_from: spanFrom,
    span_to: spanTo,
    ...(v.doorway_at !== undefined ? { doorway_at: v.doorway_at } : {}),
    ...(v.doorway_width !== undefined ? { doorway_width: v.doorway_width } : {}),
    ...(v.open_ratio !== undefined ? { open_ratio: v.open_ratio } : {}),
  };
};

export const lowerVolumeAst = (
  v: InteriorVolumeAst,
  room: StructureRoomMeta,
  volumes: InteriorVolumeSpec[],
  props: InteriorPropSpec[],
  stories: InteriorStoryAst[],
): void => {
  if (v.kind === 'platform' || v.kind === 'sunken') {
    lowerPlatformVolume(v, room, volumes, props, stories);
  } else if (v.kind === 'mezzanine') {
    lowerMezzanineVolume(v, room, volumes, props, stories);
  } else if (v.kind === 'open_truss') {
    volumes.push({
      kind: 'open_truss',
      id: v.id,
      style: v.style as TrussStyle,
      axis: v.axis,
      ...(v.bay_spacing_b !== undefined ? { bay_spacing_b: v.bay_spacing_b } : {}),
      ...(v.ridge_height_16 !== undefined ? { ridge_height_16: v.ridge_height_16 } : {}),
      ...(v.chord_thickness_16 !== undefined ? { chord_thickness_16: v.chord_thickness_16 } : {}),
    });
  } else if (v.kind === 'alcove') {
    volumes.push(convertAlcoveAst(v, room, 'north'));
  } else if (v.kind === 'partition') {
    volumes.push(lowerPartitionVolume(v, room));
  }
};

const lowerAnchoredGroupItem = (
  sub: InteriorSubItemAst,
  groupKind: InteriorGroupAst['kind'],
  room: StructureRoomMeta,
  anchor: InteriorAnchor,
  floorY: number,
  cursor: number,
  volumes: InteriorVolumeSpec[],
  props: InteriorPropSpec[],
  stories: InteriorStoryAst[],
): number => {
  if (sub.item !== 'prop') {
    lowerNestedItems([sub], room, anchor, floorY, undefined, volumes, props, stories);
    return 0;
  }
  if (groupKind === 'wall_line' && !sub.spec.at) {
    const res = placeWallLineProp(sub.spec, room, anchor, cursor, floorY);
    if (res.prop) props.push(res.prop);
    return res.advance;
  }
  const conv = convertPropAst(sub.spec, room, anchor, floorY);
  if (conv) props.push(conv);
  return 0;
};

export const lowerGroupProps = (
  group: InteriorGroupAst,
  room: StructureRoomMeta,
  volumes: InteriorVolumeSpec[],
  props: InteriorPropSpec[],
  stories: InteriorStoryAst[],
): void => {
  const floorY = room.from[1] + 1;
  const propIds = new Set(group.items.filter((i) => i.item === 'prop').map((i) => i.spec.id));
  group.on.forEach((anchor, aIdx) => {
    const suffix = group.on.length > 1 ? `@${anchor}_${aIdx}` : '';
    let cursor = 0;
    for (const sub of group.items) {
      const scoped = suffix ? scopeGroupSubItem(sub, suffix, propIds) : sub;
      cursor += lowerAnchoredGroupItem(
        scoped,
        group.kind,
        room,
        anchor,
        floorY,
        cursor,
        volumes,
        props,
        stories,
      );
    }
  });
};
