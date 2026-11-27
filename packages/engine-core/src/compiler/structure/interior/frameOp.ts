import type {
  BlockRotation,
  CardinalFacing,
  IntVec2,
  IntVec3,
} from '../../../project/structure/contract';
import type {
  InteriorAnchor,
  InteriorDraperyAst,
  InteriorGroupAst,
  InteriorPropAst,
  InteriorRoomOp,
  InteriorStoryAst,
  InteriorSubItemAst,
  InteriorVolumeAst,
} from '../../../project/structure/interiorDef';
import type { StructureRoomMeta } from '../contract';
import { transformAnchor, transformFacing } from '../frameOps';
import { applyFrame, applyLinear, rotatePt, type FrameTransform } from '../weathering';
import { SUBVOXEL_UNITS_PER_BLOCK } from './contract';
import { resolvePropSize, scopeGroupSubItem, wallLineStep } from './lowerItems';

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

const isIdentityFrame = (f: FrameTransform): boolean =>
  f.rotate === 0 && !f.mirrorX && f.offset[0] === 0 && f.offset[1] === 0 && f.offset[2] === 0;

const xformAxis = (axis: 'x' | 'z', f: FrameTransform): 'x' | 'z' =>
  f.rotate === 90 || f.rotate === 270 ? (axis === 'x' ? 'z' : 'x') : axis;

const isAxisFlipped = (axis: 'x' | 'z', f: FrameTransform): boolean => {
  const [dx, , dz] = applyLinear(axis === 'x' ? [1, 0, 0] : [0, 0, 1], f);
  return dx + dz < 0;
};

const xformRect = (
  [ox, oz]: IntVec2,
  [w, d]: IntVec2,
  f: FrameTransform,
): { readonly from: IntVec2; readonly size: IntVec2 } => {
  const c0 = applyFrame([ox, 0, oz], f);
  const c1 = applyFrame([ox + w - 1, 0, oz + d - 1], f);
  const size: IntVec2 = f.rotate === 90 || f.rotate === 270 ? [d, w] : [w, d];
  return { from: [Math.min(c0[0], c1[0]), Math.min(c0[2], c1[2])], size };
};

const xformPropAt = (
  p: InteriorPropAst,
  baseFacing: CardinalFacing,
  f: FrameTransform,
): InteriorPropAst['at'] => {
  if (!p.at) return undefined;
  const size = resolvePropSize(p);
  const [rw, rd] = baseFacing === 'east' || baseFacing === 'west' ? [size[1], size[0]] : size;
  const { from } = xformRect([Math.round(p.at[0]), Math.round(p.at[2])], [rw, rd], f);
  return [from[0], p.at[1] + f.offset[1], from[1]];
};

const xformPropAst = (
  p: InteriorPropAst,
  f: FrameTransform,
  fallbackOn: InteriorAnchor = 'center',
): InteriorPropAst => {
  const effOn = p.on ?? fallbackOn;
  const baseFacing = p.facing ?? ANCHOR_FACING[effOn];
  const rotateYaw = f.rotate !== 0 || f.mirrorX;
  const needsFacing =
    p.facing !== undefined || (rotateYaw && (p.at !== undefined || effOn === 'center'));
  const nextFacing = needsFacing ? transformFacing(baseFacing, f) : undefined;
  const nextAt = xformPropAt(p, baseFacing, f);
  return {
    ...p,
    ...(p.on ? { on: transformAnchor(p.on, f) } : {}),
    ...(nextFacing ? { facing: nextFacing } : {}),
    ...(nextAt ? { at: nextAt } : {}),
    ...(p.rotation_deg !== undefined && f.mirrorX ? { rotation_deg: -p.rotation_deg } : {}),
  };
};

const OPPOSITE_WALL: Readonly<Record<CardinalFacing, CardinalFacing>> = {
  north: 'south',
  south: 'north',
  east: 'west',
  west: 'east',
};

const xformAlcoveAst = (
  v: Extract<InteriorVolumeAst, { kind: 'alcove' }>,
  f: FrameTransform,
  room: StructureRoomMeta,
  fallbackWall?: CardinalFacing,
): Extract<InteriorVolumeAst, { kind: 'alcove' }> => {
  const wall = v.wall ?? fallbackWall ?? 'north';
  const nextWall = transformFacing(wall, f);
  const localAx = wall === 'north' || wall === 'south' ? 'x' : 'z';
  const span =
    (nextWall === 'north' || nextWall === 'south'
      ? room.to[0] - room.from[0]
      : room.to[2] - room.from[2]) - 1;
  const flipped = v.at_u !== undefined && isAxisFlipped(localAx, f);
  const nextAtU = flipped ? Math.max(0, span - v.at_u! - (v.width_b ?? 2)) : v.at_u;
  return {
    ...v,
    ...(v.wall !== undefined || fallbackWall !== undefined ? { wall: nextWall } : {}),
    ...(nextAtU !== undefined ? { at_u: nextAtU } : {}),
  };
};

