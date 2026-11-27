import type { AshfoxBlock, AshfoxNamedBlock, AshfoxBareStmt } from '../program/syntax/blockAst';
import type { SourceSpan } from '../source/contract';
import {
  asFacing,
  asInt,
  asIntVec2,
  asNum,
  asOptStr,
  asStr,
  assertAllowedAttrs,
  failAst,
  readAssignEntry,
  type AttrEntry,
} from './grammar';
import { MAX_STRUCTURE_DIM } from './contract';
import type { InteriorAnchor, InteriorArchKind, InteriorPropAst } from './interiorDef';

export const ARCHES = new Set<string>([
  'rustic',
  'japanese',
  'modern',
  'scifi',
  'gothic',
  'desert',
  'industrial',
  'nordic',
]);

export const MOODS = new Set<string>([
  'warm_hearth',
  'zen_daylight',
  'minimal_bright',
  'cyber_neon',
  'arcane_dusk',
  'sunbaked_ochre',
]);

const ANCHORS = new Set<string>([
  'north',
  'south',
  'east',
  'west',
  'nw',
  'ne',
  'sw',
  'se',
  'center',
]);

export const PROP_KINDS = new Set<string>([
  'table',
  'tables',
  'l_counter',
  'sofa',
  'sofas',
  'shelving',
  'terminal',
  'terminals',
  'console_terminal',
  'dining_set',
  'low_table',
  'cushion',
  'cushions',
  'chair',
  'swivel_chair',
  'fireplace',
  'barrel_rack',
  'display_case',
  'cabinet',
  'holo_screen',
  'counter',
  'wall_shelf',
  'custom_prop',
  'rug',
  'chandelier',
  'pendant',
  'mount',
  'painting',
]);

const PROP_ALLOWED_KEYS = new Set([
  'kind',
  'at',
  'size',
  'length',
  'facing',
  'style',
  'style_override',
  'seats',
  'seat_count',
  'auto_join',
  'rotation_deg',
  'organic_jitter',
  'mount_on',
  'asset',
  'asset_alias',
  'variant',
  'drop',
  'color',
  'on',
]);

export const nextId = (seq: { count: number }, prefix: string, name: string | null): string => {
  seq.count += 1;
  return name ?? `${prefix}_${seq.count}`;
};

export const asBool = (
  file: string,
  span: SourceSpan,
  entry: AttrEntry | undefined,
  k: string,
): boolean =>
  typeof entry?.value === 'boolean'
    ? entry.value
    : failAst(file, entry?.span ?? span, `${k} = true|false`, String(entry?.value));

export const asNumVec3 = (
  file: string,
  span: SourceSpan,
  entry: AttrEntry | undefined,
  k: string,
): readonly [number, number, number] => {
  const v = entry?.value;
  if (!Array.isArray(v) || v.length !== 3 || v.some((x) => typeof x !== 'number')) {
    failAst(file, entry?.span ?? span, `${k} = (x, y, z)`, String(v));
  }
  return v as readonly [number, number, number];
};

export const asAnchor = (
  file: string,
  span: SourceSpan,
  entry: AttrEntry | undefined,
): InteriorAnchor => {
  const s = asStr(file, span, entry, 'anchor');
  if (!ANCHORS.has(s)) failAst(file, entry?.span ?? span, 'anchor', s);
  return s as InteriorAnchor;
};

export const asAnchorList = (
  file: string,
  entry: AttrEntry | undefined,
): readonly InteriorAnchor[] => {
  if (!entry) return ['center'];
  const raw = Array.isArray(entry.value) ? entry.value : [entry.value];
  return raw.map((item) =>
    typeof item === 'string' && ANCHORS.has(item)
      ? (item as InteriorAnchor)
      : failAst(file, entry.span, 'anchor or anchor list', String(item)),
  );
};

export const splitInteriorBlock = (block: AshfoxBlock, file: string) => {
  const attrs: Record<string, AttrEntry> = {};
  const nested: (AshfoxNamedBlock | AshfoxBareStmt)[] = [];
  for (const stmt of block.statements) {
    if (stmt.kind === 'assign') {
      if (Object.hasOwn(attrs, stmt.path))
        failAst(file, stmt.span, `unique attribute ${stmt.path}`, stmt.path);
      attrs[stmt.path] = readAssignEntry(stmt, file);
    } else if (stmt.kind === 'named-block' || stmt.kind === 'bare') nested.push(stmt);
    else failAst(file, stmt.span, 'property or nested block', stmt.kind);
  }
  return { attrs, nested };
};

