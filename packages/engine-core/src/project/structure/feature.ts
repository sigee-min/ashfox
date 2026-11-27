import type { AshfoxNamedBlock } from '../program/syntax/blockAst';
import type { SourceSpan } from '../source/contract';
import type {
  CardinalFacing,
  FacadeOpeningSpec,
  FurnishItem,
  MirrorAxis,
  OpeningPlacement,
  PorchSpec,
  RoofChimneySpec,
  RoofDormerSpec,
  RoofPitch,
  RoofStyle,
  StairStyle,
  StructureOp,
  WeatheringRule,
} from './contract';
import {
  asFacing,
  asInt,
  asIntVec2,
  asNum,
  asRotate,
  asScalar,
  asStr,
  asOptStr,
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
const OPENING_KINDS = new Set<string>(['door', 'window', 'arch', 'bay_window', 'arcade']);
const ROOF_STYLES = new Set(['gable', 'hip', 'pyramid', 'spire']);

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
  'stained_glass_color',
  'glass_color',
  'hinge',
]);
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

const parsePorchBlock = (stmt: AshfoxNamedBlock, file: string): PorchSpec => {
  const props = readBlockAssigns(stmt.block, file);
  assertAllowedAttrs(
    file,
    stmt.span,
    props,
    new Set(['depth', 'floor', 'pillars', 'lamps', 'steps']),
  );
  const depth = props.depth ? asInt(file, stmt.span, props.depth, 'depth') : 2;
  if (depth < 1 || depth > 6) failAst(file, stmt.span, 'porch depth 1..6', String(depth));
  return {
    depth,
    floor: asStr(file, stmt.span, props.floor, 'floor'),
    ...pickOptStrs(file, stmt.span, props, [
      ['pillars', 'pillars'],
      ['lamps', 'lamps'],
      ['steps', 'steps'],
    ]),
  };
};

const readOpeningPlacement = (
  file: string,
  span: SourceSpan,
  attrs: Record<string, AttrEntry>,
): OpeningPlacement => {
  if (attrs.at !== undefined) {
    const at = attrs.at.value === 'center' ? 'center' : asInt(file, span, attrs.at, 'at');
    return {
      mode: 'at',
      at,
      ...(attrs.offset !== undefined ? { offset: asInt(file, span, attrs.offset, 'offset') } : {}),
    };
  }
  if (attrs.repeat !== undefined) {
    const count = asInt(file, span, attrs.repeat, 'repeat');
    const margin = attrs.margin === undefined ? 1 : asInt(file, span, attrs.margin, 'margin');
    if (count < 1 || margin < 0) failAst(file, span, 'repeat >= 1 and margin >= 0', String(count));
    return { mode: 'repeat', count, margin };
  }
  if (attrs.symmetric !== undefined) {
    return { mode: 'symmetric', offset: asInt(file, span, attrs.symmetric, 'symmetric') };
  }
  return failAst(file, span, 'at, repeat, or symmetric placement', 'none');
};

const defaultOpeningSize = (kind: FacadeOpeningSpec['kind']): readonly [number, number] => {
  if (kind === 'bay_window') return [3, 2];
  if (kind === 'arch' || kind === 'arcade') return [2, 3];
  return [1, 2];
};

const validateOpeningSize = (
  kind: FacadeOpeningSpec['kind'],
  width: number,
  height: number,
  file: string,
  span: SourceSpan,
): void => {
  const minHeight = kind === 'door' || kind === 'arcade' ? 2 : 1;
  const minWidth = kind === 'bay_window' ? 3 : 1;
  if (width < minWidth || height < minHeight) {
    failAst(file, span, 'valid opening width/height', `${width}x${height}`);
  }
};

const readSinglePorch = (
  blocks: readonly AshfoxNamedBlock[],
  file: string,
): PorchSpec | undefined => {
  let porch: PorchSpec | undefined;
  for (const sub of blocks) {
    if (sub.blockKind !== 'porch' || porch !== undefined) {
      failAst(file, sub.span, 'single porch block', sub.blockKind);
    }
    porch = parsePorchBlock(sub, file);
  }
  return porch;
};

