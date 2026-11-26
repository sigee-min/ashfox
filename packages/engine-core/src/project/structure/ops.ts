import type {
  CardinalFacing,
  Cursor,
  FacadeOpeningSpec,
  FurnishItem,
  MirrorAxis,
  OpeningPlacement,
  PorchSpec,
  RepeatAxis,
  RoomKind,
  SocketKind,
  StairStyle,
  StructureOp,
} from './contract';
import { parseExprVec2, parseScalarExpr } from './expr';
import {
  asFacing,
  asInt,
  asIntVec2,
  asOptFacing,
  asOptStr,
  asRotate,
  asScalar,
  asStr,
  asVec2,
  asVec3,
  assertAllowedAttrs,
  failSyntax,
  parseFloorJetty,
  parseRoofOp,
  parseWeatheringOp,
  peek,
  pickOptStrs,
  readAttrsUntil,
  readCharKey,
  readName,
  readQualified,
  readString,
  take,
} from './grammar';

const ROOM_KINDS = new Set([
  'living',
  'workshop',
  'bedroom',
  'tavern',
  'tower',
  'hallway',
  'courtyard',
]);
const STAIR_STYLES = new Set(['straight', 'l_turn', 'u_turn', 'spiral']);
const SOCKET_KINDS = new Set(['entry', 'road', 'wall_join', 'courtyard']);
const ANCHOR_POS = new Set(['north', 'south', 'east', 'west', 'nw', 'ne', 'sw', 'se', 'center']);

const parseSimpleOp = (cursor: Cursor, op: string): StructureOp => {
  const attrs = readAttrsUntil(cursor, [';']);
  take(cursor, ';');
  if (op === 'set') {
    assertAllowedAttrs(cursor, attrs, new Set(['at', 'block', 'facing']));
    return {
      op: 'set',
      at: asVec3(cursor, attrs.at, 'at'),
      block: asStr(cursor, attrs.block, 'block'),
      facing: asOptFacing(cursor, attrs.facing),
    };
  }
  if (op === 'carve') {
    assertAllowedAttrs(cursor, attrs, new Set(['from', 'to']));
    return {
      op: 'carve',
      from: asVec3(cursor, attrs.from, 'from'),
      to: asVec3(cursor, attrs.to, 'to'),
    };
  }
  assertAllowedAttrs(cursor, attrs, new Set(['from', 'to', 'block']));
  return {
    op: op as 'box' | 'hollow' | 'walls' | 'frame',
    from: asVec3(cursor, attrs.from, 'from'),
    to: asVec3(cursor, attrs.to, 'to'),
    block: asStr(cursor, attrs.block, 'block'),
  };
};

const parsePlaceOp = (cursor: Cursor): StructureOp => {
  const prefab = readQualified(cursor);
  const attrs = readAttrsUntil(cursor, [';']);
  take(cursor, ';');
  assertAllowedAttrs(cursor, attrs, new Set(['at', 'rotate']));
  return {
    op: 'place',
    prefab,
    at: asVec3(cursor, attrs.at, 'at'),
    rotate: asRotate(cursor, attrs.rotate),
  };
};

const parseLayerOp = (cursor: Cursor): StructureOp => {
  let y: string | number = 0;
  let origin: readonly [string | number, string | number] = [0, 0];
  while (peek(cursor).value !== '{') {
    const key = readName(cursor);
    take(cursor, '=');
    if (key === 'y') y = parseScalarExpr(cursor);
    else if (key === 'origin') origin = parseExprVec2(cursor);
    else failSyntax(cursor, 'y or origin');
  }
  take(cursor, '{');
  const rows: string[] = [];
  while (peek(cursor).value !== '}') rows.push(readString(cursor));
  take(cursor, '}');
  take(cursor, 'map');
  take(cursor, '{');
  const map: Record<string, string> = {};
  while (peek(cursor).value !== '}') {
    const ch = readCharKey(cursor);
    take(cursor, '=');
    map[ch] = readName(cursor);
    take(cursor, ';');
  }
  take(cursor, '}');
  take(cursor, ';');
  return { op: 'layer', y, origin, rows, map };
};