const xformPartitionAst = (
  v: Extract<InteriorVolumeAst, { kind: 'partition' }>,
  f: FrameTransform,
): Extract<InteriorVolumeAst, { kind: 'partition' }> => {
  const ax = xformAxis(v.axis, f);
  const pt = applyFrame(v.axis === 'x' ? [0, 0, v.at_pos] : [v.at_pos, 0, 0], f);
  const mapU = (u: number): number => {
    const p = applyFrame(v.axis === 'x' ? [u, 0, 0] : [0, 0, u], f);
    return ax === 'x' ? p[0] : p[2];
  };
  let [s0, s1] = [v.span_from, v.span_to];
  if (s0 !== undefined && s1 !== undefined) {
    const [a, b] = [mapU(s0), mapU(s1)];
    [s0, s1] = [Math.min(a, b), Math.max(a, b)];
  }
  let doorAt = v.doorway_at;
  if (doorAt !== undefined) {
    const dw = Math.max(2, v.doorway_width ?? 2);
    doorAt = Math.min(mapU(doorAt), mapU(doorAt + dw - 1));
  }
  const atPos = v.at_pos > 0 ? (ax === 'x' ? pt[2] : pt[0]) : 0;
  return {
    ...v,
    axis: ax,
    at_pos: atPos,
    ...(s0 !== undefined ? { span_from: s0 } : {}),
    ...(s1 !== undefined ? { span_to: s1 } : {}),
    ...(doorAt !== undefined ? { doorway_at: doorAt } : {}),
  };
};

const xformSubItem = (
  s: InteriorSubItemAst,
  f: FrameTransform,
  room: StructureRoomMeta,
  fallbackOn: InteriorAnchor | undefined = 'center',
): InteriorSubItemAst => {
  if (s.item === 'alcove') {
    const fbWall = fallbackOn ? OPPOSITE_WALL[ANCHOR_FACING[fallbackOn]] : undefined;
    return { item: 'alcove', spec: xformAlcoveAst(s.spec, f, room, fbWall) };
  }
  if (s.item === 'prop') return { item: 'prop', spec: xformPropAst(s.spec, f, fallbackOn) };
  return s.spec.facing
    ? { item: 'story', spec: { ...s.spec, facing: transformFacing(s.spec.facing, f) } }
    : s;
};

const xformZoneVolumeAst = (
  v: Extract<InteriorVolumeAst, { kind: 'platform' | 'sunken' }>,
  f: FrameTransform,
  room: StructureRoomMeta,
): InteriorVolumeAst => {
  const baseSize: IntVec2 = v.size ?? [3, 2];
  const rect = v.from ? xformRect(v.from, baseSize, f) : undefined;
  const swapSize = !rect && (f.rotate === 90 || f.rotate === 270);
  const sizePatch = rect
    ? { from: rect.from, size: rect.size }
    : swapSize
      ? { size: [baseSize[1], baseSize[0]] as IntVec2 }
      : {};
  const fallbackOn = v.on ?? 'north';
  const nextOn = v.on || !v.from ? transformAnchor(fallbackOn, f) : undefined;
  return {
    ...v,
    ...(nextOn ? { on: nextOn } : {}),
    ...sizePatch,
    ...(v.step_facing ? { step_facing: transformFacing(v.step_facing, f) } : {}),
    nested: v.nested.map((n) => xformSubItem(n, f, room, fallbackOn)),
  };
};

const xformVolumeAst = (
  v: InteriorVolumeAst,
  f: FrameTransform,
  room: StructureRoomMeta,
): InteriorVolumeAst => {
  if (v.kind === 'partition') return xformPartitionAst(v, f);
  if (v.kind === 'open_truss') return { ...v, axis: xformAxis(v.axis, f) };
  if (v.kind === 'alcove') return xformAlcoveAst(v, f, room, 'north');
  if (v.kind === 'mezzanine') {
    const st = v.stair_at ? applyFrame([v.stair_at[0], 0, v.stair_at[1]], f) : undefined;
    return {
      ...v,
      on: transformFacing(v.on, f),
      ...(st ? { stair_at: [st[0], st[2]] as IntVec2 } : {}),
      nested: v.nested.map((n) => xformSubItem(n, f, room, v.on)),
    };
  }
  return xformZoneVolumeAst(v, f, room);
};

const xformDraperyAst = (d: InteriorDraperyAst, f: FrameTransform): InteriorDraperyAst => {
  const facing = d.facing ? transformFacing(d.facing, f) : undefined;
  if (!d.from_16 || !d.to_16) return { ...d, ...(facing ? { facing } : {}) };
  const u = SUBVOXEL_UNITS_PER_BLOCK;
  const xform16 = (p: readonly [number, number, number]) => {
    const lp = applyLinear([p[0] / u, p[1] / u, p[2] / u], f);
    return [
      (lp[0] + f.offset[0]) * u,
      (lp[1] + f.offset[1]) * u,
      (lp[2] + f.offset[2]) * u,
    ] as const;
  };
  const [a, b] = [xform16(d.from_16), xform16(d.to_16)];
  return {
    ...d,
    ...(facing ? { facing } : {}),
    from_16: a,
    to_16: b,
  };
};