const readBoundedInt = (
  file: string,
  span: SourceSpan,
  entry: AttrEntry,
  name: string,
  max: number,
): number => {
  const v = asInt(file, span, entry, name);
  if (v < 1 || v > max) failAst(file, span, `${name} within 1..${max}`, `${v}`);
  return v;
};

const readBoundedPropSize = (
  file: string,
  span: SourceSpan,
  entry: AttrEntry,
): [number, number] => {
  const [w, d] = asIntVec2(file, span, entry, 'size');
  if (w < 1 || d < 1 || w > MAX_STRUCTURE_DIM || d > MAX_STRUCTURE_DIM) {
    failAst(file, span, `prop size within 1..${MAX_STRUCTURE_DIM}`, `(${w}, ${d})`);
  }
  return [w, d];
};

const readPropGeometryAttrs = (
  attrs: Record<string, AttrEntry>,
  file: string,
  span: SourceSpan,
): Partial<InteriorPropAst> => {
  const out: {
    at?: InteriorPropAst['at'];
    size?: InteriorPropAst['size'];
    length?: number;
    facing?: InteriorPropAst['facing'];
    seat_count?: number;
    auto_join?: boolean;
    rotation_deg?: number;
    organic_jitter?: number;
  } = {};
  if (attrs.at) out.at = asNumVec3(file, span, attrs.at, 'at');
  if (attrs.size) out.size = readBoundedPropSize(file, span, attrs.size);
  if (attrs.length)
    out.length = readBoundedInt(file, span, attrs.length, 'length', MAX_STRUCTURE_DIM);
  if (attrs.facing) out.facing = asFacing(file, span, attrs.facing);
  const seatsEntry = attrs.seat_count ?? attrs.seats;
  if (seatsEntry && typeof seatsEntry.value === 'number') {
    out.seat_count = readBoundedInt(file, span, seatsEntry, 'seats', MAX_STRUCTURE_DIM * 2);
  }
  if (attrs.auto_join) out.auto_join = asBool(file, span, attrs.auto_join, 'auto_join');
  if (attrs.rotation_deg) out.rotation_deg = asNum(file, span, attrs.rotation_deg, 'rotation_deg');
  if (attrs.organic_jitter) {
    out.organic_jitter = asNum(file, span, attrs.organic_jitter, 'organic_jitter');
  }
  return out;
};

const readPropMetaAttrs = (
  attrs: Record<string, AttrEntry>,
  file: string,
  span: SourceSpan,
): Partial<InteriorPropAst> => {
  const out: {
    style_override?: InteriorArchKind;
    mount_on?: string;
    asset_alias?: string;
    variant?: string;
    drop?: number;
    color?: string;
    on?: InteriorAnchor;
  } = {};
  const styleRaw = asOptStr(file, span, attrs.style_override ?? attrs.style, 'style');
  if (styleRaw) {
    if (!ARCHES.has(styleRaw)) failAst(file, span, 'style_dna arch', styleRaw);
    out.style_override = styleRaw as InteriorArchKind;
  }
  const assetAlias = asOptStr(file, span, attrs.asset_alias ?? attrs.asset, 'asset');
  if (assetAlias) out.asset_alias = assetAlias;
  if (attrs.mount_on) out.mount_on = asStr(file, span, attrs.mount_on, 'mount_on');
  if (attrs.variant) out.variant = asStr(file, span, attrs.variant, 'variant');
  if (attrs.drop) out.drop = asNum(file, span, attrs.drop, 'drop');
  if (attrs.color) out.color = asStr(file, span, attrs.color, 'color');
  if (attrs.on) out.on = asAnchor(file, span, attrs.on);
  return out;
};

/** Parses an interior prop directive from normalized attribute entries. */
export const parsePropFromParts = (
  kind: string,
  name: string | null,
  attrs: Record<string, AttrEntry>,
  file: string,
  span: SourceSpan,
  seq: { count: number },
): InteriorPropAst => {
  assertAllowedAttrs(file, span, attrs, PROP_ALLOWED_KEYS);
  const resolvedKind = kind === 'prop' ? asStr(file, span, attrs.kind, 'kind') : kind;
  return {
    id: nextId(seq, resolvedKind, name),
    kind: resolvedKind,
    ...readPropGeometryAttrs(attrs, file, span),
    ...readPropMetaAttrs(attrs, file, span),
  };
};