const parseRoomOp = (cursor: Cursor): StructureOp => {
  const name = readName(cursor);
  const attrs = readAttrsUntil(cursor, [';']);
  take(cursor, ';');
  assertAllowedAttrs(
    cursor,
    attrs,
    new Set(['from', 'size', 'kind', 'shape', 'plinth', 'floor', 'wall', 'frame', 'ceiling']),
  );
  const kind = asStr(cursor, attrs.kind, 'kind');
  if (!ROOM_KINDS.has(kind)) failSyntax(cursor, 'valid room kind');
  const shape = asOptStr(cursor, attrs.shape, 'shape');
  if (shape !== undefined && shape !== 'rect' && shape !== 'octagon')
    failSyntax(cursor, 'shape = rect|octagon');
  return {
    op: 'room',
    name,
    from: asVec2(cursor, attrs.from, 'from'),
    size: asVec2(cursor, attrs.size, 'size'),
    kind: kind as RoomKind,
    ...(shape ? { shape: shape as 'rect' | 'octagon' } : {}),
    ...pickOptStrs(cursor, attrs, [
      ['plinth', 'plinth'],
      ['floor', 'floor'],
      ['wall', 'wall'],
      ['frame', 'frame'],
      ['ceiling', 'ceiling'],
    ]),
  };
};

const parsePorchBlock = (cursor: Cursor): PorchSpec => {
  take(cursor, '{');
  const props: Record<string, unknown> = {};
  while (peek(cursor).value !== '}') {
    const key = readName(cursor);
    if (key in props) failSyntax(cursor, `unique porch field ${key}`);
    take(cursor, '=');
    props[key] =
      key === 'depth' ? asInt(cursor, parseScalarExpr(cursor), 'depth') : readQualified(cursor);
    take(cursor, ';');
  }
  take(cursor, '}');
  if (peek(cursor).value === ';') take(cursor, ';');
  assertAllowedAttrs(cursor, props, new Set(['depth', 'floor', 'pillars', 'lamps', 'steps']));
  const depth = asInt(cursor, props.depth ?? 2, 'depth');
  if (depth < 1 || depth > 6) failSyntax(cursor, 'porch depth 1..6');
  return {
    depth,
    floor: asStr(cursor, props.floor, 'floor'),
    ...pickOptStrs(cursor, props, [
      ['pillars', 'pillars'],
      ['lamps', 'lamps'],
      ['steps', 'steps'],
    ]),
  };
};

const readOpeningPlacement = (cursor: Cursor, attrs: Record<string, unknown>): OpeningPlacement => {
  if (attrs.at !== undefined) {
    const at = attrs.at === 'center' ? 'center' : asInt(cursor, attrs.at, 'at');
    return {
      mode: 'at',
      at,
      ...(attrs.offset !== undefined ? { offset: asInt(cursor, attrs.offset, 'offset') } : {}),
    };
  }
  if (attrs.repeat !== undefined) {
    const count = asInt(cursor, attrs.repeat, 'repeat');
    const margin = attrs.margin === undefined ? 1 : asInt(cursor, attrs.margin, 'margin');
    if (count < 1 || margin < 0) failSyntax(cursor, 'repeat >= 1 and margin >= 0');
    return { mode: 'repeat', count, margin };
  }
  if (attrs.symmetric !== undefined)
    return { mode: 'symmetric', offset: asInt(cursor, attrs.symmetric, 'symmetric') };
  return failSyntax(cursor, 'at, repeat, or symmetric placement');
};

const OPENING_KEYS = new Set([
  'at',
  'offset',
  'repeat',
  'margin',
  'symmetric',
  'width',
  'height',
  'y_offset',
  'block',
  'glass',
  'frame',
  'recess',
  'sill',
  'shutter',
  'lintel',
  'hinge',
]);

type OpeningKind = FacadeOpeningSpec['kind'];
const OPENING_KINDS = new Set<string>(['door', 'window', 'arch', 'bay_window', 'arcade']);

const defaultOpeningSize = (kind: OpeningKind): readonly [number, number] => {
  if (kind === 'bay_window') return [3, 2];
  if (kind === 'arch' || kind === 'arcade') return [2, 3];
  return [1, 2];
};

