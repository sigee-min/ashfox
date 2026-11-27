import type { AshfoxNamedBlock } from '../program/syntax/blockAst';
import { assertClosedChoice } from '../program/syntax/blockLowering';
import type { SourceSpan } from '../source/contract';
import type {
  FurnishItem,
  MirrorAxis,
  RoofChimneySpec,
  RoofDormerSpec,
  RoofPitch,
  RoofStyle,
  StairStyle,
  StructureOp,
} from './contract';
import {
  asFacing,
  asInt,
  asIntVec2,
  asRotate,
  asScalar,
  asStr,
  asVec2,
  asVec3,
  assertAllowedAttrs,
  failAst,
  pickOptStrs,
  readBlockAssigns,
  splitBlockParts,
  type AttrEntry,
} from './grammar';

const STAIR_STYLES = new Set(['straight', 'l_turn', 'u_turn', 'spiral']);
const ANCHOR_POS = new Set(['north', 'south', 'east', 'west', 'nw', 'ne', 'sw', 'se', 'center']);
const ROOF_STYLES = new Set(['gable', 'hip', 'pyramid', 'spire']);
const HANG_ATS = ['ceiling_center', 'north', 'south', 'east', 'west'] as const;

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

const ROOF_KEYS = new Set([
  'on',
  'style',
  'axis',
  'from',
  'to',
  'overhang',
  'pitch',
  'stair',
  'trim',
  'ridge',
  'gable',
  'under_eave',
  'battlement',
]);

export const parseStaircaseOp = (stmt: AshfoxNamedBlock, file: string): StructureOp => {
  const attrs = readBlockAssigns(stmt.block, file);
  assertAllowedAttrs(file, stmt.span, attrs, STAIR_KEYS);
  const style = assertClosedChoice(
    asStr(file, stmt.span, attrs.style, 'style'),
    STAIR_STYLES,
    file,
    stmt.span,
    'straight|l_turn|u_turn|spiral',
    failAst,
  ) as StairStyle;
  const width = attrs.width === undefined ? 1 : asInt(file, stmt.span, attrs.width, 'width');
  const headroom =
    attrs.headroom === undefined ? 3 : asInt(file, stmt.span, attrs.headroom, 'headroom');
  if (width < 1 || width > 4 || headroom < 2) {
    failAst(file, stmt.span, 'width 1..4 and headroom >= 2', `${width}/${headroom}`);
  }
  return {
    op: 'staircase',
    style,
    at: asVec2(file, stmt.span, attrs.at, 'at'),
    facing: asFacing(file, stmt.span, attrs.facing),
    width,
    stair: asStr(file, stmt.span, attrs.stair, 'stair'),
    headroom,
    ...pickOptStrs(file, stmt.span, attrs, [
      ['in_room', 'inRoom'],
      ['landing', 'landing'],
      ['rail', 'rail'],
    ]),
    ...(attrs.y_from ? { yFrom: asScalar(file, stmt.span, attrs.y_from, 'y_from') } : {}),
    ...(attrs.y_to ? { yTo: asScalar(file, stmt.span, attrs.y_to, 'y_to') } : {}),
  };
};

const parseRoofDormer = (stmt: AshfoxNamedBlock, file: string): RoofDormerSpec => {
  const attrs = readBlockAssigns(stmt.block, file);
  assertAllowedAttrs(
    file,
    stmt.span,
    attrs,
    new Set(['wall', 'offset', 'width', 'height', 'window']),
  );
  const width = asInt(file, stmt.span, attrs.width, 'width');
  const height = asInt(file, stmt.span, attrs.height, 'height');
  if (width < 1 || height < 2) failAst(file, stmt.span, 'dormer width >= 1, height >= 2', 'bad');
  return {
    wall: asFacing(file, stmt.span, attrs.wall),
    offset: attrs.offset === undefined ? 0 : asInt(file, stmt.span, attrs.offset, 'offset'),
    width,
    height,
    ...pickOptStrs(file, stmt.span, attrs, [['window', 'windowBlock']]),
  };
};

