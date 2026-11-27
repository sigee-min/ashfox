import { deepFreeze } from '../../immutable';
import {
  lowerAssignOutputs,
  lowerOutputsFromBlock,
  lowerPreviewFromBlock,
  type RawDeclaredOutput,
  type RawDeclaredPreview,
} from '../directory/declarations';
import type {
  AshfoxAssignStmt,
  AshfoxBlock,
  AshfoxExpr,
  AshfoxNamedBlock,
  AshfoxStatement,
  AshfoxUnit,
} from '../program/syntax/blockAst';
import {
  HOOK_PASS_KINDS,
  addUniqueImport,
  assertSimpleAssign,
  createDomainFail,
  decodeUnitNumber,
  isHookPassBare,
  parseAshfoxTop,
} from '../program/syntax/blockLowering';
import type { SourceSpan } from '../source/contract';
import { parseHooksSource } from '../../hooks/parse';
import { collectUsedHookAliases } from '../../hooks/resolve';
import { ASHFOX_UNITS } from '../source/suggest';
import { SpriteInputError } from './contract';

export interface SpriteSourceUnit {
  readonly kind: 'sprite' | 'module';
  readonly id: string;
  readonly imports: readonly { readonly path: string; readonly alias: string }[];
  readonly hookAliases?: readonly string[];
  readonly outputs: readonly RawDeclaredOutput[];
  readonly previews: readonly RawDeclaredPreview[];
  readonly masks: readonly Record<string, unknown>[];
  readonly materials: readonly Record<string, unknown>[];
  readonly stamps: readonly Record<string, unknown>[];
  readonly item: Readonly<Record<string, unknown>> | null;
}

interface ParsedMembers {
  readonly file: string;
  readonly kind: 'sprite' | 'module';
  readonly imports: { path: string; alias: string }[];
  readonly aliases: Set<string>;
  readonly outputs: RawDeclaredOutput[];
  readonly previews: RawDeclaredPreview[];
  readonly masks: Record<string, unknown>[];
  readonly materials: Record<string, unknown>[];
  readonly stamps: Record<string, unknown>[];
  readonly item: Record<string, unknown>;
}

const LAYER_OPS = new Set(['fill', 'part', 'paint', 'erase', 'stamp', 'outline', 'pattern']);
const SHAPE_KINDS = new Set(['rect', 'ellipse', 'circle', 'capsule', 'polygon', 'line']);
const DECL_KINDS = new Set(['mask', 'material', 'stamp']);

const SPRITE_PLAIN_UNITS: ReadonlySet<AshfoxUnit> = new Set(['plain', 'ratio']);
const SPRITE_PIXEL_UNITS: ReadonlySet<AshfoxUnit> = new Set(['plain', 'texel']);

const PIXEL_KEYS = new Set([
  'at',
  'from',
  'to',
  'canvas',
  'axis',
  'x',
  'y',
  'width',
  'height',
  'cx',
  'cy',
  'rx',
  'ry',
  'r',
  'x1',
  'y1',
  'x2',
  'y2',
  'radius',
  'thickness',
  'points',
  'period',
  'scale',
  'edge_width',
  'mortar',
  'joint',
  'stagger',
  'offset',
]);

const failSyntax = createDomainFail('sprite.syntax', 'sprite', (detail) => {
  throw new SpriteInputError(detail);
});

const exprNumber = (expr: AshfoxExpr, file: string, pixels: boolean, sign: number): number => {
  if (expr.kind !== 'number') {
    return failSyntax(file, expr.span, 'number', expr.kind);
  }
  if (expr.unit === 'texel' && !pixels) {
    return failSyntax(file, expr.span, 'unitless number', expr.text + expr.rawUnit);
  }
  if (expr.unit === 'ratio' && expr.rawUnit === '%' && pixels) {
    return failSyntax(file, expr.span, 'pixel literal', expr.text + '%');
  }
  const decoded = decodeUnitNumber(expr, pixels ? SPRITE_PIXEL_UNITS : SPRITE_PLAIN_UNITS);
  if (decoded.ok) return decoded.value * sign;
  return failSyntax(
    file,
    expr.span,
    pixels ? 'px or number' : 'unitless number',
    expr.rawUnit,
    pixels ? ['px'] : ASHFOX_UNITS,
  );
};