const parseOpening = (cursor: Cursor, kind: OpeningKind): FacadeOpeningSpec => {
  const attrs = readAttrsUntil(cursor, [';', 'porch']);
  let porch: PorchSpec | undefined;
  if (peek(cursor).value === 'porch') {
    take(cursor, 'porch');
    porch = parsePorchBlock(cursor);
  } else take(cursor, ';');
  assertAllowedAttrs(cursor, attrs, OPENING_KEYS);
  const [defW, defH] = defaultOpeningSize(kind);
  const width = asInt(cursor, attrs.width ?? defW, 'width');
  const height = asInt(cursor, attrs.height ?? defH, 'height');
  if (
    width < 1 ||
    height < 1 ||
    ((kind === 'door' || kind === 'arcade') && height < 2) ||
    (kind === 'bay_window' && width < 3)
  )
    failSyntax(cursor, 'valid opening width/height');
  const hinge = asOptStr(cursor, attrs.hinge, 'hinge');
  if (hinge !== undefined && hinge !== 'left' && hinge !== 'right')
    failSyntax(cursor, 'hinge = left|right');
  return {
    kind,
    placement: readOpeningPlacement(cursor, attrs),
    width,
    height,
    ...(attrs.y_offset !== undefined ? { yOffset: asInt(cursor, attrs.y_offset, 'y_offset') } : {}),
    ...(attrs.recess !== undefined ? { recess: asInt(cursor, attrs.recess, 'recess') } : {}),
    ...pickOptStrs(cursor, attrs, [
      ['block', 'block'],
      ['glass', 'glass'],
      ['frame', 'frame'],
      ['sill', 'sill'],
      ['shutter', 'shutter'],
      ['lintel', 'lintel'],
    ]),
    ...(hinge !== undefined ? { hinge: hinge as 'left' | 'right' } : {}),
    ...(porch !== undefined ? { porch } : {}),
  };
};

const parseFacadeOp = (cursor: Cursor): StructureOp => {
  take(cursor, 'on');
  const targets: { readonly room: string; readonly wall: CardinalFacing }[] = [];
  do {
    if (targets.length > 0) take(cursor, ',');
    const room = readName(cursor);
    take(cursor, '.');
    targets.push({ room, wall: asFacing(cursor, readName(cursor)) });
  } while (peek(cursor).value === ',');
  take(cursor, '{');
  const openings: FacadeOpeningSpec[] = [];
  while (peek(cursor).value !== '}') {
    const kind = readName(cursor);
    if (!OPENING_KINDS.has(kind)) failSyntax(cursor, 'door, window, arch, bay_window, or arcade');
    else openings.push(parseOpening(cursor, kind as OpeningKind));
  }
  take(cursor, '}');
  return { op: 'facade', targets, openings };
};

const STAIR_KEYS = new Set([
  'in_room',
  'style',
  'at',
  'y_from',
  'y_to',
  'facing',
  'width',
  'stair',
  'landing',
  'rail',
  'headroom',
]);

const parseStaircaseOp = (cursor: Cursor): StructureOp => {
  const attrs = readAttrsUntil(cursor, [';']);
  take(cursor, ';');
  assertAllowedAttrs(cursor, attrs, STAIR_KEYS);
  const style = asStr(cursor, attrs.style, 'style');
  if (!STAIR_STYLES.has(style)) failSyntax(cursor, 'style = straight|l_turn|u_turn|spiral');
  const width = attrs.width === undefined ? 1 : asInt(cursor, attrs.width, 'width');
  const headroom = attrs.headroom === undefined ? 3 : asInt(cursor, attrs.headroom, 'headroom');
  if (width < 1 || width > 4 || headroom < 2) failSyntax(cursor, 'width 1..4 and headroom >= 2');
  return {
    op: 'staircase',
    style: style as StairStyle,
    at: asVec2(cursor, attrs.at, 'at'),
    facing: asFacing(cursor, attrs.facing),
    width,
    stair: asStr(cursor, attrs.stair, 'stair'),
    headroom,
    ...pickOptStrs(cursor, attrs, [
      ['in_room', 'inRoom'],
      ['landing', 'landing'],
      ['rail', 'rail'],
    ]),
    ...(attrs.y_from !== undefined ? { yFrom: asScalar(cursor, attrs.y_from, 'y_from') } : {}),
    ...(attrs.y_to !== undefined ? { yTo: asScalar(cursor, attrs.y_to, 'y_to') } : {}),
  };
};