const xformGroupAst = (
  g: InteriorGroupAst,
  f: FrameTransform,
  room: StructureRoomMeta,
): InteriorGroupAst => {
  const fallbackOn = g.on.length === 1 ? (g.on[0] ?? 'center') : undefined;
  return {
    ...g,
    on: g.on.map((a) => transformAnchor(a, f)),
    items: g.items.map((n) => xformSubItem(n, f, room, fallbackOn)),
  };
};

const unframePt = ([wx, wy, wz]: IntVec3, f: FrameTransform): IntVec3 => {
  const [dx, dy, dz] = [wx - f.offset[0], wy - f.offset[1], wz - f.offset[2]];
  const invRot = ((360 - f.rotate) % 360) as BlockRotation;
  const [rx, ry, rz] = rotatePt([dx, dy, dz], invRot);
  return [f.mirrorX ? -rx : rx, ry, rz];
};

const unframeRoomBounds = (
  room: StructureRoomMeta,
  f: FrameTransform,
): Pick<StructureRoomMeta, 'from' | 'to'> => {
  const a = unframePt(room.from, f);
  const b = unframePt(room.to, f);
  return {
    from: [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.min(a[2], b[2])],
    to: [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.max(a[2], b[2])],
  };
};

interface WallLineOut {
  readonly props: InteriorPropAst[];
  readonly stories: InteriorStoryAst[];
  readonly volumes: InteriorVolumeAst[];
}

const xformWallLineAnchor = (
  g: InteriorGroupAst,
  anchor: InteriorAnchor,
  aIdx: number,
  f: FrameTransform,
  room: StructureRoomMeta,
  localRoom: Pick<StructureRoomMeta, 'from' | 'to'>,
  propIds: ReadonlySet<string>,
  out: WallLineOut,
): void => {
  const suffix = g.on.length > 1 ? `@${anchor}_${aIdx}` : '';
  let cursor = 0;
  for (const rawSub of g.items) {
    const sub = suffix ? scopeGroupSubItem(rawSub, suffix, propIds) : rawSub;
    if (sub.item !== 'prop') {
      const xs = xformSubItem(sub, f, room, anchor);
      if (xs.item === 'story') out.stories.push(xs.spec);
      else if (xs.item === 'alcove') out.volumes.push(xs.spec);
      continue;
    }
    if (sub.spec.at) {
      out.props.push(xformPropAst(sub.spec, f, anchor));
      continue;
    }
    const step = wallLineStep(sub.spec, localRoom, anchor, cursor, localRoom.from[1] + 1);
    cursor += step.advance;
    out.props.push(xformPropAst({ ...sub.spec, at: step.at, facing: step.facing }, f, anchor));
  }
};

const xformWallLineGroups = (
  groups: readonly InteriorGroupAst[],
  f: FrameTransform,
  room: StructureRoomMeta,
): { readonly groups: readonly InteriorGroupAst[] } & WallLineOut => {
  const localRoom = unframeRoomBounds(room, f);
  const out: WallLineOut = { props: [], stories: [], volumes: [] };
  const outGroups: InteriorGroupAst[] = [];
  for (const g of groups) {
    if (g.kind !== 'wall_line') {
      outGroups.push(xformGroupAst(g, f, room));
      continue;
    }
    const propIds = new Set(g.items.filter((i) => i.item === 'prop').map((i) => i.spec.id));
    g.on.forEach((anchor, aIdx) =>
      xformWallLineAnchor(g, anchor, aIdx, f, room, localRoom, propIds, out),
    );
  }
  return { groups: outGroups, ...out };
};

/** Transforms a deferred InteriorRoomOp by its owning prefab placement frame. */
export const transformInteriorOpByFrame = (
  op: InteriorRoomOp,
  f: FrameTransform,
  room: StructureRoomMeta,
): InteriorRoomOp => {
  if (isIdentityFrame(f)) return op;
  const sun = op.sunShaft;
  const sunDir = sun?.sun_dir
    ? (() => {
        const [lx, , lz] = applyLinear([sun.sun_dir[0], 0, sun.sun_dir[2]], f);
        return [lx, sun.sun_dir[1], lz] as const;
      })()
    : undefined;
  const wl = xformWallLineGroups(op.groups, f, room);
  return {
    ...op,
    volumes: [...op.volumes.map((v) => xformVolumeAst(v, f, room)), ...wl.volumes],
    groups: wl.groups,
    props: [...op.props.map((p) => xformPropAst(p, f)), ...wl.props],
    draperies: op.draperies.map((d) => xformDraperyAst(d, f)),
    stories: [
      ...op.stories.map((s) => (s.facing ? { ...s, facing: transformFacing(s.facing, f) } : s)),
      ...wl.stories,
    ],
    ...(sun ? { sunShaft: { ...sun, ...(sunDir ? { sun_dir: sunDir } : {}) } } : {}),
  };
};