const exprToValue = (expr: AshfoxExpr, file: string, pixels: boolean, depth = 0): unknown => {
  if (depth > 16) failSyntax(file, expr.span, 'nesting <= 16', 'deep expression');
  if (expr.kind === 'number') return exprNumber(expr, file, pixels, 1);
  if (expr.kind === 'unary' && expr.operand.kind === 'number') {
    return exprNumber(expr.operand, file, pixels, expr.operator === '-' ? -1 : 1);
  }
  if (expr.kind === 'string' || expr.kind === 'color' || expr.kind === 'boolean') {
    return expr.value;
  }
  if (expr.kind === 'path') return expr.value;
  if (expr.kind === 'tuple' || expr.kind === 'list') {
    return expr.elements.map((elem) => exprToValue(elem, file, pixels, depth + 1));
  }
  if (expr.kind === 'map') {
    const out: Record<string, unknown> = {};
    for (const entry of expr.entries) {
      out[entry.key] = exprToValue(entry.value, file, PIXEL_KEYS.has(entry.key), depth + 1);
    }
    return out;
  }
  return failSyntax(file, expr.span, 'literal value', expr.kind);
};

const readPairPoint = (val: unknown, file: string, span: SourceSpan): readonly [number, number] => {
  if (
    !Array.isArray(val) ||
    val.length !== 2 ||
    typeof val[0] !== 'number' ||
    typeof val[1] !== 'number'
  ) {
    return failSyntax(file, span, '(x, y) coordinates', String(val));
  }
  return [val[0], val[1]];
};

const normalizeShapeBlock = (
  kind: string,
  body: Record<string, unknown>,
  file: string,
  span: SourceSpan,
): Record<string, unknown> => {
  if (kind === 'circle') {
    const r = body.r ?? body.radius;
    const out: Record<string, unknown> = { kind: 'ellipse', cx: body.cx, cy: body.cy };
    if (r !== undefined) {
      out.rx = r;
      out.ry = r;
    }
    return out;
  }
  if ((kind === 'capsule' || kind === 'line') && ('from' in body || 'to' in body)) {
    const [x1, y1] = readPairPoint(body.from, file, span);
    const [x2, y2] = readPairPoint(body.to, file, span);
    const out: Record<string, unknown> = { kind, ...body, x1, y1, x2, y2 };
    delete out.from;
    delete out.to;
    return out;
  }
  return { kind, ...body };
};

const deriveCylinderAxis = (
  shape: Readonly<Record<string, unknown>>,
  layerBody: Record<string, unknown>,
): void => {
  const shade = layerBody.shade;
  if (!shade || typeof shade !== 'object' || Array.isArray(shade)) return;
  const shadeRec = shade as Record<string, unknown>;
  if (shadeRec.form !== 'cylinder' || 'axis' in shadeRec) return;
  if (
    (shape.kind === 'capsule' || shape.kind === 'line') &&
    typeof shape.x1 === 'number' &&
    typeof shape.y1 === 'number' &&
    typeof shape.x2 === 'number' &&
    typeof shape.y2 === 'number'
  ) {
    shadeRec.axis = [
      [Math.round(shape.x1), Math.round(shape.y1)],
      [Math.round(shape.x2), Math.round(shape.y2)],
    ];
  }
};

const SHAPE_KEYS_BY_KIND: Readonly<Record<string, readonly string[]>> = {
  polygon: ['points'],
  rect: ['x', 'y', 'width', 'height'],
  ellipse: ['cx', 'cy', 'rx', 'ry'],
  circle: ['cx', 'cy', 'r', 'radius'],
  capsule: ['from', 'to', 'x1', 'y1', 'x2', 'y2', 'radius'],
  line: ['from', 'to', 'x1', 'y1', 'x2', 'y2', 'thickness'],
};

const addSubblockField = (
  key: 'pattern' | 'grain',
  stmt: AshfoxNamedBlock,
  inner: Record<string, unknown>,
  record: Record<string, unknown>,
  file: string,
): void => {
  if (key === 'pattern' && !stmt.name) {
    failSyntax(file, stmt.span, 'pattern <kind> { ... }', 'unnamed pattern');
  }
  if (key in record) failSyntax(file, stmt.span, `unique ${key}`, `duplicate ${key}`);
  const tagged =
    key === 'pattern'
      ? { kind: stmt.name!, ...inner }
      : stmt.name
        ? { mode: stmt.name, ...inner }
        : inner;
  record[key] = tagged;
};