const parsePlaceAnchor = (cursor: Cursor, attrs: Record<string, unknown>): FurnishItem => {
  assertAllowedAttrs(cursor, attrs, new Set(['prefab', 'on', 'offset', 'rotate']));
  const on = asStr(cursor, attrs.on, 'on');
  if (!ANCHOR_POS.has(on)) failSyntax(cursor, 'on = cardinal|nw|ne|sw|se|center');
  return {
    kind: 'place_anchor',
    prefab: asStr(cursor, attrs.prefab, 'prefab'),
    on: on as Extract<FurnishItem, { kind: 'place_anchor' }>['on'],
    ...(attrs.offset !== undefined ? { offset: asIntVec2(cursor, attrs.offset, 'offset') } : {}),
    ...(attrs.rotate !== undefined ? { rotate: asRotate(cursor, attrs.rotate) } : {}),
  };
};

const parseHangItem = (cursor: Cursor, attrs: Record<string, unknown>): FurnishItem => {
  assertAllowedAttrs(cursor, attrs, new Set(['block', 'at', 'drop']));
  const at = asStr(cursor, attrs.at ?? 'ceiling_center', 'at');
  if (at !== 'ceiling_center' && !['north', 'south', 'east', 'west'].includes(at))
    failSyntax(cursor, 'at');
  const drop = asInt(cursor, attrs.drop ?? 1, 'drop');
  if (drop < 1 || drop > 8) failSyntax(cursor, 'hang drop 1..8');
  return {
    kind: 'hang',
    block: asStr(cursor, attrs.block, 'block'),
    at: at as Extract<FurnishItem, { kind: 'hang' }>['at'],
    drop,
  };
};

const parseFurnishOp = (cursor: Cursor): StructureOp => {
  const attrs = readAttrsUntil(cursor, ['{']);
  assertAllowedAttrs(cursor, attrs, new Set(['room']));
  const room = asStr(cursor, attrs.room, 'room');
  take(cursor, '{');
  const items: FurnishItem[] = [];
  while (peek(cursor).value !== '}') {
    const kind = readName(cursor);
    const itemAttrs = readAttrsUntil(cursor, [';']);
    take(cursor, ';');
    if (kind === 'place_anchor') items.push(parsePlaceAnchor(cursor, itemAttrs));
    else if (kind === 'hang') items.push(parseHangItem(cursor, itemAttrs));
    else failSyntax(cursor, 'place_anchor or hang');
  }
  take(cursor, '}');
  return { op: 'furnish', room, items };
};

const parseSocketOp = (cursor: Cursor): StructureOp => {
  const name = readName(cursor);
  const attrs = readAttrsUntil(cursor, [';']);
  take(cursor, ';');
  assertAllowedAttrs(
    cursor,
    attrs,
    new Set(['kind', 'at', 'room', 'wall', 'normal', 'pool', 'target']),
  );
  const kind = asStr(cursor, attrs.kind, 'kind');
  if (!SOCKET_KINDS.has(kind)) failSyntax(cursor, 'kind = entry|road|wall_join|courtyard');
  if (attrs.at === undefined && (attrs.room === undefined || attrs.wall === undefined))
    failSyntax(cursor, 'socket at or room/wall');
  return {
    op: 'socket',
    name,
    kind: kind as SocketKind,
    ...(attrs.at !== undefined ? { at: asVec3(cursor, attrs.at, 'at') } : {}),
    ...(attrs.wall !== undefined ? { wall: asFacing(cursor, attrs.wall) } : {}),
    ...(attrs.normal !== undefined ? { normal: asFacing(cursor, attrs.normal) } : {}),
    ...pickOptStrs(cursor, attrs, [
      ['room', 'room'],
      ['pool', 'pool'],
      ['target', 'target'],
    ]),
  };
};

