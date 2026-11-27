import { freeze } from '../../../immutable';
import type {
  AssetDeclaration,
  AssetDesignDecl,
  AssetDesignField,
} from '../../../project/program/asset/contract';
import type { ProgramExpr } from '../../../project/program/syntax/contract';
import type { SourceSpan } from '../../../project/source/contract';
import type {
  WorkspaceCompilationClosure,
  WorkspaceCompilationFile,
} from '../../../project/workspace/closure';
import { ASSET_BUDGET, AssetBudgetAbort } from './budgets';
import { compileAndEvaluateHirExpression, type HirIssue } from './hirValues';
import type { AssetValue } from './value/contract';

interface DesignOwner {
  readonly file: WorkspaceCompilationFile;
  readonly declaration: AssetDesignDecl;
  readonly fields: ReadonlyMap<string, AssetDesignField>;
}

interface DesignState {
  readonly owners: Map<string, Map<string, DesignOwner>>;
  readonly nonDesign: Map<string, Set<string>>;
  readonly imports: Map<string, Map<string, string>>;
  readonly cached: Map<AssetDesignField, AssetValue | null>;
  readonly active: Set<AssetDesignField>;
  readonly issue: HirIssue;
  nodes: number;
  fields: number;
}

/** Reify evaluated exact values without allowing a plain design integer to
 * acquire a dimensional unit from its consumer's expected type. */
const literal = (value: AssetValue, span: SourceSpan): ProgramExpr => {
  if (value.kind === 'number') {
    return freeze({
      kind: 'number',
      numerator: value.value.numerator,
      denominator: value.value.denominator,
      unit: value.value.unit,
      rawUnit: value.value.unit,
      text: '',
      span,
    });
  }
  if (value.kind === 'vector') {
    return freeze({
      kind: 'vector',
      values: freeze(value.values.map((component) => literal(component, span))),
      span,
    });
  }
  if (value.kind === 'boolean') return freeze({ kind: 'boolean', value: value.value, span });
  return freeze({ kind: 'color', value: value.value, span });
};

const referenceName = (expression: ProgramExpr): string | null => {
  if (expression.kind === 'name') return expression.value;
  if (expression.kind !== 'member') return null;
  const object = referenceName(expression.object);
  return object === null ? null : object + '.' + expression.member;
};

const isReference = (value: unknown): value is Extract<ProgramExpr, { kind: 'name' | 'member' }> =>
  value !== null &&
  typeof value === 'object' &&
  'kind' in value &&
  (value.kind === 'name' || value.kind === 'member');

const buildImports = (closure: WorkspaceCompilationClosure): Map<string, Map<string, string>> => {
  const imports = new Map<string, Map<string, string>>();
  for (const edge of closure.imports) {
    const aliases = imports.get(edge.importer.key) ?? new Map<string, string>();
    aliases.set(edge.alias, edge.target.key);
    imports.set(edge.importer.key, aliases);
  }
  return imports;
};

const indexDesignDeclaration = (
  file: WorkspaceCompilationFile,
  declaration: AssetDesignDecl,
  state: DesignState,
): DesignOwner => {
  const indexed = new Map<string, AssetDesignField>();
  const members = new Set<string>();
  for (const member of [...declaration.fields, ...declaration.checks]) {
    state.fields += 1;
    if (state.fields > ASSET_BUDGET.declarations) {
      state.issue(
        file.identity.path,
        member.span,
        'asset.design-limit',
        'Design fields and checks exceed the closure budget.',
      );
      throw new AssetBudgetAbort();
    }
    if (members.has(member.id)) {
      state.issue(
        file.identity.path,
        member.span,
        'asset.design-duplicate-field',
        `Design member "${member.id}" has multiple owners.`,
      );
    }
    members.add(member.id);
  }
  for (const field of declaration.fields) indexed.set(field.id, field);
  return freeze({ file, declaration, fields: indexed });
};

