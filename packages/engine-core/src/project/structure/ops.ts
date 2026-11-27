import type { AshfoxBlock, AshfoxNamedBlock, AshfoxStatement } from '../program/syntax/blockAst';
import type { MirrorAxis, RepeatAxis, StructureOp } from './contract';
import {
  parseFacadeOp,
  parseFurnishOp,
  parseRoofOp,
  parseStaircaseOp,
  parseWeatheringOp,
} from './feature';
import { parseInteriorOp } from './interior';
import {
  asFacing,
  asInt,
  asOptFacing,
  asOptStr,
  asRotate,
  asScalar,
  asStr,
  asVec2,
  asVec3,
  assertAllowedAttrs,
  failAst,
  parseFloorJetty,
  pickOptStrs,
  readAssignEntry,
  readBlockAssigns,
  splitBlockParts,
  type AttrEntry,
} from './grammar';

const SIMPLE_OPS = new Set(['set', 'carve', 'box', 'hollow', 'walls', 'frame']);
const HOOK_PASS_OPS = new Set(['volume', 'cue', 'meta', 'zone', 'mc_block', 'schema']);
const SOCKET_SCHEMAS = new Set(['std.entry', 'std.road', 'std.wall_join', 'std.courtyard']);

const parseSimpleOp = (stmt: AshfoxNamedBlock, file: string): StructureOp => {
  const attrs = readBlockAssigns(stmt.block, file);
  const op = stmt.blockKind;
  if (op === 'set') {
    assertAllowedAttrs(file, stmt.span, attrs, new Set(['at', 'block', 'facing']));
    return {
      op: 'set',
      at: asVec3(file, stmt.span, attrs.at, 'at'),
      block: asStr(file, stmt.span, attrs.block, 'block'),
      facing: asOptFacing(file, stmt.span, attrs.facing),
    };
  }
  if (op === 'carve') {
    assertAllowedAttrs(file, stmt.span, attrs, new Set(['from', 'to']));
    return {
      op: 'carve',
      from: asVec3(file, stmt.span, attrs.from, 'from'),
      to: asVec3(file, stmt.span, attrs.to, 'to'),
    };
  }
  assertAllowedAttrs(file, stmt.span, attrs, new Set(['from', 'to', 'block']));
  return {
    op: op as 'box' | 'hollow' | 'walls' | 'frame',
    from: asVec3(file, stmt.span, attrs.from, 'from'),
    to: asVec3(file, stmt.span, attrs.to, 'to'),
    block: asStr(file, stmt.span, attrs.block, 'block'),
  };
};

const parsePlaceOp = (stmt: AshfoxNamedBlock, file: string): StructureOp => {
  if (!stmt.name) return failAst(file, stmt.span, 'place <prefab> { ... }', 'unnamed place');
  const attrs = readBlockAssigns(stmt.block, file);
  assertAllowedAttrs(file, stmt.span, attrs, new Set(['at', 'rotate']));
  return {
    op: 'place',
    prefab: stmt.name,
    at: asVec3(file, stmt.span, attrs.at, 'at'),
    rotate: asRotate(file, stmt.span, attrs.rotate),
  };
};

const parseCompoundPlaceOp = (stmt: AshfoxNamedBlock, file: string): StructureOp => {
  if (!stmt.name) return failAst(file, stmt.span, 'compound_place <alias> { ... }', 'unnamed');
  const attrs = readBlockAssigns(stmt.block, file);
  assertAllowedAttrs(file, stmt.span, attrs, new Set(['at', 'rotate']));
  return {
    op: 'compound_place',
    alias: stmt.name,
    at: asVec3(file, stmt.span, attrs.at, 'at'),
    rotate: asRotate(file, stmt.span, attrs.rotate),
  };
};

const parseLayerOp = (stmt: AshfoxNamedBlock, file: string): StructureOp => {
  const { attrs, blocks } = splitBlockParts(stmt.block, file);
  assertAllowedAttrs(file, stmt.span, attrs, new Set(['y', 'origin', 'rows']));
  const rawRows = attrs.rows?.value;
  if (!Array.isArray(rawRows) || rawRows.some((r) => typeof r !== 'string')) {
    return failAst(file, attrs.rows?.span ?? stmt.span, 'rows = ["..."]', String(rawRows));
  }
  const mapBlock = blocks.find((b) => b.blockKind === 'map' && b.name === null);
  if (!mapBlock || blocks.length !== 1) {
    return failAst(file, stmt.span, 'map { ... } inside layer', 'missing or extra block');
  }
  const mapAttrs = readBlockAssigns(mapBlock.block, file);
  const map: Record<string, string> = {};
  for (const [ch, entry] of Object.entries(mapAttrs)) {
    if (ch.length !== 1) return failAst(file, entry.span, 'single character map key', ch);
    map[ch] = asStr(file, entry.span, entry, ch);
  }
  return {
    op: 'layer',
    y: attrs.y ? asScalar(file, stmt.span, attrs.y, 'y') : 0,
    origin: attrs.origin ? asVec2(file, stmt.span, attrs.origin, 'origin') : [0, 0],
    rows: rawRows as string[],
    map,
  };
};

