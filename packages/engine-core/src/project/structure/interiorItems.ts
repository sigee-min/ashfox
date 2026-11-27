import type { AshfoxBareStmt, AshfoxNamedBlock } from '../program/syntax/blockAst';
import type { SourceSpan } from '../source/contract';
import { MAX_STRUCTURE_DIM } from './contract';
import {
  asFacing,
  asInt,
  asIntVec2,
  asNum,
  asOptFacing,
  asOptStr,
  asStr,
  assertAllowedAttrs,
  failAst,
  pickOptStrs,
  readBlockAssigns,
  type AttrEntry,
} from './grammar';
import type {
  InteriorDraperyAst,
  InteriorGroupAst,
  InteriorStoryAst,
  InteriorSubItemAst,
  InteriorVolumeAst,
} from './interiorDef';
import {
  PROP_KINDS,
  asAnchor,
  asAnchorList,
  asBool,
  asNumVec3,
  nextId,
  parsePropFromParts,
  splitInteriorBlock,
} from './interiorProps';

const readScaled16 = (
  exact: AttrEntry | undefined,
  blocks: AttrEntry | undefined,
  file: string,
  span: SourceSpan,
  name: string,
): number | undefined => {
  if (exact) return asNum(file, span, exact, `${name}_16`);
  return blocks ? Math.round(asNum(file, span, blocks, name) * 16) : undefined;
};

export const parseAlcove = (
  stmt: AshfoxNamedBlock | AshfoxBareStmt,
  file: string,
  seq: { count: number },
): Extract<InteriorVolumeAst, { kind: 'alcove' }> => {
  if (stmt.kind === 'bare')
    return { kind: 'alcove', id: nextId(seq, 'alcove', null), alcove_kind: 'tokonoma' };
  const attrs = readBlockAssigns(stmt.block, file);
  assertAllowedAttrs(
    file,
    stmt.span,
    attrs,
    new Set([
      'kind',
      'alcove_kind',
      'wall',
      'at',
      'at_u',
      'width',
      'width_b',
      'height',
      'height_b',
      'depth',
      'depth_16',
      'y_offset',
      'y_offset_16',
    ]),
  );
  const [atE, wE, hE] = [
    attrs.at_u ?? attrs.at,
    attrs.width_b ?? attrs.width,
    attrs.height_b ?? attrs.height,
  ];
  const d16 = readScaled16(attrs.depth_16, attrs.depth, file, stmt.span, 'depth');
  const y16 = readScaled16(attrs.y_offset_16, attrs.y_offset, file, stmt.span, 'y_offset');
  return {
    kind: 'alcove',
    id: nextId(seq, 'alcove', stmt.name),
    alcove_kind: asOptStr(file, stmt.span, attrs.alcove_kind ?? attrs.kind, 'kind') ?? 'fireplace',
    ...(attrs.wall ? { wall: asFacing(file, stmt.span, attrs.wall) } : {}),
    ...(atE ? { at_u: asInt(file, stmt.span, atE, 'at') } : {}),
    ...(wE ? { width_b: asInt(file, stmt.span, wE, 'width') } : {}),
    ...(hE ? { height_b: asInt(file, stmt.span, hE, 'height') } : {}),
    ...(d16 !== undefined ? { depth_16: d16 } : {}),
    ...(y16 !== undefined ? { y_offset_16: y16 } : {}),
  };
};

export const parseStory = (
  stmt: AshfoxNamedBlock | AshfoxBareStmt,
  file: string,
  seq: { count: number },
): InteriorStoryAst => {
  if (stmt.kind === 'bare') return failAst(file, stmt.span, 'story <kind> { ... }', stmt.stmtKind);
  const attrs = readBlockAssigns(stmt.block, file);
  assertAllowedAttrs(file, stmt.span, attrs, new Set(['kind', 'on', 'facing', 'seed']));
  const kind = stmt.name ?? asStr(file, stmt.span, attrs.kind, 'kind');
  return {
    id: nextId(seq, 'story', kind),
    kind,
    ...(attrs.on ? { on_target: asStr(file, stmt.span, attrs.on, 'on') } : {}),
    ...(attrs.facing ? { facing: asFacing(file, stmt.span, attrs.facing) } : {}),
    ...(attrs.seed ? { seed: asInt(file, stmt.span, attrs.seed, 'seed') } : {}),
  };
};

