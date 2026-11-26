import type { Vec3 } from '../../../model/identity';
import type { CardinalFacing, IntVec2 } from '../../../project/structure/contract';
import type {
  InteriorAnchor,
  InteriorDraperyAst,
  InteriorGroupAst,
  InteriorPropAst,
  InteriorStoryAst,
  InteriorSubItemAst,
  InteriorVolumeAst,
} from '../../../project/structure/interiorDef';
import type { StructureRoomMeta } from '../contract';
import {
  SUBVOXEL_UNITS_PER_BLOCK,
  type AlcoveKind,
  type InteriorArchitectureSpec,
  type InteriorDraperyKind,
  type InteriorDraperySpec,
  type InteriorDraperyTarget,
  type InteriorOpeningSpan,
  type InteriorPropKind,
  type InteriorPropSpec,
  type InteriorVolumeSpec,
  type MountSurface,
  type PartitionStyle,
  type RailingStyle,
  type TrussStyle,
} from './contract';
import {
  rectToFootprint,
  resolveAnchor,
  resolveMezzanineRect,
  resolveMezzanineYOffset,
  resolvePlatformRect,
  type ZoneFootprint,
} from './zoneRect';

const DEFAULT_PROP_SIZE: Readonly<Record<string, IntVec2>> = {
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

const ANCHOR_FACING: Readonly<Record<InteriorAnchor, CardinalFacing>> = {
  north: 'south',
  nw: 'south',
  ne: 'south',
  south: 'north',
  sw: 'north',
  se: 'north',
  west: 'east',
  east: 'west',
  center: 'south',
};

const OPPOSITE_WALL: Readonly<Record<CardinalFacing, CardinalFacing>> = {
  north: 'south',
  south: 'north',
  east: 'west',
  west: 'east',
};

const CUSTOM_PROP_AST_KINDS = new Set(['mount', 'painting', 'chandelier', 'pendant']);

const optFields = <T extends object>(entries: readonly [string, unknown][]): Partial<T> => {
  const out: Record<string, unknown> = {};
  for (const [k, v] of entries) {
    if (v !== undefined) out[k] = v;
  }
  return out as Partial<T>;
};

const anchorPos = (
  room: StructureRoomMeta,
  on: InteriorAnchor,
  size: IntVec2 = [1, 1],
  yB = room.from[1] + 1,
  zone?: ZoneFootprint,
): Vec3 => {
  const x0 = zone ? zone.x0 : room.from[0] + 1;
  const x1 = zone ? zone.x1 : room.to[0] - 1;
  const z0 = zone ? zone.z0 : room.from[2] + 1;
  const z1 = zone ? zone.z1 : room.to[2] - 1;
  const [x, z] = resolveAnchor(on, x0, x1, z0, z1, size[0], size[1]);
  return [x, yB, z];
};

const inferMountSurface = (ast: InteriorPropAst): MountSurface => {
  if (ast.mount_on) return ast.mount_on as MountSurface;
  if (ast.kind === 'chandelier' || ast.kind === 'pendant') return 'ceiling';
  if (ast.kind === 'wall_shelf' || ast.kind === 'painting' || ast.kind === 'holo_screen')
    return 'wall';
  return 'floor';
};

const resolvePropSize = (ast: InteriorPropAst): IntVec2 =>
  ast.size ?? (ast.length ? [ast.length, 1] : (DEFAULT_PROP_SIZE[ast.kind] ?? [1, 1]));

const facingSize = (size: IntVec2, facing: CardinalFacing): IntVec2 =>
  facing === 'east' || facing === 'west' ? [size[1], size[0]] : size;

export const convertPropAst = (
  ast: InteriorPropAst,
  room: StructureRoomMeta,
  onFallback: InteriorAnchor,
  yB: number,
  zoneId?: string,
  zone?: ZoneFootprint,
): InteriorPropSpec | null => {
  if (ast.kind === 'rug') return null;
  if ((ast.kind === 'chandelier' || ast.kind === 'pendant') && !ast.asset_alias) return null;
  const kind: InteriorPropKind = CUSTOM_PROP_AST_KINDS.has(ast.kind)
    ? 'custom_prop'
    : (ast.kind as InteriorPropKind);
  const size = resolvePropSize(ast);
  const on = ast.on ?? onFallback;
  const facing = ast.facing ?? ANCHOR_FACING[on];
  const mountOn = inferMountSurface(ast);
  const floorY = mountOn === 'ceiling' ? room.to[1] - (ast.drop ?? 1.5) : yB;
  return {
    id: ast.id,
    kind,
    at: ast.at ?? anchorPos(room, on, facingSize(size, facing), floorY, zone),
    size,
    facing,
    mount_on: mountOn,
    ...optFields<InteriorPropSpec>([
      ['zone_id', zoneId],
      ['style_override', ast.style_override],
      ['seat_count', ast.seat_count],
      ['auto_join', ast.auto_join],
      ['rotation_deg', ast.rotation_deg],
      ['organic_jitter', ast.organic_jitter],
      ['asset_alias', ast.asset_alias],
    ]),
  };
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

const placeWallLineProp = (
  pAst: InteriorPropAst,
  room: StructureRoomMeta,
  anchor: InteriorAnchor,
  cursor: number,
  floorY: number,
): { readonly prop: InteriorPropSpec | null; readonly advance: number } => {
  const size = resolvePropSize(pAst);
  const facing = pAst.facing ?? ANCHOR_FACING[anchor];
  const [rw, rd] = facingSize(size, facing);
  const alongX = anchor === 'north' || anchor === 'south' || anchor === 'center';
  const span = alongX ? rw : rd;
  const base = anchorPos(room, anchor, [rw, rd], floorY);
  const maxU = (alongX ? room.to[0] : room.to[2]) - span;
  const at: Vec3 = alongX
    ? [Math.min(maxU, room.from[0] + 1 + cursor), floorY, base[2]]
    : [base[0], floorY, Math.min(maxU, room.from[2] + 1 + cursor)];
  return {
    prop: convertPropAst({ ...pAst, at, facing }, room, anchor, floorY),
    advance: span,
  };
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
  for (const anchor of group.on) {
    let cursor = 0;
    for (const sub of group.items) {
      cursor += lowerAnchoredGroupItem(
        sub,
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
  }
};

const OPENING_INWARD_X: Readonly<Record<CardinalFacing, number>> = {
  north: 0,
  south: 0,
  west: 1,
  east: -1,
};
const OPENING_INWARD_Z: Readonly<Record<CardinalFacing, number>> = {
  north: 1,
  south: -1,
  west: 0,
  east: 0,
};

const expandOpeningDrapery = (
  d: InteriorDraperyAst,
  openings: readonly InteriorOpeningSpan[],
): readonly InteriorDraperySpec[] => {
  const u = SUBVOXEL_UNITS_PER_BLOCK;
  const wantWindow = d.on_target === 'windows';
  const matches = openings.filter((o) =>
    wantWindow
      ? o.kind === 'window' || o.kind === 'bay_window'
      : o.kind === 'door' || o.kind === 'arch',
  );
  return matches.map((op, i) => {
    const offX = OPENING_INWARD_X[op.wall] * 9.5;
    const offZ = OPENING_INWARD_Z[op.wall] * 9.5;
    return {
      id: `${d.id}_${i}`,
      kind: d.kind as InteriorDraperyKind,
      on_target: d.on_target as InteriorDraperyTarget,
      from_16: [op.from[0] * u + offX, (op.to[1] + 1) * u, op.from[2] * u + offZ],
      to_16: [(op.to[0] + 1) * u + offX, op.from[1] * u, (op.to[2] + 1) * u + offZ],
      facing: op.wall,
      sag_16: d.sag_16 ?? 4,
      ...(d.pleats !== undefined ? { pleats: d.pleats } : {}),
      tieback: d.tieback ?? d.kind === 'curtains',
      ...(d.split_panels !== undefined ? { split_panels: d.split_panels } : {}),
      ...(d.color ? { color: d.color } : {}),
      ...(d.tile_id ? { tile_id: d.tile_id } : {}),
    };
  });
};

const buildDraperyOpt = (d: InteriorDraperyAst): Partial<InteriorDraperySpec> =>
  optFields<InteriorDraperySpec>([
    ['facing', d.facing],
    ['pleats', d.pleats],
    ['tieback', d.tieback],
    ['split_panels', d.split_panels],
    ['color', d.color],
    ['tile_id', d.tile_id],
  ]);

export const expandDraperyForRoom = (
  d: InteriorDraperyAst,
  room: StructureRoomMeta,
  openings: readonly InteriorOpeningSpan[],
): readonly InteriorDraperySpec[] => {
  const u = SUBVOXEL_UNITS_PER_BLOCK;
  const opt = buildDraperyOpt(d);
  if (d.from_16 && d.to_16) {
    return [
      {
        id: d.id,
        kind: d.kind as InteriorDraperyKind,
        on_target: d.on_target as InteriorDraperyTarget,
        from_16: d.from_16,
        to_16: d.to_16,
        sag_16: d.sag_16 ?? 4,
        ...opt,
      },
    ];
  }
  if (d.on_target === 'windows' || d.on_target === 'doors')
    return expandOpeningDrapery(d, openings);
  const cy16 = room.to[1] * u - 4;
  const midZ16 = ((room.from[2] + room.to[2] + 1) * u) / 2;
  return [
    {
      id: d.id,
      kind: d.kind as InteriorDraperyKind,
      on_target: d.on_target as InteriorDraperyTarget,
      from_16: [(room.from[0] + 1) * u + 8, cy16, midZ16],
      to_16: [room.to[0] * u - 8, cy16, midZ16],
      sag_16: d.sag_16 ?? 6,
      ...opt,
    },
  ];
};