const parseRoofChimney = (stmt: AshfoxNamedBlock, file: string): RoofChimneySpec => {
  const attrs = readBlockAssigns(stmt.block, file);
  assertAllowedAttrs(
    file,
    stmt.span,
    attrs,
    new Set(['room', 'corner', 'offset', 'width', 'rise', 'block', 'cap']),
  );
  const corner = attrs.corner ? asStr(file, stmt.span, attrs.corner, 'corner') : 'nw';
  if (!['nw', 'ne', 'sw', 'se', 'center'].includes(corner)) {
    failAst(file, stmt.span, 'corner = nw|ne|sw|se|center', corner);
  }
  const width = attrs.width ? asInt(file, stmt.span, attrs.width, 'width') : 1;
  const rise = attrs.rise ? asInt(file, stmt.span, attrs.rise, 'rise') : 3;
  if (width < 1 || width > 4 || rise < 1) {
    failAst(file, stmt.span, 'chimney width 1..4, rise >= 1', `${width}/${rise}`);
  }
  return {
    ...pickOptStrs(file, stmt.span, attrs, [['room', 'room']]),
    corner: corner as RoofChimneySpec['corner'],
    offset:
      attrs.offset === undefined ? [0, 0] : asIntVec2(file, stmt.span, attrs.offset, 'offset'),
    width,
    rise,
    block: asStr(file, stmt.span, attrs.block, 'block'),
    cap: attrs.cap === undefined ? true : Boolean(attrs.cap.value),
  };
};

const readRoofBlocks = (
  blocks: readonly AshfoxNamedBlock[],
  file: string,
): {
  readonly dormers: readonly RoofDormerSpec[];
  readonly chimneys: readonly RoofChimneySpec[];
} => {
  const dormers: RoofDormerSpec[] = [];
  const chimneys: RoofChimneySpec[] = [];
  for (const sub of blocks) {
    if (sub.blockKind === 'dormer') dormers.push(parseRoofDormer(sub, file));
    else if (sub.blockKind === 'chimney') chimneys.push(parseRoofChimney(sub, file));
    else failAst(file, sub.span, 'dormer or chimney', sub.blockKind);
  }
  return { dormers, chimneys };
};

const parseRoofHeader = (
  attrs: Record<string, AttrEntry>,
  file: string,
  span: SourceSpan,
): {
  readonly style: RoofStyle;
  readonly axis: MirrorAxis;
  readonly pitch: RoofPitch;
  readonly overhang: number;
} => {
  const style = assertClosedChoice(
    asStr(file, span, attrs.style, 'style'),
    ROOF_STYLES,
    file,
    span,
    'roof style',
    failAst,
  ) as RoofStyle;
  const axis = assertClosedChoice(
    String(attrs.axis?.value ?? 'z'),
    ['x', 'z'] as const,
    file,
    span,
    'roof axis = x|z',
    failAst,
  ) as MirrorAxis;
  const pitch = assertClosedChoice(
    String(attrs.pitch?.value ?? 'standard'),
    ['shallow', 'standard', 'steep'] as const,
    file,
    span,
    'pitch',
    failAst,
  ) as RoofPitch;
  if (attrs.on === undefined && (attrs.from === undefined || attrs.to === undefined)) {
    failAst(file, span, 'roof on or from/to', 'missing');
  }
  const overhang = attrs.overhang ? asInt(file, span, attrs.overhang, 'overhang') : 0;
  if (overhang < 0 || overhang > 3) failAst(file, span, 'overhang 0..3', String(overhang));
  return { style, axis, pitch, overhang };
};