const parseSubItem = (
  stmt: AshfoxNamedBlock | AshfoxBareStmt,
  file: string,
  seq: { count: number },
): InteriorSubItemAst => {
  const kind = stmt.kind === 'named-block' ? stmt.blockKind : stmt.stmtKind;
  if (kind === 'alcove') return { item: 'alcove', spec: parseAlcove(stmt, file, seq) };
  if (kind === 'story') return { item: 'story', spec: parseStory(stmt, file, seq) };
  if (kind === 'prop' || PROP_KINDS.has(kind)) {
    const attrs = stmt.kind === 'named-block' ? readBlockAssigns(stmt.block, file) : {};
    if (stmt.kind === 'bare' && stmt.items.length > 0)
      failAst(file, stmt.span, `${kind} { ... } or ${kind};`, kind);
    const name = stmt.kind === 'named-block' ? stmt.name : null;
    return { item: 'prop', spec: parsePropFromParts(kind, name, attrs, file, stmt.span, seq) };
  }
  return failAst(file, stmt.span, 'interior prop, alcove, or story', kind);
};

const parseHeight16 = (
  kind: 'platform' | 'sunken',
  attrs: Record<string, AttrEntry>,
  file: string,
  span: SourceSpan,
): number => {
  if (attrs.height_16) return asNum(file, span, attrs.height_16, 'height_16');
  const raw = attrs.height ? asNum(file, span, attrs.height, 'height') : 0.25;
  const scaled = Math.abs(raw) <= 1 ? Math.round(raw * 16) : Math.round(raw);
  return kind === 'sunken' ? -Math.abs(scaled) : Math.abs(scaled);
};

export const parsePlatformOrSunken = (
  stmt: AshfoxNamedBlock,
  file: string,
  seq: { count: number },
): InteriorVolumeAst => {
  const kind = stmt.blockKind as 'platform' | 'sunken';
  const { attrs, nested } = splitInteriorBlock(stmt.block, file);
  assertAllowedAttrs(
    file,
    stmt.span,
    attrs,
    new Set([
      'on',
      'from',
      'size',
      'height',
      'height_16',
      'step_facing',
      'floor_pattern',
      'trim_tile',
      'railing',
    ]),
  );
  return {
    kind,
    id: nextId(seq, kind, stmt.name),
    ...(attrs.on ? { on: asAnchor(file, stmt.span, attrs.on) } : {}),
    ...(attrs.from ? { from: asIntVec2(file, stmt.span, attrs.from, 'from') } : {}),
    ...(attrs.size ? { size: asIntVec2(file, stmt.span, attrs.size, 'size') } : {}),
    height_16: parseHeight16(kind, attrs, file, stmt.span),
    ...(attrs.step_facing ? { step_facing: asFacing(file, stmt.span, attrs.step_facing) } : {}),
    ...pickOptStrs(file, stmt.span, attrs, [
      ['floor_pattern', 'floor_pattern'],
      ['trim_tile', 'trim_tile'],
      ['railing', 'railing'],
    ]),
    nested: nested.map((n) => parseSubItem(n, file, seq)),
  };
};

export const parseMezzanine = (
  stmt: AshfoxNamedBlock,
  file: string,
  seq: { count: number },
): InteriorVolumeAst => {
  const { attrs, nested } = splitInteriorBlock(stmt.block, file);
  assertAllowedAttrs(
    file,
    stmt.span,
    attrs,
    new Set(['on', 'depth', 'y_offset', 'y_offset_b', 'railing', 'stair_at', 'support_pillars']),
  );
  const yOffEntry = attrs.y_offset_b ?? attrs.y_offset;
  return {
    kind: 'mezzanine',
    id: nextId(seq, 'mezzanine', stmt.name),
    on: asFacing(file, stmt.span, attrs.on),
    depth: attrs.depth ? asInt(file, stmt.span, attrs.depth, 'depth') : 3,
    ...(yOffEntry ? { y_offset_b: asInt(file, stmt.span, yOffEntry, 'y_offset') } : {}),
    railing: asOptStr(file, stmt.span, attrs.railing, 'railing') ?? 'timber',
    ...(attrs.stair_at ? { stair_at: asIntVec2(file, stmt.span, attrs.stair_at, 'stair_at') } : {}),
    ...(attrs.support_pillars
      ? { support_pillars: asBool(file, stmt.span, attrs.support_pillars, 'support_pillars') }
      : {}),
    nested: nested.map((n) => parseSubItem(n, file, seq)),
  };
};