const lowerNamedSubblock = (
  stmt: AshfoxNamedBlock,
  record: Record<string, unknown>,
  file: string,
  depth: number,
): void => {
  if (stmt.typeRef || stmt.implementsRef || stmt.forRef) {
    failSyntax(file, stmt.span, 'plain block header', stmt.blockKind);
  }
  const inner = lowerBlock(stmt.block, file, depth + 1);
  if (stmt.blockKind === 'pattern' || stmt.blockKind === 'grain') {
    addSubblockField(stmt.blockKind, stmt, inner, record, file);
    return;
  }
  if (stmt.blockKind === 'patch') {
    if (!stmt.name) failSyntax(file, stmt.span, 'patch <id> { ... }', 'unnamed patch');
    const patches = Array.isArray(record.patches) ? (record.patches as unknown[]) : [];
    patches.push({ id: stmt.name, ...inner });
    record.patches = patches;
    return;
  }
  if (SHAPE_KINDS.has(stmt.blockKind) && stmt.name === null) {
    if ('shape' in record) failSyntax(file, stmt.span, 'unique shape', 'duplicate shape');
    record.shape = normalizeShapeBlock(stmt.blockKind, inner, file, stmt.span);
    return;
  }
  if (stmt.name !== null || Object.hasOwn(record, stmt.blockKind)) {
    failSyntax(file, stmt.span, 'unique unnamed property block', stmt.blockKind);
  }
  record[stmt.blockKind] = inner;
};

const lowerAssign = (
  stmt: AshfoxAssignStmt,
  record: Record<string, unknown>,
  file: string,
): void => {
  assertSimpleAssign(stmt, file, failSyntax);
  if (Object.hasOwn(record, stmt.path)) {
    failSyntax(file, stmt.span, 'unique property ' + stmt.path, stmt.path);
  }
  record[stmt.path] = exprToValue(stmt.value, file, PIXEL_KEYS.has(stmt.path));
};

const lowerBlock = (block: AshfoxBlock, file: string, depth = 0): Record<string, unknown> => {
  if (depth > 16) failSyntax(file, block.span, 'nesting <= 16', 'deep block');
  const record: Record<string, unknown> = {};
  for (const stmt of block.statements) {
    if (stmt.kind === 'assign') lowerAssign(stmt, record, file);
    else if (stmt.kind === 'named-block') lowerNamedSubblock(stmt, record, file, depth);
    else failSyntax(file, stmt.span, 'assignment or block', stmt.kind);
  }
  return record;
};

const addExportedDecl = (members: ParsedMembers, decl: AshfoxNamedBlock): void => {
  if (!DECL_KINDS.has(decl.blockKind) || !decl.name || decl.typeRef) {
    failSyntax(members.file, decl.span, 'mask, material, or stamp declaration', decl.blockKind);
  }
  const record = lowerBlock(decl.block, members.file);
  if (Object.hasOwn(record, 'id')) {
    failSyntax(members.file, decl.span, 'declaration-owned id', 'id');
  }
  const entry = { id: decl.name!, ...record };
  if (decl.blockKind === 'mask') members.masks.push(entry);
  else if (decl.blockKind === 'material') members.materials.push(entry);
  else members.stamps.push(entry);
};

const addShapeLayer = (members: ParsedMembers, stmt: AshfoxNamedBlock): void => {
  if (!stmt.name) failSyntax(members.file, stmt.span, 'named shape layer', stmt.blockKind);
  const body = lowerBlock(stmt.block, members.file);
  if ('id' in body || 'op' in body) {
    failSyntax(members.file, stmt.span, 'declaration-owned layer id and op', 'id/op');
  }
  const shapeKeys = new Set(SHAPE_KEYS_BY_KIND[stmt.blockKind] ?? []);
  const shapeInput: Record<string, unknown> = {};
  const layerBody: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    if (shapeKeys.has(k)) shapeInput[k] = v;
    else layerBody[k] = v;
  }
  const shape = normalizeShapeBlock(stmt.blockKind, shapeInput, members.file, stmt.span);
  deriveCylinderAxis(shape, layerBody);
  (members.item.layers as unknown[]).push({ id: stmt.name, op: 'shape', shape, ...layerBody });
};

const addLayerBlock = (members: ParsedMembers, stmt: AshfoxNamedBlock): void => {
  if (!stmt.name) failSyntax(members.file, stmt.span, 'named layer', stmt.blockKind);
  const body = lowerBlock(stmt.block, members.file);
  if ('id' in body || 'op' in body) {
    failSyntax(members.file, stmt.span, 'declaration-owned layer id and op', 'id/op');
  }
  (members.item.layers as unknown[]).push({ id: stmt.name, op: stmt.blockKind, ...body });
};

