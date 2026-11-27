import type { Vec3 } from '../../../model/identity';
import type { CardinalFacing, IntVec2 } from '../../../project/structure/contract';
import type {
  InteriorAnchor,
  InteriorDraperyAst,
  InteriorPropAst,
  InteriorSubItemAst,
} from '../../../project/structure/interiorDef';
import type { StructureRoomMeta } from '../contract';
import {
  SUBVOXEL_UNITS_PER_BLOCK,
  type InteriorDraperyKind,
  type InteriorDraperySpec,
  type InteriorDraperyTarget,
  type InteriorOpeningSpan,
  type InteriorPropKind,
  type InteriorPropSpec,
  type MountSurface,
} from './contract';
import { DEFAULT_PROP_SIZE, resolveAnchor, type ZoneFootprint } from './zoneRect';

export const ANCHOR_FACING: Readonly<Record<InteriorAnchor, CardinalFacing>> = {
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

const CUSTOM_PROP_AST_KINDS = new Set(['mount', 'painting', 'chandelier', 'pendant']);

const optFields = <T extends object>(entries: readonly [string, unknown][]): Partial<T> => {
  const out: Record<string, unknown> = {};
  for (const [k, v] of entries) {
    if (v !== undefined) out[k] = v;
  }
  return out as Partial<T>;
};

const anchorPos = (
  room: Pick<StructureRoomMeta, 'from' | 'to'>,
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

/** Resolves authored or kind-default XZ dimensions for an interior prop AST. */
export const resolvePropSize = (ast: InteriorPropAst): IntVec2 =>
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

/** Computes local wall_line placement [at, facing, advance] for a prop at cursor. */
export const wallLineStep = (
  pAst: InteriorPropAst,
  room: Pick<StructureRoomMeta, 'from' | 'to'>,
  anchor: InteriorAnchor,
  cursor: number,
  floorY: number,
): { readonly at: Vec3; readonly facing: CardinalFacing; readonly advance: number } => {
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
  return { at, facing, advance: span };
};

export const placeWallLineProp = (
  pAst: InteriorPropAst,
  room: StructureRoomMeta,
  anchor: InteriorAnchor,
  cursor: number,
  floorY: number,
): { readonly prop: InteriorPropSpec | null; readonly advance: number } => {
  const { at, facing, advance } = wallLineStep(pAst, room, anchor, cursor, floorY);
  return { prop: convertPropAst({ ...pAst, at, facing }, room, anchor, floorY), advance };
};

export const scopeGroupSubItem = (
  sub: InteriorSubItemAst,
  suffix: string,
  propIds: ReadonlySet<string>,
): InteriorSubItemAst => {
  if (sub.item !== 'story') {
    return sub.item === 'alcove'
      ? { item: 'alcove', spec: { ...sub.spec, id: `${sub.spec.id}${suffix}` } }
      : { item: 'prop', spec: { ...sub.spec, id: `${sub.spec.id}${suffix}` } };
  }
  const onT =
    sub.spec.on_target && propIds.has(sub.spec.on_target)
      ? `${sub.spec.on_target}${suffix}`
      : sub.spec.on_target;
  return {
    item: 'story',
    spec: { ...sub.spec, id: `${sub.spec.id}${suffix}`, ...(onT ? { on_target: onT } : {}) },
  };
};

const OPENING_INWARD: Readonly<Record<CardinalFacing, IntVec2>> = {
  north: [0, 1],
  south: [0, -1],
  west: [1, 0],
  east: [-1, 0],
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
    const [dx, dz] = OPENING_INWARD[op.wall];
    const [offX, offZ] = [dx * 9.5, dz * 9.5];
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