const extractRoomInterior = (
  ops: readonly StructureOp[],
  roomName: string,
  file: string,
  span: AshfoxNamedBlock['span'],
): Extract<StructureOp, { op: 'interior' }> | undefined => {
  let rawInterior: Extract<StructureOp, { op: 'interior' }> | undefined;
  for (const childOp of ops) {
    if (childOp.op === 'interior') {
      if (rawInterior) failAst(file, span, 'at most one interior { ... } block', 'interior');
      rawInterior = childOp;
    } else if (childOp.op !== 'hook_decl' && childOp.op !== 'anchor') {
      failAst(file, span, 'optional interior { ... } or hook blocks', childOp.op);
    }
  }
  return rawInterior ? { ...rawInterior, room: rawInterior.room ?? roomName } : undefined;
};

const parseRoomOp = (stmt: AshfoxNamedBlock, file: string, depth: number): StructureOp => {
  if (!stmt.name) return failAst(file, stmt.span, 'room <name> { ... }', 'unnamed room');
  const { attrs, ops } = splitOpContainer(stmt.block, file, depth);
  assertAllowedAttrs(
    file,
    stmt.span,
    attrs,
    new Set(['from', 'size', 'kind', 'shape', 'plinth', 'floor', 'wall', 'frame', 'ceiling']),
  );
  const schema = stmt.typeRef ?? undefined;
  const kind =
    asOptStr(file, stmt.span, attrs.kind, 'kind') ??
    (schema === 'std.courtyard' ? 'courtyard' : 'room');
  const shape = asOptStr(file, stmt.span, attrs.shape, 'shape');
  if (shape !== undefined && shape !== 'rect' && shape !== 'octagon') {
    failAst(file, attrs.shape?.span ?? stmt.span, 'shape = rect|octagon', shape, [
      'rect',
      'octagon',
    ]);
  }
  const interior = extractRoomInterior(ops, stmt.name, file, stmt.span);
  return {
    op: 'room',
    name: stmt.name,
    from: asVec2(file, stmt.span, attrs.from, 'from'),
    size: asVec2(file, stmt.span, attrs.size, 'size'),
    kind,
    ...(schema ? { schema } : {}),
    ...(shape ? { shape: shape as 'rect' | 'octagon' } : {}),
    ...pickOptStrs(file, stmt.span, attrs, [
      ['plinth', 'plinth'],
      ['floor', 'floor'],
      ['wall', 'wall'],
      ['frame', 'frame'],
      ['ceiling', 'ceiling'],
    ]),
    ...(interior ? { interior } : {}),
  };
};

const parseAnchorOp = (stmt: AshfoxNamedBlock, file: string): StructureOp => {
  if (!stmt.name || !stmt.typeRef) {
    return failAst(file, stmt.span, 'anchor <name> : <schema> { ... }', stmt.name ?? 'unnamed');
  }
  if (!SOCKET_SCHEMAS.has(stmt.typeRef)) return { op: 'hook_decl' };
  const attrs = readBlockAssigns(stmt.block, file);
  const hasFacingOrWall = attrs.facing !== undefined || attrs.wall !== undefined;
  if (attrs.at === undefined && (attrs.room === undefined || !hasFacingOrWall)) {
    failAst(file, stmt.span, 'anchor at or room/facing', 'missing');
  }
  return {
    op: 'anchor',
    name: stmt.name,
    schema: stmt.typeRef,
    ...(attrs.at ? { at: asVec3(file, stmt.span, attrs.at, 'at') } : {}),
    ...(attrs.wall ? { wall: asFacing(file, stmt.span, attrs.wall) } : {}),
    ...(attrs.facing ? { facing: asFacing(file, stmt.span, attrs.facing) } : {}),
    ...pickOptStrs(file, stmt.span, attrs, [
      ['room', 'room'],
      ['pool', 'pool'],
      ['target', 'target'],
    ]),
  };
};

const splitOpContainer = (
  block: AshfoxBlock,
  file: string,
  depth: number,
): { readonly attrs: Record<string, AttrEntry>; readonly ops: readonly StructureOp[] } => {
  const attrs: Record<string, AttrEntry> = {};
  const ops: StructureOp[] = [];
  for (const child of block.statements) {
    if (child.kind === 'assign') {
      if (Object.hasOwn(attrs, child.path)) {
        failAst(file, child.span, `unique attribute ${child.path}`, child.path);
      }
      attrs[child.path] = readAssignEntry(child, file);
    } else if (child.kind === 'named-block') {
      ops.push(parseSingleOp(child, file, depth + 1));
    } else if (child.kind === 'bare' && child.stmtKind === 'mc_block') {
      ops.push({ op: 'hook_decl' });
    } else {
      failAst(file, child.span, 'property or operation', child.kind);
    }
  }
  return { attrs, ops };
};

