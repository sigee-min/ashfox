import type {
  AssetDeclaration, AssetDesignDecl, AssetDesignField
} from '../../../project/program/asset/contract';
import type { ProgramExpr } from '../../../project/program/syntax/contract';
import type { SourceSpan } from '../../../project/source/contract';
import type {
  WorkspaceCompilationClosure, WorkspaceCompilationFile
} from '../../../project/workspace/closure';
import { ASSET_BUDGET, AssetBudgetAbort } from './budgets';
import { compileAndEvaluateHirExpression, type HirIssue } from './hirValues';
import type { AssetValue } from './value/contract';

const freeze = <T>(value: T): T => Object.freeze(value);

interface DesignOwner {
  readonly file: WorkspaceCompilationFile;
  readonly declaration: AssetDesignDecl;
  readonly fields: ReadonlyMap<string, AssetDesignField>;
}

/** Reify evaluated exact values without allowing a plain design integer to
 * acquire a dimensional unit from its consumer's expected type. */
const literal = (value: AssetValue, span: SourceSpan): ProgramExpr => {
  if (value.kind === 'number') return freeze({ kind: 'number',
    numerator: value.value.numerator, denominator: value.value.denominator,
    unit: value.value.unit, rawUnit: value.value.unit, text: '', span });
  if (value.kind === 'vector') return freeze({ kind: 'vector',
    values: freeze(value.values.map((component) => literal(component, span))), span });
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
  value !== null && typeof value === 'object' && 'kind' in value &&
  (value.kind === 'name' || value.kind === 'member');

/** Designs are compile-time source declarations, erased before nominal HIR.
 * This bounded traversal operates on the sealed parser snapshot, never source
 * strings or a second authoring representation. */
export const elaborateAssetDesigns = (
  closure: WorkspaceCompilationClosure,
  issue: HirIssue
): WorkspaceCompilationClosure => {
  const owners = new Map<string, Map<string, DesignOwner>>();
  const files = new Map(closure.files.map((file) => [file.identity.key, file]));
  const imports = new Map<string, Map<string, string>>();
  const cached = new Map<AssetDesignField, AssetValue | null>();
  const active = new Set<AssetDesignField>();
  let nodes = 0;
  let fields = 0;
  for (const edge of closure.imports) {
    const aliases = imports.get(edge.importer.key) ?? new Map<string, string>();
    aliases.set(edge.alias, edge.target.key);
    imports.set(edge.importer.key, aliases);
  }
  for (const file of closure.files) {
    const local = new Map<string, DesignOwner>();
    const names = new Set<string>();
    for (const declaration of file.unit.declarations) {
      if (names.has(declaration.id)) issue(file.identity.path, declaration.span,
        'asset.duplicate-symbol', `Symbol "${declaration.id}" is declared more than once.`);
      names.add(declaration.id);
      if (declaration.kind !== 'design') continue;
      const indexed = new Map<string, AssetDesignField>();
      const members = new Set<string>();
      for (const member of [...declaration.fields, ...declaration.checks]) {
        fields += 1;
        if (fields > ASSET_BUDGET.declarations) {
          issue(file.identity.path, member.span, 'asset.design-limit',
            'Design fields and checks exceed the closure budget.');
          throw new AssetBudgetAbort();
        }
        if (members.has(member.id)) issue(file.identity.path, member.span,
          'asset.design-duplicate-field', `Design member "${member.id}" has multiple owners.`);
        members.add(member.id);
      }
      for (const field of declaration.fields) indexed.set(field.id, field);
      local.set(declaration.id, freeze({ file, declaration, fields: indexed }));
    }
    for (const [name] of local) if (imports.get(file.identity.key)?.has(name)) issue(
      file.identity.path, local.get(name)!.declaration.span, 'asset.design-namespace',
      `Design "${name}" conflicts with an import alias.`);
    owners.set(file.identity.key, local);
  }

  const lookup = (file: WorkspaceCompilationFile, raw: string, span: SourceSpan):
    Readonly<{ owner: DesignOwner; field: AssetDesignField; axis: string | null }> | null => {
    const segments = raw.split('.');
    const local = owners.get(file.identity.key)?.get(segments[0]!);
    const targetKey = imports.get(file.identity.key)?.get(segments[0]!);
    const owner = local ?? (targetKey === undefined ? undefined :
      owners.get(targetKey)?.get(segments[1]!));
    const fieldIndex = local === undefined ? 2 : 1;
    if (owner === undefined || (local === undefined && !owner.declaration.exported)) {
      // A simple local vector member is not a nominal design reference.
      if (segments.length === 2 && ['x', 'y', 'z'].includes(segments[1]!) &&
        targetKey === undefined && local === undefined) return null;
      if (segments.length > 1) issue(file.identity.path, span, 'asset.design-reference',
        `Cannot resolve exported design reference "${raw}".`);
      return null;
    }
    const field = owner.fields.get(segments[fieldIndex]!);
    const suffix = segments.slice(fieldIndex + 1);
    if (field === undefined || suffix.length > 1 ||
      (suffix.length === 1 && !['x', 'y', 'z'].includes(suffix[0]!))) {
      issue(file.identity.path, span, 'asset.design-reference',
        `Design reference "${raw}" must select one declared field and optional vector axis.`);
      return null;
    }
    return { owner, field, axis: suffix[0] ?? null };
  };

  const resolve = (file: WorkspaceCompilationFile, expression: ProgramExpr): ProgramExpr | null => {
    const name = referenceName(expression);
    if (name === null || !name.includes('.')) return null;
    const target = lookup(file, name, expression.span);
    if (target === null) return null;
    const value = evaluate(target.owner, target.field);
    if (value === null) return null;
    if (target.axis === null) return literal(value, expression.span);
    const index = target.axis === 'x' ? 0 : target.axis === 'y' ? 1 : 2;
    if (value.kind !== 'vector' || value.values[index] === undefined) {
      issue(file.identity.path, expression.span, 'asset.design-axis',
        `Design reference "${name}" selects an unavailable vector axis.`);
      return null;
    }
    return literal(value.values[index]!, expression.span);
  };

  const transform = <T>(file: WorkspaceCompilationFile, input: T, depth = 0): T => {
    nodes += 1;
    if (nodes > ASSET_BUDGET.treeNodes * 16 || depth > 128) {
      issue(file.identity.path, file.unit.span, 'asset.design-limit',
        'Design elaboration exceeds the semantic traversal budget.');
      throw new AssetBudgetAbort();
    }
    if (input === null || typeof input !== 'object') return input;
    if (Array.isArray(input)) return freeze(input.map((item: unknown) =>
      transform(file, item, depth + 1))) as T;
    if (isReference(input)) {
      const replacement = resolve(file, input);
      if (replacement !== null) return replacement as T;
    }
    return freeze(Object.fromEntries(Object.entries(input).map(([key, value]) =>
      [key, key === 'span' ? value : transform(file, value, depth + 1)]))) as T;
  };

  const evaluate = (owner: DesignOwner, field: AssetDesignField): AssetValue | null => {
    if (cached.has(field)) return cached.get(field)!;
    if (active.has(field)) {
      issue(owner.file.identity.path, field.span, 'asset.design-cycle',
        `Design field "${owner.declaration.id}.${field.id}" has a cyclic dependency.`);
      return null;
    }
    if (active.size >= 128) {
      issue(owner.file.identity.path, field.span, 'asset.design-limit',
        'Design dependency depth exceeds 128 fields.');
      throw new AssetBudgetAbort();
    }
    active.add(field);
    const expression = transform(owner.file, field.value);
    const value = compileAndEvaluateHirExpression(expression, field.type,
      new Map(), new Map(), owner.file.identity.path, issue);
    active.delete(field);
    cached.set(field, value);
    return value;
  };

  for (const local of owners.values()) for (const owner of local.values()) {
    for (const field of owner.fields.values()) evaluate(owner, field);
    for (const check of owner.declaration.checks) {
      const value = compileAndEvaluateHirExpression(transform(owner.file, check.value),
        'bool', new Map(), new Map(), owner.file.identity.path, issue);
      if (value?.kind === 'boolean' && !value.value) issue(owner.file.identity.path,
        check.span, 'asset.design-check',
        `Design check "${owner.declaration.id}.${check.id}" failed.`);
    }
  }
  const elaborated = closure.files.map((file): WorkspaceCompilationFile => {
    const declarations = file.unit.declarations.filter((declaration) => declaration.kind !== 'design');
    for (const declaration of declarations) rejectShadowing(file, declaration,
      owners.get(file.identity.key)!, imports.get(file.identity.key) ?? new Map(), issue);
    return freeze({ ...file, unit: freeze({ ...file.unit,
      declarations: freeze(declarations.map((declaration) => transform(file, declaration))) }) });
  });
  const root = elaborated.find((file) => file.identity.key === closure.root.identity.key);
  if (root === undefined || !files.has(root.identity.key)) throw new TypeError('Design closure omitted root.');
  return freeze({ ...closure, files: freeze(elaborated), root });
};

const rejectShadowing = (
  file: WorkspaceCompilationFile,
  declaration: AssetDeclaration,
  designs: ReadonlyMap<string, DesignOwner>,
  imports: ReadonlyMap<string, string>,
  issue: HirIssue
): void => {
  if (declaration.kind !== 'component') return;
  for (const binding of [...declaration.parameters, ...declaration.ports]) {
    if (designs.has(binding.id) || imports.has(binding.id)) issue(file.identity.path,
      binding.span, 'asset.design-namespace',
      `Component binding "${binding.id}" conflicts with a design or import namespace.`);
  }
};
