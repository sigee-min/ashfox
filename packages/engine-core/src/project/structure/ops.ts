import { type ProgramToken } from '../program/syntax/lex';
import {
  StructureInputError,
  type BlockRotation,
  type CardinalFacing,
  type Cursor,
  type IntVec2,
  type IntVec3,
  type MirrorAxis,
  type RepeatAxis,
  type RoofStyle,
  type StructureOp,
} from './contract';

export const peek = (cursor: Cursor): ProgramToken => cursor.tokens[cursor.offset]!;

export const failSyntax = (cursor: Cursor, expected: string): never => {
  const token = peek(cursor);
  throw new StructureInputError({
    code: 'structure.syntax',
    file: cursor.file,
    pointer: `line:${token.span.start.line}:${token.span.start.column}`,
    expected,
    actual: token.value || 'EOF',
  });
};

export const take = (cursor: Cursor, expected?: string): ProgramToken => {
  const token = peek(cursor);
  if (expected !== undefined && token.value !== expected) failSyntax(cursor, expected);
  if (token.kind === 'eof') failSyntax(cursor, expected ?? 'token');
  cursor.offset += 1;
  return token;
};

export const readName = (cursor: Cursor): string => {
  const token = peek(cursor);
  if (token.kind !== 'identifier' || !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(token.value)) {
    failSyntax(cursor, 'identifier');
  }
  return take(cursor).value;
};

export const readQualified = (cursor: Cursor): string => {
  let out = readName(cursor);
  while (peek(cursor).value === '.') {
    take(cursor, '.');
    out += `.${readName(cursor)}`;
  }
  return out;
};

export const readInt = (cursor: Cursor): number => {
  let sign = 1;
  if (peek(cursor).value === '-') {
    take(cursor, '-');
    sign = -1;
  }
  const token = peek(cursor);
  if (token.kind !== 'number' || !/^\d+$/u.test(token.value)) failSyntax(cursor, 'integer');
  take(cursor);
  return sign * Number.parseInt(token.value, 10);
};

export const readVec3 = (cursor: Cursor): IntVec3 => {
  take(cursor, '(');
  const x = readInt(cursor);
  take(cursor, ',');
  const y = readInt(cursor);
  take(cursor, ',');
  const z = readInt(cursor);
  take(cursor, ')');
  return [x, y, z];
};

const readVec2 = (cursor: Cursor): IntVec2 => {
  take(cursor, '(');
  const x = readInt(cursor);
  take(cursor, ',');
  const z = readInt(cursor);
  take(cursor, ')');
  return [x, z];
};

const readString = (cursor: Cursor): string => {
  if (peek(cursor).kind !== 'string') failSyntax(cursor, 'string literal');
  return take(cursor).value;
};

const readAttrValue = (cursor: Cursor): unknown => {
  const next = peek(cursor);
  if (next.value === '(') return readVec3(cursor);
  if (next.kind === 'string') return take(cursor).value;
  if (next.kind === 'number' || next.value === '-') return readInt(cursor);
  if (next.kind === 'identifier') return readQualified(cursor);
  return failSyntax(cursor, 'attribute value');
};

const readAttrsUntil = (cursor: Cursor, end: string): Record<string, unknown> => {
  const attrs: Record<string, unknown> = {};
  while (peek(cursor).value !== end) {
    const key = readName(cursor);
    if (key in attrs) failSyntax(cursor, `unique attribute ${key}`);
    take(cursor, '=');
    attrs[key] = readAttrValue(cursor);
  }
  return attrs;
};

const asVec3 = (cursor: Cursor, value: unknown, name: string): IntVec3 => {
  if (!Array.isArray(value) || value.length !== 3) failSyntax(cursor, `${name} = (x, y, z)`);
  return value as IntVec3;
};

const asStr = (cursor: Cursor, value: unknown, expected: string): string => {
  if (typeof value !== 'string' || !value) failSyntax(cursor, expected);
  return value as string;
};

const asFacing = (cursor: Cursor, value: unknown): CardinalFacing | undefined => {
  if (value === undefined) return undefined;
  if (value === 'north' || value === 'south' || value === 'east' || value === 'west') return value;
  return failSyntax(cursor, 'north|south|east|west');
};

const asRotate = (cursor: Cursor, value: unknown): BlockRotation => {
  if (value === undefined) return 0;
  if (value === 0 || value === 90 || value === 180 || value === 270) return value;
  return failSyntax(cursor, 'rotate = 0|90|180|270');
};