const parseOpening = (stmt: AshfoxNamedBlock, file: string): FacadeOpeningSpec => {
  const kind = stmt.blockKind as FacadeOpeningSpec['kind'];
  const { attrs, blocks } = splitBlockParts(stmt.block, file);
  assertAllowedAttrs(file, stmt.span, attrs, OPENING_KEYS);
  const porch = readSinglePorch(blocks, file);
  const [defW, defH] = defaultOpeningSize(kind);
  const width = attrs.width ? asInt(file, stmt.span, attrs.width, 'width') : defW;
  const height = attrs.height ? asInt(file, stmt.span, attrs.height, 'height') : defH;
  validateOpeningSize(kind, width, height, file, stmt.span);
  const hinge = asOptStr(file, stmt.span, attrs.hinge, 'hinge');
  if (hinge !== undefined && hinge !== 'left' && hinge !== 'right') {
    failAst(file, attrs.hinge?.span ?? stmt.span, 'hinge = left|right', hinge, ['left', 'right']);
  }
  return {
    kind,
    placement: readOpeningPlacement(file, stmt.span, attrs),
    width,
    height,
    ...(attrs.y_offset ? { yOffset: asInt(file, stmt.span, attrs.y_offset, 'y_offset') } : {}),
    ...(attrs.recess ? { recess: asInt(file, stmt.span, attrs.recess, 'recess') } : {}),
    ...pickOptStrs(file, stmt.span, attrs, [
      ['block', 'block'],
      ['glass', 'glass'],
      ['frame', 'frame'],
      ['sill', 'sill'],
      ['shutter', 'shutter'],
      ['lintel', 'lintel'],
      ['glass_color', 'stainedGlassColor'],
      ['stained_glass_color', 'stainedGlassColor'],
    ]),
    ...(hinge !== undefined ? { hinge: hinge as 'left' | 'right' } : {}),
    ...(porch !== undefined ? { porch } : {}),
  };
};

const parseWallRef = (
  raw: string,
  file: string,
  span: SourceSpan,
): { readonly room: string; readonly wall: CardinalFacing } => {
  const parts = raw.split('.');
  if (parts.length !== 2) failAst(file, span, 'room.wall target', raw);
  const [room, wall] = parts as [string, string];
  if (wall !== 'north' && wall !== 'south' && wall !== 'east' && wall !== 'west') {
    failAst(file, span, 'north|south|east|west', wall, ['north', 'south', 'east', 'west']);
  }
  return { room, wall: wall as CardinalFacing };
};

export const parseFacadeOp = (stmt: AshfoxNamedBlock, file: string): StructureOp => {
  const { attrs, blocks } = splitBlockParts(stmt.block, file);
  assertAllowedAttrs(file, stmt.span, attrs, new Set(['on']));
  const targets: { readonly room: string; readonly wall: CardinalFacing }[] = [];
  if (stmt.name && stmt.name.includes('.')) {
    targets.push(parseWallRef(stmt.name, file, stmt.span));
  } else if (attrs.on !== undefined) {
    const rawOn = attrs.on.value;
    const list = Array.isArray(rawOn) ? rawOn : [rawOn];
    for (const item of list) {
      if (typeof item !== 'string') failAst(file, attrs.on.span, 'room.wall', String(item));
      targets.push(parseWallRef(item, file, attrs.on.span));
    }
  }
  if (targets.length === 0) failAst(file, stmt.span, 'facade room.wall or on = [...]', 'missing');
  const openings: FacadeOpeningSpec[] = blocks.map((sub) => {
    if (!OPENING_KINDS.has(sub.blockKind)) {
      failAst(file, sub.span, 'door, window, arch, bay_window, or arcade', sub.blockKind, [
        ...OPENING_KINDS,
      ]);
    }
    return parseOpening(sub, file);
  });
  return { op: 'facade', targets, openings };
};