const parseCompoundPlaceOp = (cursor: Cursor): StructureOp => {
  const alias = readName(cursor);
  const attrs = readAttrsUntil(cursor, [';']);
  take(cursor, ';');
  assertAllowedAttrs(cursor, attrs, new Set(['at', 'rotate']));
  return {
    op: 'compound_place',
    alias,
    at: asVec3(cursor, attrs.at, 'at'),
    rotate: asRotate(cursor, attrs.rotate),
  };
};

export const parseOpBlock = (cursor: Cursor, depth: number): readonly StructureOp[] => {
  if (depth > 12) failSyntax(cursor, 'structure nesting <= 12');
  take(cursor, '{');
  const ops: StructureOp[] = [];
  while (peek(cursor).value !== '}') ops.push(parseSingleOp(cursor, depth + 1));
  take(cursor, '}');
  return ops;
};

const parseFloorOp = (cursor: Cursor, depth: number): StructureOp => {
  const name = readName(cursor);
  const attrs = readAttrsUntil(cursor, ['{']);
  assertAllowedAttrs(
    cursor,
    attrs,
    new Set(['y', 'height', 'jetty', 'jetty_n', 'jetty_s', 'jetty_e', 'jetty_w']),
  );
  const jetty = parseFloorJetty(cursor, attrs);
  return {
    op: 'floor',
    name,
    y: asScalar(cursor, attrs.y, 'y'),
    height: asScalar(cursor, attrs.height, 'height'),
    ...(jetty ? { jetty } : {}),
    ops: parseOpBlock(cursor, depth),
  };
};

const parseRepeatOp = (cursor: Cursor, depth: number): StructureOp => {
  const attrs = readAttrsUntil(cursor, ['{']);
  assertAllowedAttrs(cursor, attrs, new Set(['axis', 'count', 'step']));
  const axis = attrs.axis;
  if (axis !== 'x' && axis !== 'y' && axis !== 'z') failSyntax(cursor, 'axis = x|y|z');
  const count = asInt(cursor, attrs.count, 'count');
  const step = attrs.step === undefined ? 1 : asInt(cursor, attrs.step, 'step');
  if (count < 1 || count > 64 || step === 0) failSyntax(cursor, 'count 1..64 and non-zero step');
  return { op: 'repeat', axis: axis as RepeatAxis, count, step, ops: parseOpBlock(cursor, depth) };
};

const parseMirrorOp = (cursor: Cursor, depth: number): StructureOp => {
  const attrs = readAttrsUntil(cursor, ['{']);
  assertAllowedAttrs(cursor, attrs, new Set(['axis', 'center']));
  const axis = attrs.axis;
  if (axis !== 'x' && axis !== 'z') failSyntax(cursor, 'axis = x|z');
  return {
    op: 'mirror',
    axis: axis as MirrorAxis,
    center: asInt(cursor, attrs.center, 'center'),
    ops: parseOpBlock(cursor, depth),
  };
};

const SIMPLE_OPS = new Set(['set', 'carve', 'box', 'hollow', 'walls', 'frame']);

const parseSingleOp = (cursor: Cursor, depth: number): StructureOp => {
  const kw = readName(cursor);
  if (SIMPLE_OPS.has(kw)) return parseSimpleOp(cursor, kw);
  const leaf: Readonly<Record<string, (c: Cursor) => StructureOp>> = {
    roof: parseRoofOp,
    place: parsePlaceOp,
    layer: parseLayerOp,
    room: parseRoomOp,
    facade: parseFacadeOp,
    staircase: parseStaircaseOp,
    furnish: parseFurnishOp,
    weathering: parseWeatheringOp,
    socket: parseSocketOp,
    compound_place: parseCompoundPlaceOp,
  };
  if (kw in leaf) return leaf[kw]!(cursor);
  if (kw === 'floor') return parseFloorOp(cursor, depth);
  if (kw === 'repeat') return parseRepeatOp(cursor, depth);
  if (kw === 'mirror') return parseMirrorOp(cursor, depth);
  return failSyntax(cursor, 'structure operation');
};