const collectFileOwners = (file: WorkspaceCompilationFile, state: DesignState): void => {
  const local = new Map<string, DesignOwner>();
  const nonDesign = new Set<string>();
  const names = new Set<string>();
  for (const declaration of file.unit.declarations) {
    if (names.has(declaration.id)) {
      state.issue(
        file.identity.path,
        declaration.span,
        'asset.duplicate-symbol',
        `Symbol "${declaration.id}" is declared more than once.`,
      );
    }
    names.add(declaration.id);
    if (declaration.kind === 'design') {
      local.set(declaration.id, indexDesignDeclaration(file, declaration, state));
    } else {
      nonDesign.add(declaration.id);
    }
  }
  const fileImports = state.imports.get(file.identity.key);
  for (const [name, owner] of local) {
    if (fileImports?.has(name)) {
      state.issue(
        file.identity.path,
        owner.declaration.span,
        'asset.design-namespace',
        `Design "${name}" conflicts with an import alias.`,
      );
    }
  }
  state.owners.set(file.identity.key, local);
  state.nonDesign.set(file.identity.key, nonDesign);
};

const isImportedNonDesign = (
  state: DesignState,
  targetKey: string | undefined,
  segments: readonly string[],
): boolean =>
  segments.length === 2 &&
  targetKey !== undefined &&
  (state.nonDesign.get(targetKey)?.has(segments[1]!) ?? false);

const resolveDesignOwner = (
  state: DesignState,
  file: WorkspaceCompilationFile,
  segments: readonly string[],
): {
  readonly owner: DesignOwner | undefined;
  readonly fieldIndex: number;
  readonly local: boolean;
} => {
  const local = state.owners.get(file.identity.key)?.get(segments[0]!);
  if (local !== undefined) return { owner: local, fieldIndex: 1, local: true };
  const targetKey = state.imports.get(file.identity.key)?.get(segments[0]!);
  if (isImportedNonDesign(state, targetKey, segments)) {
    return { owner: undefined, fieldIndex: 2, local: false };
  }
  const imported =
    targetKey === undefined ? undefined : state.owners.get(targetKey)?.get(segments[1]!);
  return { owner: imported, fieldIndex: 2, local: false };
};

const lookupDesignField = (
  state: DesignState,
  file: WorkspaceCompilationFile,
  raw: string,
  span: SourceSpan,
): Readonly<{ owner: DesignOwner; field: AssetDesignField; axis: string | null }> | null => {
  const segments = raw.split('.');
  const { owner, fieldIndex, local } = resolveDesignOwner(state, file, segments);
  const targetKey = state.imports.get(file.identity.key)?.get(segments[0]!);
  if (owner === undefined || (!local && !owner.declaration.exported)) {
    if (isImportedNonDesign(state, targetKey, segments)) return null;
    if (
      segments.length === 2 &&
      ['x', 'y', 'z'].includes(segments[1]!) &&
      targetKey === undefined
    ) {
      return null;
    }
    if (segments.length > 1) {
      state.issue(
        file.identity.path,
        span,
        'asset.design-reference',
        `Cannot resolve exported design reference "${raw}".`,
      );
    }
    return null;
  }
  const field = owner.fields.get(segments[fieldIndex]!);
  const suffix = segments.slice(fieldIndex + 1);
  if (
    field === undefined ||
    suffix.length > 1 ||
    (suffix.length === 1 && !['x', 'y', 'z'].includes(suffix[0]!))
  ) {
    state.issue(
      file.identity.path,
      span,
      'asset.design-reference',
      `Design reference "${raw}" must select one declared field and optional vector axis.`,
    );
    return null;
  }
  return { owner, field, axis: suffix[0] ?? null };
};