const parseSimpleOp = (cursor: Cursor, op: string): StructureOp => {
  const attrs = readAttrsUntil(cursor, ';');
  take(cursor, ';');
  if (op === 'set') {
    return {
      op: 'set',
      at: asVec3(cursor, attrs.at, 'at'),
      block: asStr(cursor, attrs.block, 'block = key'),
      facing: asFacing(cursor, attrs.facing),
    };
  }
  if (op === 'carve') {
    return {
      op: 'carve',
      from: asVec3(cursor, attrs.from, 'from'),
      to: asVec3(cursor, attrs.to, 'to'),
    };
  }
  return {
    op: op as 'box' | 'hollow' | 'walls' | 'frame',
    from: asVec3(cursor, attrs.from, 'from'),
    to: asVec3(cursor, attrs.to, 'to'),
    block: asStr(cursor, attrs.block, 'block = key'),
  };
};

const parseRoofOp = (cursor: Cursor): StructureOp => {
  const attrs = readAttrsUntil(cursor, ';');
  take(cursor, ';');
  const style = attrs.style;
  if (style !== 'gable' && style !== 'hip' && style !== 'pyramid') {
    failSyntax(cursor, 'roof style = gable|hip|pyramid');
  }
  const axis = attrs.axis ?? 'x';
  if (axis !== 'x' && axis !== 'z') failSyntax(cursor, 'roof axis = x|z');
  return {
    op: 'roof',
    style: style as RoofStyle,
    axis: axis as MirrorAxis,
    from: asVec3(cursor, attrs.from, 'from'),
    to: asVec3(cursor, attrs.to, 'to'),
    stair: asStr(cursor, attrs.stair, 'stair = key_or_state'),
    ridge: asStr(cursor, attrs.ridge, 'ridge = key_or_state'),
    ...(attrs.gable !== undefined ? { gable: asStr(cursor, attrs.gable, 'gable = key') } : {}),
  };
};

const parsePlaceOp = (cursor: Cursor): StructureOp => {
  const prefab = readQualified(cursor);
  const attrs = readAttrsUntil(cursor, ';');
  take(cursor, ';');
  return {
    op: 'place',
    prefab,
    at: asVec3(cursor, attrs.at, 'at'),
    rotate: asRotate(cursor, attrs.rotate),
  };
};

const readCharKey = (cursor: Cursor): string => {
  const token = peek(cursor);
  if ((token.kind === 'identifier' || token.kind === 'number') && token.value.length === 1) {
    return take(cursor).value;
  }
  return failSyntax(cursor, 'single character key');
};

const parseLayerOp = (cursor: Cursor): StructureOp => {
  let y = 0;
  let origin: IntVec2 = [0, 0];
  while (peek(cursor).value !== '{') {
    const key = readName(cursor);
    take(cursor, '=');
    if (key === 'y') y = readInt(cursor);
    else if (key === 'origin') origin = readVec2(cursor);
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

export const parseOpBlock = (cursor: Cursor, depth: number): readonly StructureOp[] => {
  if (depth > 12) failSyntax(cursor, 'structure nesting <= 12');
  take(cursor, '{');
  const ops: StructureOp[] = [];
  while (peek(cursor).value !== '}') ops.push(parseSingleOp(cursor, depth + 1));
  take(cursor, '}');
  return ops;
};

const parseRepeatOp = (cursor: Cursor, depth: number): StructureOp => {
  const attrs = readAttrsUntil(cursor, '{');
  const axis = attrs.axis;
  if (axis !== 'x' && axis !== 'y' && axis !== 'z') failSyntax(cursor, 'axis = x|y|z');
  const count = Number(attrs.count);
  const step = attrs.step === undefined ? 1 : Number(attrs.step);
  if (!Number.isSafeInteger(count) || count < 1 || count > 64) failSyntax(cursor, 'count 1..64');
  if (!Number.isSafeInteger(step) || step === 0) failSyntax(cursor, 'non-zero integer step');
  return { op: 'repeat', axis: axis as RepeatAxis, count, step, ops: parseOpBlock(cursor, depth) };
};

const parseMirrorOp = (cursor: Cursor, depth: number): StructureOp => {
  const attrs = readAttrsUntil(cursor, '{');
  const axis = attrs.axis;
  if (axis !== 'x' && axis !== 'z') failSyntax(cursor, 'axis = x|z');
  if (typeof attrs.center !== 'number') return failSyntax(cursor, 'center = <int>');
  return {
    op: 'mirror',
    axis: axis as MirrorAxis,
    center: attrs.center,
    ops: parseOpBlock(cursor, depth),
  };
};

const parseSingleOp = (cursor: Cursor, depth: number): StructureOp => {
  const keyword = readName(cursor);
  if (
    keyword === 'set' ||
    keyword === 'carve' ||
    ['box', 'hollow', 'walls', 'frame'].includes(keyword)
  ) {
    return parseSimpleOp(cursor, keyword);
  }
  if (keyword === 'roof') return parseRoofOp(cursor);
  if (keyword === 'place') return parsePlaceOp(cursor);
  if (keyword === 'layer') return parseLayerOp(cursor);
  if (keyword === 'repeat') return parseRepeatOp(cursor, depth);
  if (keyword === 'mirror') return parseMirrorOp(cursor, depth);
  return failSyntax(cursor, 'structure operation');
};