export const parseOpenTruss = (
  stmt: AshfoxNamedBlock,
  file: string,
  seq: { count: number },
): InteriorVolumeAst => {
  const attrs = readBlockAssigns(stmt.block, file);
  assertAllowedAttrs(
    file,
    stmt.span,
    attrs,
    new Set([
      'style',
      'axis',
      'bay_spacing',
      'bay_spacing_b',
      'ridge_height',
      'ridge_height_16',
      'chord_thickness_16',
    ]),
  );
  const axis = (attrs.axis?.value ?? 'x') as 'x' | 'z';
  if (axis !== 'x' && axis !== 'z') failAst(file, stmt.span, 'axis = x|z', String(axis));
  const bayEntry = attrs.bay_spacing_b ?? attrs.bay_spacing;
  const ridge16 = readScaled16(
    attrs.ridge_height_16,
    attrs.ridge_height,
    file,
    stmt.span,
    'ridge_height',
  );
  return {
    kind: 'open_truss',
    id: nextId(seq, 'truss', stmt.name),
    style: asOptStr(file, stmt.span, attrs.style, 'style') ?? 'a_frame',
    axis,
    ...(bayEntry ? { bay_spacing_b: asInt(file, stmt.span, bayEntry, 'bay_spacing') } : {}),
    ...(ridge16 !== undefined ? { ridge_height_16: ridge16 } : {}),
    ...(attrs.chord_thickness_16
      ? {
          chord_thickness_16: asNum(
            file,
            stmt.span,
            attrs.chord_thickness_16,
            'chord_thickness_16',
          ),
        }
      : {}),
  };
};

const readPartitionCoord = (
  entry: AttrEntry | undefined,
  file: string,
  span: SourceSpan,
  name: string,
): number | undefined => {
  if (!entry) return undefined;
  const v = asInt(file, span, entry, name);
  if (v < 0 || v > MAX_STRUCTURE_DIM)
    failAst(file, span, `partition ${name} within 0..${MAX_STRUCTURE_DIM}`, `${v}`);
  return v;
};

const readPartitionBounds = (
  attrs: Record<string, AttrEntry>,
  file: string,
  span: SourceSpan,
): { readonly at_pos: number; readonly span_from?: number; readonly span_to?: number } => {
  const atPos = readPartitionCoord(attrs.at_pos ?? attrs.at, file, span, 'at') ?? 0;
  const spanFrom = readPartitionCoord(attrs.span_from ?? attrs.from, file, span, 'span_from');
  const spanTo = readPartitionCoord(attrs.span_to ?? attrs.to, file, span, 'span_to');
  if (spanFrom !== undefined && spanTo !== undefined && spanTo < spanFrom) {
    failAst(file, span, 'partition span_to >= span_from', `${spanFrom}..${spanTo}`);
  }
  return {
    at_pos: atPos,
    ...(spanFrom !== undefined ? { span_from: spanFrom } : {}),
    ...(spanTo !== undefined ? { span_to: spanTo } : {}),
  };
};

export const parsePartition = (
  stmt: AshfoxNamedBlock,
  file: string,
  seq: { count: number },
): InteriorVolumeAst => {
  const attrs = readBlockAssigns(stmt.block, file);
  assertAllowedAttrs(
    file,
    stmt.span,
    attrs,
    new Set([
      'style',
      'on',
      'axis',
      'at',
      'at_pos',
      'from',
      'span_from',
      'to',
      'span_to',
      'doorway_at',
      'doorway_width',
      'open_ratio',
    ]),
  );
  const axis = (attrs.axis?.value ??
    (attrs.on?.value === 'east' || attrs.on?.value === 'west' ? 'z' : 'x')) as 'x' | 'z';
  if (axis !== 'x' && axis !== 'z') failAst(file, stmt.span, 'axis = x|z', String(axis));
  return {
    kind: 'partition',
    id: nextId(seq, 'partition', stmt.name),
    style: asOptStr(file, stmt.span, attrs.style, 'style') ?? 'colonnade',
    axis,
    ...readPartitionBounds(attrs, file, stmt.span),
    ...(attrs.doorway_at
      ? { doorway_at: asInt(file, stmt.span, attrs.doorway_at, 'doorway_at') }
      : {}),
    ...(attrs.doorway_width
      ? { doorway_width: asInt(file, stmt.span, attrs.doorway_width, 'doorway_width') }
      : {}),
    ...(attrs.open_ratio
      ? { open_ratio: asNum(file, stmt.span, attrs.open_ratio, 'open_ratio') }
      : {}),
  };
};