const resolveDesignReference = (
  state: DesignState,
  file: WorkspaceCompilationFile,
  expression: ProgramExpr,
): ProgramExpr | null => {
  const name = referenceName(expression);
  if (name === null || !name.includes('.')) return null;
  const target = lookupDesignField(state, file, name, expression.span);
  if (target === null) return null;
  const value = evaluateDesignField(state, target.owner, target.field);
  if (value === null) return null;
  if (target.axis === null) return literal(value, expression.span);
  const index = target.axis === 'x' ? 0 : target.axis === 'y' ? 1 : 2;
  if (value.kind !== 'vector' || value.values[index] === undefined) {
    state.issue(
      file.identity.path,
      expression.span,
      'asset.design-axis',
      `Design reference "${name}" selects an unavailable vector axis.`,
    );
    return null;
  }
  return literal(value.values[index]!, expression.span);
};

const transformDesignArray = <T>(
  state: DesignState,
  file: WorkspaceCompilationFile,
  input: readonly unknown[],
  depth: number,
): T => {
  let changed = false;
  let out: unknown[] | null = null;
  for (let index = 0; index < input.length; index += 1) {
    const item = input[index];
    const next = transformDesignValue(state, file, item, depth + 1);
    if (next !== item) {
      if (out === null) out = input.slice();
      out[index] = next;
      changed = true;
    }
  }
  if (!changed) return (Object.isFrozen(input) ? input : freeze(input.slice())) as T;
  return freeze(out!) as T;
};

const EXPR_SLOT_GEOM_PROPS = new Set([
  'origin',
  'size',
  'position',
  'rotation',
  'pivot',
  'visible',
  'u_axis',
  'v_axis',
]);

const isExprSlotVariantStmt = (entry: unknown): boolean =>
  entry !== null &&
  typeof entry === 'object' &&
  (entry as { kind?: unknown }).kind === 'geometry-property' &&
  !EXPR_SLOT_GEOM_PROPS.has(String((entry as { name?: unknown }).name));

const transformDesignFieldValue = (
  state: DesignState,
  file: WorkspaceCompilationFile,
  skipVariants: boolean,
  key: string,
  value: unknown,
  depth: number,
): unknown => {
  if (skipVariants && key === 'statements' && Array.isArray(value)) {
    const mapped = value.map((stmt) =>
      isExprSlotVariantStmt(stmt) ? stmt : transformDesignValue(state, file, stmt, depth + 1),
    );
    return mapped.some((m, i) => m !== value[i]) ? freeze(mapped) : value;
  }
  return key === 'span' ? value : transformDesignValue(state, file, value, depth + 1);
};

const transformDesignRecord = <T>(
  state: DesignState,
  file: WorkspaceCompilationFile,
  input: Record<string, unknown>,
  depth: number,
): T => {
  const skipVariants = input.kind === 'geometry-block' && input.keyword === 'expression_slot';
  let out: Record<string, unknown> | null = null;
  for (const key of Object.keys(input)) {
    const value = input[key];
    const next = transformDesignFieldValue(state, file, skipVariants, key, value, depth);
    if (next !== value) {
      if (out === null) out = { ...input };
      out[key] = next;
    }
  }
  if (out === null) return (Object.isFrozen(input) ? input : freeze({ ...input })) as T;
  return freeze(out) as T;
};

const transformDesignValue = <T>(
  state: DesignState,
  file: WorkspaceCompilationFile,
  input: T,
  depth = 0,
): T => {
  state.nodes += 1;
  if (state.nodes > ASSET_BUDGET.treeNodes * 16 || depth > 128) {
    state.issue(
      file.identity.path,
      file.unit.span,
      'asset.design-limit',
      'Design elaboration exceeds the semantic traversal budget.',
    );
    throw new AssetBudgetAbort();
  }
  if (input === null || typeof input !== 'object') return input;
  if (Array.isArray(input)) return transformDesignArray<T>(state, file, input, depth);
  if (isReference(input)) {
    const replacement = resolveDesignReference(state, file, input);
    if (replacement !== null) return replacement as T;
  }
  return transformDesignRecord<T>(state, file, input as Record<string, unknown>, depth);
};