export const parseRoofOp = (stmt: AshfoxNamedBlock, file: string): StructureOp => {
  const { attrs, blocks } = splitBlockParts(stmt.block, file);
  assertAllowedAttrs(file, stmt.span, attrs, ROOF_KEYS);
  const { style, axis, pitch, overhang } = parseRoofHeader(attrs, file, stmt.span);
  const { dormers, chimneys } = readRoofBlocks(blocks, file);
  return {
    op: 'roof',
    style,
    axis,
    pitch,
    overhang,
    stair: asStr(file, stmt.span, attrs.stair, 'stair'),
    ridge: asStr(file, stmt.span, attrs.ridge, 'ridge'),
    ...pickOptStrs(file, stmt.span, attrs, [
      ['on', 'on'],
      ['trim', 'trim'],
      ['gable', 'gable'],
    ]),
    ...(attrs.from ? { from: asVec3(file, stmt.span, attrs.from, 'from') } : {}),
    ...(attrs.to ? { to: asVec3(file, stmt.span, attrs.to, 'to') } : {}),
    ...(attrs.under_eave ? { underEave: Boolean(attrs.under_eave.value) } : {}),
    ...(attrs.battlement ? { battlement: Boolean(attrs.battlement.value) } : {}),
    ...(dormers.length > 0 ? { dormers } : {}),
    ...(chimneys.length > 0 ? { chimneys } : {}),
  };
};

const parsePlaceAnchorItem = (sub: AshfoxNamedBlock, file: string): FurnishItem => {
  const subAttrs = readBlockAssigns(sub.block, file);
  assertAllowedAttrs(file, sub.span, subAttrs, new Set(['prefab', 'on', 'offset', 'rotate']));
  const on = assertClosedChoice(
    asStr(file, sub.span, subAttrs.on, 'on'),
    ANCHOR_POS,
    file,
    sub.span,
    'cardinal|nw|ne|sw|se|center',
    failAst,
  );
  return {
    kind: 'place_anchor',
    prefab: asStr(file, sub.span, subAttrs.prefab, 'prefab'),
    on: on as Extract<FurnishItem, { kind: 'place_anchor' }>['on'],
    ...(subAttrs.offset ? { offset: asIntVec2(file, sub.span, subAttrs.offset, 'offset') } : {}),
    ...(subAttrs.rotate ? { rotate: asRotate(file, sub.span, subAttrs.rotate) } : {}),
  };
};

const parseHangItem = (sub: AshfoxNamedBlock, file: string): FurnishItem => {
  const subAttrs = readBlockAssigns(sub.block, file);
  assertAllowedAttrs(file, sub.span, subAttrs, new Set(['block', 'at', 'drop']));
  const at = subAttrs.at ? asStr(file, sub.span, subAttrs.at, 'at') : 'ceiling_center';
  if (!HANG_ATS.includes(at as (typeof HANG_ATS)[number])) {
    failAst(file, sub.span, 'at', at);
  }
  const drop = subAttrs.drop ? asInt(file, sub.span, subAttrs.drop, 'drop') : 1;
  if (drop < 1 || drop > 8) failAst(file, sub.span, 'hang drop 1..8', String(drop));
  return {
    kind: 'hang',
    block: asStr(file, sub.span, subAttrs.block, 'block'),
    at: at as Extract<FurnishItem, { kind: 'hang' }>['at'],
    drop,
  };
};

export const parseFurnishOp = (stmt: AshfoxNamedBlock, file: string): StructureOp => {
  const { attrs, blocks } = splitBlockParts(stmt.block, file);
  assertAllowedAttrs(file, stmt.span, attrs, new Set(['room']));
  const room = stmt.name ?? asStr(file, stmt.span, attrs.room, 'room');
  const items: FurnishItem[] = blocks.map((sub) => {
    if (sub.blockKind === 'place_anchor') return parsePlaceAnchorItem(sub, file);
    if (sub.blockKind === 'hang') return parseHangItem(sub, file);
    return failAst(file, sub.span, 'place_anchor or hang', sub.blockKind);
  });
  return { op: 'furnish', room, items };
};