const isStampLayerBlock = (stmt: AshfoxNamedBlock): boolean =>
  stmt.blockKind === 'stamp' &&
  stmt.block.statements.some((s) => s.kind === 'assign' && s.path === 'stamp');

const handleTopNamedBlock = (members: ParsedMembers, stmt: AshfoxNamedBlock): void => {
  if (HOOK_PASS_KINDS.has(stmt.blockKind)) return;
  if (stmt.blockKind === 'outputs' && stmt.name === null) {
    if (members.kind !== 'sprite') failSyntax(members.file, stmt.span, 'export decl', 'outputs');
    members.outputs.push(...lowerOutputsFromBlock(stmt.block, members.file));
    return;
  }
  if (stmt.blockKind === 'preview') {
    if (members.kind !== 'sprite') failSyntax(members.file, stmt.span, 'export decl', 'preview');
    members.previews.push(lowerPreviewFromBlock(stmt, members.file));
    return;
  }
  if (members.kind === 'module') {
    failSyntax(members.file, stmt.span, 'export mask/material/stamp declaration', stmt.blockKind);
  }
  if (DECL_KINDS.has(stmt.blockKind) && !isStampLayerBlock(stmt)) {
    addExportedDecl(members, stmt);
    return;
  }
  if (SHAPE_KINDS.has(stmt.blockKind)) {
    addShapeLayer(members, stmt);
    return;
  }
  if (LAYER_OPS.has(stmt.blockKind)) {
    addLayerBlock(members, stmt);
    return;
  }
  if (stmt.name !== null || Object.hasOwn(members.item, stmt.blockKind)) {
    failSyntax(members.file, stmt.span, 'unique sprite property', stmt.blockKind, [
      ...SHAPE_KINDS,
      ...LAYER_OPS,
      ...DECL_KINDS,
      'outputs',
      'preview',
      'canvas',
      'item',
    ]);
  }
  members.item[stmt.blockKind] = lowerBlock(stmt.block, members.file);
};

const handleTopStatement = (members: ParsedMembers, stmt: AshfoxStatement): void => {
  if (stmt.kind === 'import') {
    addUniqueImport(members.imports, members.aliases, stmt, members.file, failSyntax);
    return;
  }
  if (stmt.kind === 'export') {
    if (stmt.declaration.blockKind === 'schema') return;
    addExportedDecl(members, stmt.declaration);
    return;
  }
  if (stmt.kind === 'assign') {
    if (members.kind === 'module') {
      failSyntax(members.file, stmt.span, 'export declaration', stmt.path);
    }
    if (stmt.path === 'outputs') {
      members.outputs.push(...lowerAssignOutputs(stmt, members.file));
      return;
    }
    lowerAssign(stmt, members.item, members.file);
    return;
  }
  if (stmt.kind === 'named-block') {
    handleTopNamedBlock(members, stmt);
    return;
  }
  if (isHookPassBare(stmt)) return;
  failSyntax(members.file, stmt.span, 'sprite declaration or property', stmt.stmtKind);
};

/** Native `ashfox 1` syntax for sprites and reusable sprite modules. */
export const parseSpriteSource = (source: string, file: string): SpriteSourceUnit => {
  const top = parseAshfoxTop(
    source,
    file,
    ['sprite', 'module'],
    (span, message) => {
      throw new SpriteInputError({
        code: 'sprite.syntax',
        file,
        pointer: `line:${span.start.line}:${span.start.column}`,
        expected: 'valid ashfox 1 sprite or module source',
        actual: message,
      });
    },
    failSyntax,
  );
  const kind: 'sprite' | 'module' = top.kind === 'sprite' ? 'sprite' : 'module';
  const members: ParsedMembers = {
    file,
    kind,
    imports: [],
    aliases: new Set(),
    outputs: [],
    previews: [],
    masks: [],
    materials: [],
    stamps: [],
    item: { id: top.name, layers: [] },
  };
  for (const stmt of top.block.statements) handleTopStatement(members, stmt);
  const hookAliases = [
    ...collectUsedHookAliases(parseHooksSource(source, file, { allowHostStatements: true }).unit),
  ];
  return deepFreeze({
    kind,
    id: top.name,
    imports: members.imports,
    ...(hookAliases.length > 0 ? { hookAliases } : {}),
    outputs: members.outputs,
    previews: members.previews,
    masks: members.masks,
    materials: members.materials,
    stamps: members.stamps,
    item: kind === 'sprite' ? members.item : null,
  });
};
