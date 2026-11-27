import { deepFreeze } from '../../immutable';
import {
  lowerAssignOutputs,
  lowerOutputsFromBlock,
  lowerPreviewFromBlock,
  type RawDeclaredOutput,
  type RawDeclaredPreview,
} from '../directory/declarations';
import { parseHooksSource } from '../../hooks/parse';
import { collectUsedHookAliases } from '../../hooks/resolve';
import type {
  AshfoxAssignStmt,
  AshfoxBlock,
  AshfoxExpr,
  AshfoxNamedBlock,
  AshfoxStatement,
} from '../program/syntax/blockAst';
import {
  addUniqueImport,
  assertSimpleAssign,
  isHookPassBare,
  parseAshfoxTop,
} from '../program/syntax/blockLowering';
import {
  DEFAULT_DATA_VERSION,
  DEFAULT_STRUCTURE_DENSITY,
  MAX_STRUCTURE_DIM,
  MAX_STRUCTURE_VOLUME,
  StructureInputError,
  type IntVec3,
  type StructureDensity,
  type StructureImport,
  type StructureOp,
  type StructurePaletteEntry,
  type StructureParamValue,
  type StructurePrefab,
  type StructureSourceUnit,
} from './contract';
import { evaluateScalarExpr } from './expr';
import { exprToNumber, exprToScalar, failAst } from './grammar';
import { STRUCTURE_OP_KINDS, parseOpStatements, parseSingleOp } from './ops';
import { formatBlockState, isValidMinecraftState, parseBlockState } from './state';

interface StructureDraft {
  readonly file: string;
  readonly kind: 'structure' | 'module';
  readonly imports: StructureImport[];
  readonly aliases: Set<string>;
  readonly outputs: RawDeclaredOutput[];
  readonly previews: RawDeclaredPreview[];
  readonly params: Record<string, StructureParamValue>;
  readonly palette: Record<string, StructurePaletteEntry>;
  readonly prefabs: StructurePrefab[];
  readonly prefabNames: Set<string>;
  readonly ops: StructureOp[];
  density: StructureDensity | null;
  seed: number | null;
  size: IntVec3 | null;
  dataVersion: number;
}

const readMixEntry = (
  expr: AshfoxExpr,
  file: string,
): { readonly state: string; readonly weight: number } => {
  if (expr.kind === 'string') {
    if (!isValidMinecraftState(expr.value))
      return failAst(file, expr.span, 'minecraft block state', expr.value);
    return { state: formatBlockState(parseBlockState(expr.value)), weight: 1 };
  }
  if (expr.kind === 'binary' && expr.operator === '*' && expr.left.kind === 'string') {
    if (!isValidMinecraftState(expr.left.value)) {
      return failAst(file, expr.left.span, 'minecraft block state', expr.left.value);
    }
    const weight = exprToNumber(expr.right, file, true);
    if (!Number.isFinite(weight) || weight <= 0) {
      return failAst(file, expr.right.span, 'positive mix weight', String(weight));
    }
    return { state: formatBlockState(parseBlockState(expr.left.value)), weight };
  }
  return failAst(file, expr.span, '"minecraft:..." [* weight]', expr.kind);
};

const readAssetPaletteEntry = (
  args: readonly AshfoxExpr[],
  file: string,
): StructurePaletteEntry => {
  const aliasExpr = args[0]!;
  if (aliasExpr.kind !== 'path' || aliasExpr.segments.length !== 1) {
    return failAst(file, aliasExpr.span, 'import alias', aliasExpr.kind);
  }
  let fallback = 'minecraft:oak_planks';
  const fallbackExpr = args[1];
  if (fallbackExpr) {
    if (fallbackExpr.kind !== 'string' || !isValidMinecraftState(fallbackExpr.value)) {
      return failAst(file, fallbackExpr.span, 'valid minecraft fallback state', fallbackExpr.kind);
    }
    fallback = fallbackExpr.value;
  }
  return {
    kind: 'asset',
    alias: aliasExpr.value,
    fallback: formatBlockState(parseBlockState(fallback)),
  };
};

const readPaletteExpr = (expr: AshfoxExpr, file: string): StructurePaletteEntry => {
  if (expr.kind === 'string') {
    if (!isValidMinecraftState(expr.value))
      return failAst(file, expr.span, 'minecraft block state', expr.value);
    return { kind: 'block', state: formatBlockState(parseBlockState(expr.value)) };
  }
  if (expr.kind === 'call' && expr.callee === 'mix' && expr.args.length > 0) {
    return { kind: 'mix', entries: expr.args.map((arg) => readMixEntry(arg, file)) };
  }
  if (
    expr.kind === 'call' &&
    expr.callee === 'asset' &&
    expr.args.length >= 1 &&
    expr.args.length <= 2
  ) {
    return readAssetPaletteEntry(expr.args, file);
  }
  return failAst(file, expr.span, 'minecraft state, mix(...), or asset(...)', expr.kind);
};