export const parseStaircaseOp = (stmt: AshfoxNamedBlock, file: string): StructureOp => {
  const attrs = readBlockAssigns(stmt.block, file);
  assertAllowedAttrs(file, stmt.span, attrs, STAIR_KEYS);
  const style = asStr(file, stmt.span, attrs.style, 'style');
  if (!STAIR_STYLES.has(style))
    failAst(file, stmt.span, 'straight|l_turn|u_turn|spiral', style, [...STAIR_STYLES]);
  const width = attrs.width === undefined ? 1 : asInt(file, stmt.span, attrs.width, 'width');
  const headroom =
    attrs.headroom === undefined ? 3 : asInt(file, stmt.span, attrs.headroom, 'headroom');
  if (width < 1 || width > 4 || headroom < 2) {
    failAst(file, stmt.span, 'width 1..4 and headroom >= 2', `${width}/${headroom}`);
  }
  return {
    op: 'staircase',
    style: style as StairStyle,
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
  const style = asStr(file, span, attrs.style, 'style');
  if (!ROOF_STYLES.has(style)) failAst(file, span, 'roof style', style, [...ROOF_STYLES]);
  const axis = attrs.axis?.value ?? 'z';
  if (axis !== 'x' && axis !== 'z')
    failAst(file, span, 'roof axis = x|z', String(axis), ['x', 'z']);
  const pitch = (attrs.pitch?.value ?? 'standard') as RoofPitch;
  if (!['shallow', 'standard', 'steep'].includes(pitch)) {
    failAst(file, span, 'pitch', pitch, ['shallow', 'standard', 'steep']);
  }
  if (attrs.on === undefined && (attrs.from === undefined || attrs.to === undefined)) {
    failAst(file, span, 'roof on or from/to', 'missing');
  }
  const overhang = attrs.overhang ? asInt(file, span, attrs.overhang, 'overhang') : 0;
  if (overhang < 0 || overhang > 3) failAst(file, span, 'overhang 0..3', String(overhang));
  return { style: style as RoofStyle, axis: axis as MirrorAxis, pitch, overhang };
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
  const on = asStr(file, sub.span, subAttrs.on, 'on');
  if (!ANCHOR_POS.has(on))
    failAst(file, sub.span, 'cardinal|nw|ne|sw|se|center', on, [...ANCHOR_POS]);
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
  if (at !== 'ceiling_center' && !['north', 'south', 'east', 'west'].includes(at)) {
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

const parseSpreadWeatherRule = (
  kind: 'ground_moss' | 'eave_shadow',
  attrs: Record<string, AttrEntry>,
  file: string,
  span: SourceSpan,
): WeatheringRule => {
  const keys =
    kind === 'ground_moss' ? ['height', 'target', 'into', 'rate'] : ['target', 'into', 'rate'];
  assertAllowedAttrs(file, span, attrs, new Set(keys));
  const rate = asNum(file, span, attrs.rate, 'rate');
  if (rate < 0 || rate > 1) failAst(file, span, 'rate 0..1', String(rate));
  const target = asStr(file, span, attrs.target, 'target');
  const into = asStr(file, span, attrs.into, 'into');
  if (kind === 'eave_shadow') return { kind, target, into, rate };
  const height = attrs.height ? asInt(file, span, attrs.height, 'height') : 2;
  if (height < 0 || height > 16) failAst(file, span, 'height 0..16', String(height));
  return { kind, height, target, into, rate };
};

const parseWeatheringRule = (sub: AshfoxNamedBlock, file: string): WeatheringRule => {
  const attrs = readBlockAssigns(sub.block, file);
  const kind = sub.blockKind;
  if (kind === 'ground_moss' || kind === 'eave_shadow') {
    return parseSpreadWeatherRule(kind, attrs, file, sub.span);
  }
  if (kind === 'corner_quoin') {
    assertAllowedAttrs(file, sub.span, attrs, new Set(['target', 'corners']));
    return {
      kind,
      target: asStr(file, sub.span, attrs.target, 'target'),
      corners: asStr(file, sub.span, attrs.corners, 'corners'),
    };
  }
  if (kind === 'chimney_soot') {
    assertAllowedAttrs(file, sub.span, attrs, new Set(['radius', 'rate']));
    const radius = attrs.radius ? asInt(file, sub.span, attrs.radius, 'radius') : 2;
    const rate = asNum(file, sub.span, attrs.rate, 'rate');
    if (radius < 1 || radius > 8 || rate < 0 || rate > 1) {
      failAst(file, sub.span, 'radius 1..8, rate 0..1', `${radius}/${rate}`);
    }
    return { kind, radius, rate };
  }
  return failAst(file, sub.span, 'weathering rule', kind);
};

export const parseWeatheringOp = (stmt: AshfoxNamedBlock, file: string): StructureOp => {
  const rules = stmt.block.statements.map((sub) => {
    if (sub.kind !== 'named-block')
      return failAst(file, sub.span, 'weathering rule block', sub.kind);
    return parseWeatheringRule(sub, file);
  });
  return { op: 'weathering', rules };
};