export const parseGroupBlock = (
  stmt: AshfoxNamedBlock,
  file: string,
  seq: { count: number },
): InteriorGroupAst => {
  const kind = stmt.blockKind as InteriorGroupAst['kind'];
  const { attrs, nested } = splitInteriorBlock(stmt.block, file);
  assertAllowedAttrs(file, stmt.span, attrs, new Set(['on']));
  return {
    kind,
    id: nextId(seq, kind, stmt.name),
    on: asAnchorList(file, attrs.on),
    items: nested.map((n) => parseSubItem(n, file, seq)),
  };
};

const MAX_DRAPERY_PANELS = 32;
const MAX_DRAPERY_PLEATS = 64;

const readDraperyInt = (
  entry: AttrEntry | undefined,
  file: string,
  span: SourceSpan,
  name: string,
  max: number,
): number | undefined => {
  if (!entry) return undefined;
  const v = asInt(file, span, entry, name);
  if (v < 1 || v > max) failAst(file, span, `${name} within 1..${max}`, `${v}`);
  return v;
};

const readDraperyVec = (
  entry: AttrEntry | undefined,
  file: string,
  span: SourceSpan,
  name: 'from' | 'to',
): readonly [number, number, number] | undefined => {
  if (!entry) return undefined;
  const vec = asNumVec3(file, span, entry, name);
  const lim = MAX_STRUCTURE_DIM * 16;
  if (vec.some((v) => !Number.isFinite(v) || Math.abs(v) > lim)) {
    failAst(file, span, `drapery ${name} within -${lim}..${lim}`, `(${vec.join(', ')})`);
  }
  return vec;
};

const readDraperySag = (
  entry: AttrEntry | undefined,
  file: string,
  span: SourceSpan,
): number | undefined => {
  if (!entry) return undefined;
  const v = asNum(file, span, entry, 'sag');
  if (v < 0 || v > MAX_STRUCTURE_DIM * 16) {
    failAst(file, span, `drapery sag within 0..${MAX_STRUCTURE_DIM * 16}`, `${v}`);
  }
  return v;
};

export const parseDrapery = (
  stmt: AshfoxNamedBlock,
  file: string,
  seq: { count: number },
): InteriorDraperyAst => {
  const attrs = readBlockAssigns(stmt.block, file);
  assertAllowedAttrs(
    file,
    stmt.span,
    attrs,
    new Set([
      'kind',
      'on',
      'from',
      'to',
      'facing',
      'sag',
      'sag_16',
      'pleats',
      'tieback',
      'split_panels',
      'color',
      'tile',
    ]),
  );
  const kind = stmt.name ?? asStr(file, stmt.span, attrs.kind, 'kind');
  const sagVal = readDraperySag(attrs.sag_16 ?? attrs.sag, file, stmt.span);
  const from16 = readDraperyVec(attrs.from, file, stmt.span, 'from');
  const to16 = readDraperyVec(attrs.to, file, stmt.span, 'to');
  const pleats = readDraperyInt(attrs.pleats, file, stmt.span, 'pleats', MAX_DRAPERY_PLEATS);
  const splitPanels = readDraperyInt(
    attrs.split_panels,
    file,
    stmt.span,
    'split_panels',
    MAX_DRAPERY_PANELS,
  );
  return {
    id: nextId(seq, 'drape', kind),
    kind,
    on_target: asOptStr(file, stmt.span, attrs.on, 'on') ?? 'windows',
    ...(from16 ? { from_16: from16 } : {}),
    ...(to16 ? { to_16: to16 } : {}),
    ...(attrs.facing ? { facing: asOptFacing(file, stmt.span, attrs.facing) } : {}),
    ...(sagVal !== undefined ? { sag_16: sagVal } : {}),
    ...(pleats !== undefined ? { pleats } : {}),
    ...(attrs.tieback ? { tieback: asBool(file, stmt.span, attrs.tieback, 'tieback') } : {}),
    ...(splitPanels !== undefined ? { split_panels: splitPanels } : {}),
    ...(attrs.color ? { color: asStr(file, stmt.span, attrs.color, 'color') } : {}),
    ...(attrs.tile ? { tile_id: asStr(file, stmt.span, attrs.tile, 'tile') } : {}),
  };
};