const readPalette = (block: AshfoxBlock, draft: StructureDraft): void => {
  for (const stmt of block.statements) {
    if (stmt.kind !== 'assign')
      return failAst(draft.file, stmt.span, 'palette key = value;', stmt.kind);
    assertSimpleAssign(stmt, draft.file, failAst, 'palette key = value;');
    if (stmt.path in draft.palette) {
      return failAst(draft.file, stmt.span, `unique palette key ${stmt.path}`, stmt.path);
    }
    draft.palette[stmt.path] = readPaletteExpr(stmt.value, draft.file);
  }
};

const readParams = (block: AshfoxBlock, draft: StructureDraft): void => {
  for (const stmt of block.statements) {
    if (stmt.kind !== 'assign')
      return failAst(draft.file, stmt.span, 'param key = value;', stmt.kind);
    assertSimpleAssign(stmt, draft.file, failAst, 'param key = value;');
    if (stmt.path in draft.params) {
      return failAst(draft.file, stmt.span, `unique param ${stmt.path}`, stmt.path);
    }
    if (stmt.value.kind === 'string' || stmt.value.kind === 'boolean') {
      draft.params[stmt.path] = stmt.value.value;
    } else {
      const scalar = exprToScalar(stmt.value, draft.file);
      draft.params[stmt.path] = evaluateScalarExpr(scalar, draft.params, draft.file, 'params');
    }
  }
};

const readSizeVec3 = (expr: AshfoxExpr, file: string): IntVec3 => {
  if (expr.kind !== 'tuple' || expr.elements.length !== 3) {
    return failAst(file, expr.span, 'size = (w, h, d)', expr.kind);
  }
  const [w, h, d] = expr.elements.map((el: AshfoxExpr) => exprToNumber(el, file)) as [
    number,
    number,
    number,
  ];
  if (
    !Number.isSafeInteger(w) ||
    !Number.isSafeInteger(h) ||
    !Number.isSafeInteger(d) ||
    w < 1 ||
    h < 1 ||
    d < 1 ||
    w > MAX_STRUCTURE_DIM ||
    h > MAX_STRUCTURE_DIM ||
    d > MAX_STRUCTURE_DIM ||
    w * h * d > MAX_STRUCTURE_VOLUME
  ) {
    failAst(
      file,
      expr.span,
      `size within 1..${MAX_STRUCTURE_DIM} and volume <= ${MAX_STRUCTURE_VOLUME}`,
      `(${w}, ${h}, ${d})`,
    );
  }
  return [w, h, d];
};

const SCALAR_HANDLERS: Readonly<
  Record<string, (stmt: AshfoxAssignStmt, draft: StructureDraft) => void>
> = {
  outputs: (stmt, draft) => draft.outputs.push(...lowerAssignOutputs(stmt, draft.file)),
  size: (stmt, draft) => {
    if (draft.size !== null) failAst(draft.file, stmt.span, 'single size', stmt.path);
    draft.size = readSizeVec3(stmt.value, draft.file);
  },
  density: (stmt, draft) => {
    if (draft.density !== null) failAst(draft.file, stmt.span, 'single density', stmt.path);
    const val = exprToNumber(stmt.value, draft.file);
    if (val !== 1 && val !== 2) failAst(draft.file, stmt.span, 'density = 1 or 2', String(val));
    draft.density = val as StructureDensity;
  },
  seed: (stmt, draft) => {
    if (draft.seed !== null) failAst(draft.file, stmt.span, 'single seed', stmt.path);
    const val = exprToNumber(stmt.value, draft.file);
    if (!Number.isSafeInteger(val)) failAst(draft.file, stmt.span, 'integer seed', String(val));
    draft.seed = val;
  },
  data_version: (stmt, draft) => {
    const val = exprToNumber(stmt.value, draft.file);
    if (!Number.isSafeInteger(val)) failAst(draft.file, stmt.span, 'integer data_version', '');
    draft.dataVersion = val;
  },
};

const readScalarAssign = (stmt: AshfoxAssignStmt, draft: StructureDraft): void => {
  const handler = SCALAR_HANDLERS[stmt.path];
  if (!handler)
    failAst(draft.file, stmt.span, 'size, density, seed, data_version, or outputs', stmt.path, [
      ...Object.keys(SCALAR_HANDLERS),
      'outputs',
    ]);
  handler(stmt, draft);
};