const evaluateDesignField = (
  state: DesignState,
  owner: DesignOwner,
  field: AssetDesignField,
): AssetValue | null => {
  if (state.cached.has(field)) return state.cached.get(field)!;
  if (state.active.has(field)) {
    state.issue(
      owner.file.identity.path,
      field.span,
      'asset.design-cycle',
      `Design field "${owner.declaration.id}.${field.id}" has a cyclic dependency.`,
    );
    return null;
  }
  if (state.active.size >= 128) {
    state.issue(
      owner.file.identity.path,
      field.span,
      'asset.design-limit',
      'Design dependency depth exceeds 128 fields.',
    );
    throw new AssetBudgetAbort();
  }
  state.active.add(field);
  const expression = transformDesignValue(state, owner.file, field.value);
  const value = compileAndEvaluateHirExpression(
    expression,
    field.type,
    new Map(),
    new Map(),
    owner.file.identity.path,
    state.issue,
  );
  state.active.delete(field);
  state.cached.set(field, value);
  return value;
};

const evaluateOwnerDesigns = (state: DesignState, owner: DesignOwner): void => {
  for (const field of owner.fields.values()) evaluateDesignField(state, owner, field);
  for (const check of owner.declaration.checks) {
    const value = compileAndEvaluateHirExpression(
      transformDesignValue(state, owner.file, check.value),
      'bool',
      new Map(),
      new Map(),
      owner.file.identity.path,
      state.issue,
    );
    if (value?.kind === 'boolean' && !value.value) {
      state.issue(
        owner.file.identity.path,
        check.span,
        'asset.design-check',
        `Design check "${owner.declaration.id}.${check.id}" failed.`,
      );
    }
  }
};

const rejectShadowing = (
  file: WorkspaceCompilationFile,
  declaration: AssetDeclaration,
  designs: ReadonlyMap<string, DesignOwner>,
  imports: ReadonlyMap<string, string>,
  issue: HirIssue,
): void => {
  if (declaration.kind !== 'component') return;
  for (const binding of [...declaration.parameters, ...declaration.ports]) {
    if (designs.has(binding.id) || imports.has(binding.id)) {
      issue(
        file.identity.path,
        binding.span,
        'asset.design-namespace',
        `Component binding "${binding.id}" conflicts with a design or import namespace.`,
      );
    }
  }
};

const elaborateClosureFile = (
  state: DesignState,
  file: WorkspaceCompilationFile,
): WorkspaceCompilationFile => {
  const declarations = file.unit.declarations.filter(
    (declaration) => declaration.kind !== 'design',
  );
  for (const declaration of declarations) {
    rejectShadowing(
      file,
      declaration,
      state.owners.get(file.identity.key)!,
      state.imports.get(file.identity.key) ?? new Map(),
      state.issue,
    );
  }
  return freeze({
    ...file,
    unit: freeze({
      ...file.unit,
      declarations: freeze(
        declarations.map((declaration) => transformDesignValue(state, file, declaration)),
      ),
    }),
  });
};

/** Designs are compile-time source declarations, erased before nominal HIR.
 * This bounded traversal operates on the sealed parser snapshot, never source
 * strings or a second authoring representation. */
export const elaborateAssetDesigns = (
  closure: WorkspaceCompilationClosure,
  issue: HirIssue,
): WorkspaceCompilationClosure => {
  const files = new Map(closure.files.map((file) => [file.identity.key, file]));
  const state: DesignState = {
    owners: new Map(),
    nonDesign: new Map(),
    imports: buildImports(closure),
    cached: new Map(),
    active: new Set(),
    issue,
    nodes: 0,
    fields: 0,
  };
  for (const file of closure.files) collectFileOwners(file, state);
  for (const local of state.owners.values()) {
    for (const owner of local.values()) evaluateOwnerDesigns(state, owner);
  }
  const elaborated = closure.files.map((file) => elaborateClosureFile(state, file));
  const root = elaborated.find((file) => file.identity.key === closure.root.identity.key);
  if (root === undefined || !files.has(root.identity.key)) {
    throw new TypeError('Design closure omitted root.');
  }
  return freeze({ ...closure, files: freeze(elaborated), root });
};
