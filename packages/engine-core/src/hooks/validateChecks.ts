import { compareText } from '@ashfox/internal-contracts';
import type { Vec3 } from '../model/identity';
import type {
  HookAstValue,
  HookCompiledValue,
  HookCueDecl,
  HookDiagnostic,
  HookFieldType,
  HookParentRef,
  HookPropAssignment,
  HookSchemaDecl,
  HookSchemaField,
  HookSourceSpan,
  HookSourceUnit,
  HookTargetKind,
  HookValidationOptions,
  HookVolumeDecl,
  HookZoneDecl,
} from './contract';
import { STD_SCHEMAS } from './stdSchemas';

const ASSET_REF_IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/;
const ASSET_REF_PATH_RE = /^(?:\.\.?\/|[A-Za-z0-9_-]+\/)*[A-Za-z0-9_.-]+\.ashfox$/;
const ASSET_REF_URI_RE = /^[a-z][a-z0-9_]*:[a-z0-9_./-]+$/;
const MC_BLOCK_STATE_RE = /^[a-z0-9_]+:[a-z0-9_/]+(?:\[[a-z0-9_=,]+\])?$/;

export interface ValidationContext {
  readonly unit: HookSourceUnit;
  readonly options: HookValidationOptions;
  readonly schemas: Map<string, HookSchemaDecl>;
  readonly importAliases: Set<string>;
  readonly diagnostics: HookDiagnostic[];
}

export const pushDiag = (
  ctx: ValidationContext,
  code: string,
  message: string,
  span: HookSourceSpan,
  token: string,
): void => {
  ctx.diagnostics.push(
    Object.freeze({
      severity: 'error',
      code,
      message,
      file: span.file,
      line: span.start.line,
      column: span.start.column,
      token,
      span,
    }),
  );
};

export const isValidAssetReference = (raw: string): boolean => {
  if (!raw || /\s/.test(raw)) return false;
  if (raw.includes('..') && !ASSET_REF_PATH_RE.test(raw)) return false;
  return ASSET_REF_IDENT_RE.test(raw) || ASSET_REF_PATH_RE.test(raw) || ASSET_REF_URI_RE.test(raw);
};

export const isValidMcBlockState = (raw: string): boolean => MC_BLOCK_STATE_RE.test(raw);

const checkNumberBounds = (
  ctx: ValidationContext,
  val: number,
  type: Extract<HookFieldType, { kind: 'int' | 'float' }>,
  span: HookSourceSpan,
  propName: string,
): boolean => {
  if (!Number.isFinite(val)) {
    pushDiag(
      ctx,
      'hooks.invalid-property-type',
      `Property "${propName}" must be finite.`,
      span,
      String(val),
    );
    return false;
  }
  if (type.kind === 'int' && !Number.isInteger(val)) {
    pushDiag(
      ctx,
      'hooks.invalid-property-type',
      `Property "${propName}" must be an integer.`,
      span,
      String(val),
    );
    return false;
  }
  if (type.min !== undefined && val < type.min) {
    pushDiag(
      ctx,
      'hooks.out-of-range',
      `Property "${propName}" (${val}) is below ${type.min}.`,
      span,
      String(val),
    );
    return false;
  }
  if (type.max !== undefined && val > type.max) {
    pushDiag(
      ctx,
      'hooks.out-of-range',
      `Property "${propName}" (${val}) exceeds ${type.max}.`,
      span,
      String(val),
    );
    return false;
  }
  return true;
};

const checkAssetValue = (ctx: ValidationContext, val: HookAstValue, propName: string): boolean => {
  if (val.kind !== 'ref' && val.kind !== 'string') {
    pushDiag(
      ctx,
      'hooks.invalid-property-type',
      `Property "${propName}" must be an asset.`,
      val.span,
      propName,
    );
    return false;
  }
  if (!isValidAssetReference(val.value)) {
    pushDiag(
      ctx,
      'hooks.invalid-asset-ref',
      `Invalid asset ref "${val.value}".`,
      val.span,
      val.value,
    );
    return false;
  }
  if (val.kind === 'ref' && ctx.unit.imports.length > 0 && ctx.options.importedUnits) {
    const head = val.value.split('.')[0]!;
    if (!ctx.importAliases.has(head)) {
      pushDiag(
        ctx,
        'hooks.unknown-asset-import',
        `Asset ref "${val.value}" is not imported.`,
        val.span,
        val.value,
      );
      return false;
    }
  }
  return true;
};

const checkUnionValue = (
  ctx: ValidationContext,
  field: HookSchemaField,
  values: readonly string[],
  val: HookAstValue,
): boolean => {
  if (val.kind !== 'string') {
    pushDiag(
      ctx,
      'hooks.invalid-property-type',
      `Property "${field.name}" must be a string literal.`,
      val.span,
      field.name,
    );
    return false;
  }
  if (!values.includes(val.value)) {
    pushDiag(
      ctx,
      'hooks.invalid-union-value',
      `Property "${field.name}" value "${val.value}" is not in ${values.join(' | ')}.`,
      val.span,
      val.value,
    );
    return false;
  }
  return true;
};