const addPrefabDecl = (stmt: AshfoxNamedBlock, exported: boolean, draft: StructureDraft): void => {
  if (!stmt.name) return failAst(draft.file, stmt.span, 'prefab <name> { ... }', 'unnamed');
  if (draft.kind === 'module' && !exported) {
    return failAst(draft.file, stmt.span, 'export prefab inside module', stmt.name);
  }
  if (draft.prefabNames.has(stmt.name)) {
    return failAst(draft.file, stmt.span, `unique prefab ${stmt.name}`, stmt.name);
  }
  draft.prefabNames.add(stmt.name);
  draft.prefabs.push({
    id: stmt.name,
    exported,
    ops: parseOpStatements(stmt.block.statements, draft.file),
  });
};

const readNamedDecl = (stmt: AshfoxNamedBlock, exported: boolean, draft: StructureDraft): void => {
  if (stmt.blockKind === 'schema') return;
  if (stmt.blockKind === 'prefab') return addPrefabDecl(stmt, exported, draft);
  if (!exported && stmt.blockKind === 'params' && stmt.name === null) {
    return readParams(stmt.block, draft);
  }
  if (!exported && stmt.blockKind === 'palette' && stmt.name === null) {
    return readPalette(stmt.block, draft);
  }
  if (exported || draft.kind === 'module') {
    failAst(draft.file, stmt.span, 'export prefab declaration', stmt.blockKind);
  }
  if (stmt.blockKind === 'outputs' && stmt.name === null) {
    draft.outputs.push(...lowerOutputsFromBlock(stmt.block, draft.file));
    return;
  }
  if (stmt.blockKind === 'preview') {
    draft.previews.push(lowerPreviewFromBlock(stmt, draft.file));
    return;
  }
  if (STRUCTURE_OP_KINDS.has(stmt.blockKind)) {
    draft.ops.push(parseSingleOp(stmt, draft.file, 0));
    return;
  }
  failAst(draft.file, stmt.span, 'structure declaration or operation', stmt.blockKind, [
    'prefab',
    'params',
    'palette',
    'outputs',
    'preview',
    ...STRUCTURE_OP_KINDS,
  ]);
};

const readTopMember = (stmt: AshfoxStatement, draft: StructureDraft): void => {
  if (stmt.kind === 'import') {
    addUniqueImport(draft.imports, draft.aliases, stmt, draft.file, failAst);
    return;
  }
  if (stmt.kind === 'export') {
    readNamedDecl(stmt.declaration, true, draft);
    return;
  }
  if (stmt.kind === 'assign') {
    if (draft.kind === 'module') failAst(draft.file, stmt.span, 'export prefab', stmt.path);
    readScalarAssign(stmt, draft);
    return;
  }
  if (stmt.kind === 'named-block') {
    readNamedDecl(stmt, false, draft);
    return;
  }
  if (isHookPassBare(stmt)) return;
  failAst(draft.file, stmt.span, 'structure statement', stmt.stmtKind);
};

export const parseStructureSource = (source: string, file: string): StructureSourceUnit => {
  const top = parseAshfoxTop(
    source,
    file,
    ['structure', 'module'],
    (span, message) => {
      throw new StructureInputError({
        code: 'structure.syntax',
        file,
        pointer: `line:${span.start.line}:${span.start.column}`,
        expected: 'valid ashfox 1 structure or module source',
        actual: message,
      });
    },
    failAst,
  );
  const kind: 'structure' | 'module' = top.kind;
  const draft: StructureDraft = {
    file,
    kind,
    imports: [],
    aliases: new Set(),
    outputs: [],
    previews: [],
    params: {},
    palette: {},
    prefabs: [],
    prefabNames: new Set(),
    ops: [],
    density: null,
    seed: null,
    size: null,
    dataVersion: DEFAULT_DATA_VERSION,
  };
  for (const stmt of top.block.statements) readTopMember(stmt, draft);
  if (draft.kind === 'structure' && (draft.size === null || draft.ops.length === 0)) {
    failAst(file, top.span, 'size and structure operations', 'missing');
  }
  const hookAliases = [
    ...collectUsedHookAliases(parseHooksSource(source, file, { allowHostStatements: true }).unit),
  ];
  return deepFreeze({
    kind: draft.kind,
    id: top.name,
    imports: draft.imports,
    ...(hookAliases.length > 0 ? { hookAliases } : {}),
    outputs: draft.outputs,
    previews: draft.previews,
    params: draft.params,
    density: draft.density ?? DEFAULT_STRUCTURE_DENSITY,
    seed: draft.seed ?? 1,
    size: draft.size,
    dataVersion: draft.dataVersion,
    palette: draft.palette,
    prefabs: draft.prefabs,
    ops: draft.ops,
  });
};