const parseFloorOp = (stmt: AshfoxNamedBlock, file: string, depth: number): StructureOp => {
  if (!stmt.name) return failAst(file, stmt.span, 'floor <name> { ... }', 'unnamed floor');
  const { attrs, ops } = splitOpContainer(stmt.block, file, depth);
  assertAllowedAttrs(
    file,
    stmt.span,
    attrs,
    new Set(['y', 'height', 'jetty', 'jetty_n', 'jetty_s', 'jetty_e', 'jetty_w']),
  );
  const jetty = parseFloorJetty(file, stmt.span, attrs);
  return {
    op: 'floor',
    name: stmt.name,
    y: asScalar(file, stmt.span, attrs.y, 'y'),
    height: asScalar(file, stmt.span, attrs.height, 'height'),
    ...(jetty ? { jetty } : {}),
    ops,
  };
};

const parseRepeatOrMirror = (stmt: AshfoxNamedBlock, file: string, depth: number): StructureOp => {
  const { attrs, ops } = splitOpContainer(stmt.block, file, depth);
  if (stmt.blockKind === 'repeat') {
    assertAllowedAttrs(file, stmt.span, attrs, new Set(['axis', 'count', 'step']));
    const axis = attrs.axis?.value;
    if (axis !== 'x' && axis !== 'y' && axis !== 'z')
      failAst(file, attrs.axis?.span ?? stmt.span, 'axis=x|y|z', String(axis ?? ''), [
        'x',
        'y',
        'z',
      ]);
    const count = asInt(file, stmt.span, attrs.count, 'count');
    const step = attrs.step ? asInt(file, stmt.span, attrs.step, 'step') : 1;
    if (count < 1 || count > 64 || step === 0) {
      failAst(file, stmt.span, 'count 1..64 and non-zero step', `${count}/${step}`);
    }
    return { op: 'repeat', axis: axis as RepeatAxis, count, step, ops };
  }
  assertAllowedAttrs(file, stmt.span, attrs, new Set(['axis', 'center']));
  const axis = attrs.axis?.value;
  if (axis !== 'x' && axis !== 'z')
    failAst(file, attrs.axis?.span ?? stmt.span, 'axis = x|z', String(axis), ['x', 'z']);
  return {
    op: 'mirror',
    axis: axis as MirrorAxis,
    center: asInt(file, stmt.span, attrs.center, 'center'),
    ops,
  };
};

export const STRUCTURE_OP_KINDS = new Set([
  'set',
  'carve',
  'box',
  'hollow',
  'walls',
  'frame',
  'roof',
  'place',
  'layer',
  'room',
  'facade',
  'staircase',
  'furnish',
  'weathering',
  'anchor',
  'volume',
  'cue',
  'meta',
  'zone',
  'mc_block',
  'schema',
  'compound_place',
  'floor',
  'repeat',
  'mirror',
  'interior',
]);

export const parseSingleOp = (stmt: AshfoxNamedBlock, file: string, depth: number): StructureOp => {
  if (depth > 12) failAst(file, stmt.span, 'structure nesting <= 12', 'deep op');
  const kw = stmt.blockKind;
  if (SIMPLE_OPS.has(kw)) return parseSimpleOp(stmt, file);
  if (HOOK_PASS_OPS.has(kw)) return { op: 'hook_decl' };
  const leaf: Readonly<Record<string, (s: AshfoxNamedBlock, f: string) => StructureOp>> = {
    roof: parseRoofOp,
    place: parsePlaceOp,
    layer: parseLayerOp,
    facade: parseFacadeOp,
    staircase: parseStaircaseOp,
    furnish: parseFurnishOp,
    weathering: parseWeatheringOp,
    anchor: parseAnchorOp,
    compound_place: parseCompoundPlaceOp,
    interior: parseInteriorOp,
  };
  if (kw in leaf) return leaf[kw]!(stmt, file);
  if (kw === 'room') return parseRoomOp(stmt, file, depth);
  if (kw === 'floor') return parseFloorOp(stmt, file, depth);
  if (kw === 'repeat' || kw === 'mirror') return parseRepeatOrMirror(stmt, file, depth);
  return failAst(file, stmt.span, 'structure operation', kw, [...STRUCTURE_OP_KINDS]);
};

export const parseOpStatements = (
  statements: readonly AshfoxStatement[],
  file: string,
  depth = 0,
): readonly StructureOp[] =>
  statements.map((stmt) => {
    if (stmt.kind === 'bare' && stmt.stmtKind === 'mc_block') return { op: 'hook_decl' };
    if (stmt.kind !== 'named-block')
      return failAst(file, stmt.span, 'structure operation block', stmt.kind);
    return parseSingleOp(stmt, file, depth + 1);
  });