export const validateFieldValue = (
  ctx: ValidationContext,
  field: HookSchemaField,
  val: HookAstValue,
): boolean => {
  const { type } = field;
  if (
    type.kind === 'string' ||
    type.kind === 'bool' ||
    type.kind === 'vec2' ||
    type.kind === 'vec3'
  ) {
    if (val.kind === type.kind) return true;
    pushDiag(
      ctx,
      'hooks.invalid-property-type',
      `Property "${field.name}" must be ${type.kind}.`,
      val.span,
      field.name,
    );
    return false;
  }
  if (type.kind === 'union') return checkUnionValue(ctx, field, type.values, val);
  if (type.kind === 'asset') return checkAssetValue(ctx, val, field.name);
  if (val.kind !== 'number') {
    pushDiag(
      ctx,
      'hooks.invalid-property-type',
      `Property "${field.name}" must be ${type.kind}.`,
      val.span,
      field.name,
    );
    return false;
  }
  return checkNumberBounds(ctx, val.value, type, val.span, field.name);
};

const validateSchemaDecl = (ctx: ValidationContext, schema: HookSchemaDecl): void => {
  const seenFields = new Set<string>();
  for (const field of schema.fields) {
    if (seenFields.has(field.name)) {
      pushDiag(
        ctx,
        'hooks.duplicate-field',
        `Duplicate field "${field.name}".`,
        field.span,
        field.name,
      );
    }
    seenFields.add(field.name);
    if (
      (field.type.kind === 'int' || field.type.kind === 'float') &&
      field.type.min !== undefined &&
      field.type.max !== undefined &&
      field.type.min > field.type.max
    ) {
      pushDiag(
        ctx,
        'hooks.invalid-schema-range',
        `Invalid range on "${field.name}".`,
        field.span,
        field.name,
      );
    }
    if (
      field.type.kind === 'union' &&
      new Set(field.type.values).size !== field.type.values.length
    ) {
      pushDiag(
        ctx,
        'hooks.invalid-schema-union',
        `Duplicate union literal in "${field.name}".`,
        field.span,
        field.name,
      );
    }
    if (field.defaultValue !== undefined) validateFieldValue(ctx, field, field.defaultValue);
  }
};

const checkImportCycles = (ctx: ValidationContext): void => {
  const units = ctx.options.importedUnits;
  if (!units) return;
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (path: string, unit: HookSourceUnit): void => {
    if (visited.has(path)) return;
    visiting.add(path);
    for (const imp of unit.imports) {
      if (visiting.has(imp.path)) {
        pushDiag(
          ctx,
          'hooks.import-cycle',
          `Import cycle involving "${imp.path}".`,
          imp.span,
          imp.path,
        );
        continue;
      }
      const next = units[imp.path];
      if (next && !visited.has(imp.path)) visit(imp.path, next);
    }
    visiting.delete(path);
    visited.add(path);
  };
  visit(ctx.unit.file, ctx.unit);
};

const registerImportedSchemas = (ctx: ValidationContext): void => {
  for (const imp of ctx.unit.imports) {
    if (ctx.importAliases.has(imp.alias)) {
      pushDiag(
        ctx,
        'hooks.duplicate-import',
        `Duplicate import alias "${imp.alias}".`,
        imp.span,
        imp.alias,
      );
    }
    ctx.importAliases.add(imp.alias);
    const imported = ctx.options.importedUnits?.[imp.path];
    if (!imported) continue;
    for (const schema of imported.schemas) {
      if (!schema.exported) continue;
      ctx.schemas.set(schema.id, schema);
      ctx.schemas.set(`${imp.alias}.${schema.name}`, schema);
    }
  }
};

export const registerSchemas = (ctx: ValidationContext): void => {
  if (ctx.options.includeStdSchemas !== false) {
    for (const s of STD_SCHEMAS) ctx.schemas.set(s.id, s);
  }
  for (const s of ctx.options.schemas ?? []) ctx.schemas.set(s.id, s);
  registerImportedSchemas(ctx);
  checkImportCycles(ctx);
  for (const schema of ctx.unit.schemas) {
    if (ctx.schemas.has(schema.id)) {
      pushDiag(
        ctx,
        'hooks.duplicate-schema',
        `Duplicate schema "${schema.id}".`,
        schema.span,
        schema.id,
      );
    }
    validateSchemaDecl(ctx, schema);
    ctx.schemas.set(schema.id, schema);
  }
};

export const checkParentValid = (
  ctx: ValidationContext,
  parent: HookParentRef | undefined,
  hookId: string,
  span: HookSourceSpan,
): void => {
  if (!parent || parent.kind === 'root') return;
  if (parent.id === hookId) {
    pushDiag(ctx, 'hooks.parent-cycle', `Hook "${hookId}" cannot parent itself.`, span, parent.id);
  }
  const valid = ctx.options.validParentIds;
  if (!valid) return;
  const listMap: Partial<Record<HookParentRef['kind'], readonly string[] | undefined>> = {
    bone: valid.bones,
    room: valid.rooms,
    floor: valid.floors,
    surface: valid.surfaces,
    compound: valid.compounds,
  };
  const allowed = listMap[parent.kind];
  if (allowed && !allowed.includes(parent.id)) {
    pushDiag(
      ctx,
      'hooks.unknown-parent',
      `Unknown ${parent.kind} parent "${parent.id}".`,
      span,
      parent.id,
    );
  }
};

const applyFieldDefaults = (
  ctx: ValidationContext,
  schema: HookSchemaDecl,
  assigned: ReadonlySet<string>,
  raw: Record<string, HookCompiledValue>,
  span: HookSourceSpan,
): void => {
  for (const field of schema.fields) {
    if (assigned.has(field.name)) continue;
    if (field.defaultValue !== undefined) raw[field.name] = field.defaultValue.value;
    else if (!field.optional) {
      pushDiag(
        ctx,
        'hooks.missing-required-property',
        `Missing required property "${field.name}".`,
        span,
        field.name,
      );
    }
  }
};

export const compilePropsAgainstSchema = (
  ctx: ValidationContext,
  schemaId: string,
  targetKind: HookTargetKind,
  assignments: readonly HookPropAssignment[],
  span: HookSourceSpan,
): {
  readonly canonicalSchema: string;
  readonly props: Readonly<Record<string, HookCompiledValue>>;
} => {
  const schema = ctx.schemas.get(schemaId);
  if (!schema) {
    pushDiag(ctx, 'hooks.unknown-schema', `Unknown hook schema "${schemaId}".`, span, schemaId);
    return { canonicalSchema: schemaId, props: Object.freeze({}) };
  }
  if (!schema.targets.includes(targetKind)) {
    pushDiag(
      ctx,
      'hooks.schema-target-mismatch',
      `Schema "${schema.id}" cannot be used on ${targetKind}.`,
      span,
      schemaId,
    );
  }
  const fieldMap = new Map(schema.fields.map((f) => [f.name, f]));
  const raw: Record<string, HookCompiledValue> = {};
  const assigned = new Set<string>();
  for (const prop of assignments) {
    if (assigned.has(prop.name)) {
      pushDiag(
        ctx,
        'hooks.duplicate-property',
        `Duplicate property "${prop.name}".`,
        prop.span,
        prop.name,
      );
      continue;
    }
    assigned.add(prop.name);
    const field = fieldMap.get(prop.name);
    if (!field) {
      pushDiag(
        ctx,
        'hooks.unknown-property',
        `Unknown property "${prop.name}".`,
        prop.span,
        prop.name,
      );
      continue;
    }
    if (validateFieldValue(ctx, field, prop.value)) raw[prop.name] = prop.value.value;
  }
  applyFieldDefaults(ctx, schema, assigned, raw, span);
  const sorted = Object.fromEntries(Object.entries(raw).sort(([a], [b]) => compareText(a, b)));
  return { canonicalSchema: schema.id, props: Object.freeze(sorted) };
};

export const validateBoxBounds = (
  ctx: ValidationContext,
  hook: HookVolumeDecl | HookZoneDecl,
): { readonly min: Vec3; readonly max: Vec3 } => {
  const zero: Vec3 = Object.freeze([0, 0, 0]);
  const from = hook.from ?? zero;
  const to = hook.to ?? zero;
  if (hook.from && hook.to && (from[0] > to[0] || from[1] > to[1] || from[2] > to[2])) {
    pushDiag(
      ctx,
      'hooks.invalid-volume-bounds',
      `Volume "${hook.id}" has inverted bounds.`,
      hook.span,
      hook.id,
    );
  }
  return { min: from, max: to };
};

export const validateCueTiming = (ctx: ValidationContext, cue: HookCueDecl): void => {
  if (cue.at !== undefined && (cue.from !== undefined || cue.to !== undefined)) {
    pushDiag(
      ctx,
      'hooks.invalid-cue-timing',
      `Cue "${cue.id}" mixes "at" and "from..to".`,
      cue.span,
      cue.id,
    );
  }
  const neg =
    (cue.at !== undefined && cue.at < 0) ||
    (cue.from !== undefined && cue.from < 0) ||
    (cue.to !== undefined && cue.to < 0);
  if (neg)
    pushDiag(
      ctx,
      'hooks.invalid-cue-timing',
      `Cue "${cue.id}" timing must be >= 0.`,
      cue.span,
      cue.id,
    );
  if (cue.from !== undefined && cue.to !== undefined && cue.from > cue.to) {
    pushDiag(ctx, 'hooks.invalid-cue-timing', `Cue "${cue.id}" has from > to.`, cue.span, cue.id);
  }
  if (cue.frame !== undefined && (!Number.isInteger(cue.frame) || cue.frame < 0)) {
    pushDiag(
      ctx,
      'hooks.invalid-cue-timing',
      `Cue "${cue.id}" frame must be >= 0 int.`,
      cue.span,
      cue.id,
    );
  }
};
