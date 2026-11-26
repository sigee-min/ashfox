import { compareText } from '../stableOrder';
import type {
  HookAstValue,
  HookFieldType,
  HookSchemaDecl,
  HookSchemaField,
  HookTargetKind,
  HooksDocument,
} from './contract';

export type HookBindingTarget = 'ts' | 'cs' | 'gd';

export interface HookBindingOptions {
  readonly namespace?: string;
  readonly classPrefix?: string;
  readonly includeNamespaceInType?: boolean;
}

export interface GeneratedBindingFile {
  readonly target: HookBindingTarget;
  readonly extension: '.d.ts' | '.cs' | '.gd';
  readonly fileName: string;
  readonly content: string;
  readonly schemas: readonly string[];
}

const CS_KEYWORDS = new Set(
  (
    'abstract as base bool break byte case catch char checked class const continue decimal ' +
    'default delegate do double else enum event explicit extern false finally fixed float for ' +
    'foreach goto if implicit in int interface internal is lock long namespace new null object ' +
    'operator out override params private protected public readonly ref return sbyte sealed ' +
    'short sizeof stackalloc static string struct switch this throw true try typeof uint ulong ' +
    'unchecked unsafe ushort using virtual void volatile while'
  ).split(' '),
);

const GD_KEYWORDS = new Set(
  (
    'and as assert await break breakpoint class class_name const continue elif else enum extends ' +
    'false for func if in is match not null or pass preload return self signal static super ' +
    'true var while yield'
  ).split(' '),
);

const PRIM_TYPES: Readonly<
  Record<
    string,
    { readonly ts: string; readonly cs: string; readonly gd: string; readonly gdDef: string }
  >
> = {
  string: { ts: 'string', cs: 'string', gd: 'String', gdDef: '""' },
  asset: { ts: 'AshfoxAssetRef', cs: 'string', gd: 'String', gdDef: '""' },
  int: { ts: 'number', cs: 'int', gd: 'int', gdDef: '0' },
  float: { ts: 'number', cs: 'float', gd: 'float', gdDef: '0.0' },
  bool: { ts: 'boolean', cs: 'bool', gd: 'bool', gdDef: 'false' },
  vec2: { ts: 'AshfoxVec2', cs: 'Vector2', gd: 'Vector2', gdDef: 'Vector2.ZERO' },
  vec3: { ts: 'AshfoxVec3', cs: 'Vector3', gd: 'Vector3', gdDef: 'Vector3.ZERO' },
};

const splitWords = (raw: string): readonly string[] =>
  raw
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

const toPascalCase = (raw: string): string => {
  const words = splitWords(raw);
  return words.length === 0
    ? 'Hook'
    : words.map((w) => w[0]!.toUpperCase() + w.slice(1).toLowerCase()).join('');
};

const toScreamingSnake = (raw: string): string => {
  const words = splitWords(raw);
  if (words.length === 0) return 'VALUE';
  const joined = words.map((w) => w.toUpperCase()).join('_');
  return /^[0-9]/.test(joined) ? `V_${joined}` : joined;
};

const toEnumMemberPascal = (raw: string): string => {
  const ident = toPascalCase(raw);
  return /^[0-9]/.test(ident) ? `Value${ident}` : ident;
};

const escapeSingle = (value: string): string => value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
const escapeDouble = (value: string): string => value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
const safeCsField = (name: string): string => (CS_KEYWORDS.has(name) ? `@${name}` : name);
const safeGdField = (name: string): string => (GD_KEYWORDS.has(name) ? `${name}_` : name);
const sortedSchemas = (schemas: readonly HookSchemaDecl[]): readonly HookSchemaDecl[] =>
  [...schemas].sort((left, right) => compareText(left.id, right.id));
const sortedFields = (fields: readonly HookSchemaField[]): readonly HookSchemaField[] =>
  [...fields].sort((left, right) => compareText(left.name, right.name));
const sortedTargets = (targets: readonly HookTargetKind[]): readonly HookTargetKind[] =>
  [...new Set(targets)].sort(compareText);

const schemaTypeName = (schema: HookSchemaDecl, options?: HookBindingOptions): string =>
  [
    options?.classPrefix ?? '',
    (options?.includeNamespaceInType ?? true) ? schema.namespace : '',
    schema.name,
  ]
    .filter((part) => part.length > 0)
    .map(toPascalCase)
    .join('');

const uniqueUnionValues = (values: readonly string[]): readonly string[] => {
  const seen = new Set<string>();
  return values.filter((val) => {
    if (seen.has(val)) return false;
    seen.add(val);
    return true;
  });
};

const formatTsDefault = (value: HookAstValue): string => {
  if (value.kind === 'string' || value.kind === 'ref') return `'${escapeSingle(value.value)}'`;
  if (value.kind === 'vec2') return `[${value.value[0]}, ${value.value[1]}]`;
  if (value.kind === 'vec3') return `[${value.value[0]}, ${value.value[1]}, ${value.value[2]}]`;
  return String(value.value);
};

const tsFieldType = (type: HookFieldType): string => {
  if (type.kind !== 'union') return PRIM_TYPES[type.kind]!.ts;
  const literals = uniqueUnionValues(type.values).map((v) => `'${escapeSingle(v)}'`);
  return literals.length > 0 ? literals.join(' | ') : 'never';
};

const tsFieldMeta = (field: HookSchemaField): string | null => {
  const notes: string[] = [];
  if (
    (field.type.kind === 'int' || field.type.kind === 'float') &&
    (field.type.min !== undefined || field.type.max !== undefined)
  ) {
    notes.push(
      `@range ${field.type.kind}[${field.type.min ?? '-Infinity'}, ${field.type.max ?? 'Infinity'}]`,
    );
  }
  if (field.defaultValue !== undefined)
    notes.push(`@default ${formatTsDefault(field.defaultValue)}`);
  return notes.length > 0 ? `  /** ${notes.join(' ')} */` : null;
};

const emitTsSchema = (schema: HookSchemaDecl, options?: HookBindingOptions): readonly string[] => {
  const typeName = schemaTypeName(schema, options);
  const targets = sortedTargets(schema.targets).join(' | ');
  const lines = [
    `/** Schema \`${schema.id}\` (${targets || 'any'}) */`,
    `export interface ${typeName} {`,
  ];
  for (const field of sortedFields(schema.fields)) {
    const meta = tsFieldMeta(field);
    if (meta) lines.push(meta);
    lines.push(`  readonly ${field.name}${field.optional ? '?' : ''}: ${tsFieldType(field.type)};`);
  }
  lines.push('}');
  return lines;
};

const emitTsBindings = (
  schemas: readonly HookSchemaDecl[],
  options?: HookBindingOptions,
): string => {
  const ordered = sortedSchemas(schemas);
  const lines: string[] = [
    '// Generated by Ashfox Universal Hooks — do not edit.',
    "export type AshfoxHookTarget = 'anchor' | 'volume' | 'cue' | 'meta';",
    'export type AshfoxVec2 = readonly [number, number];',
    'export type AshfoxVec3 = readonly [number, number, number];',
    'export type AshfoxAssetRef = string;',
    '',
  ];
  for (const schema of ordered) lines.push(...emitTsSchema(schema, options), '');
  lines.push('export interface AshfoxHookSchemaMap {');
  for (const schema of ordered) {
    lines.push(`  readonly '${escapeSingle(schema.id)}': ${schemaTypeName(schema, options)};`);
  }
  lines.push(
    '}',
    'export type AshfoxHookSchemaId = keyof AshfoxHookSchemaMap;',
    'export declare function getHooks<K extends AshfoxHookSchemaId>(',
    '  entries: readonly { readonly schema: string; readonly props: unknown }[],',
    '  schemaId: K,',
    '): readonly AshfoxHookSchemaMap[K][];',
  );
  return `${lines.join('\n')}\n`;
};

const csFloat = (value: number): string => (Number.isInteger(value) ? `${value}.0f` : `${value}f`);

const csRangeAttr = (type: HookFieldType): string | null => {
  if (type.kind !== 'int' && type.kind !== 'float') return null;
  const fmt = type.kind === 'int' ? (n: number): string => String(Math.trunc(n)) : csFloat;
  if (type.min !== undefined && type.max !== undefined)
    return `[Range(${fmt(type.min)}, ${fmt(type.max)})]`;
  if (type.min !== undefined) return `[Min(${fmt(type.min)})]`;
  return type.max !== undefined ? `/// <remarks>Max value: ${type.max}</remarks>` : null;
};

const csAstDefault = (value: HookAstValue, field: HookSchemaField, enumType: string): string => {
  if (value.kind === 'string' || value.kind === 'ref') {
    return field.type.kind === 'union'
      ? `${enumType}.${toEnumMemberPascal(value.value)}`
      : `"${escapeDouble(value.value)}"`;
  }
  if (value.kind === 'number') {
    return field.type.kind === 'int' ? String(Math.trunc(value.value)) : csFloat(value.value);
  }
  if (value.kind === 'bool') return value.value ? 'true' : 'false';
  if (value.kind === 'vec2')
    return `new Vector2(${csFloat(value.value[0])}, ${csFloat(value.value[1])})`;
  return `new Vector3(${csFloat(value.value[0])}, ${csFloat(value.value[1])}, ${csFloat(value.value[2])})`;
};

const csDefaultLiteral = (
  value: HookAstValue | undefined,
  field: HookSchemaField,
  enumType: string,
): string => {
  if (value !== undefined) return csAstDefault(value, field, enumType);
  if (field.optional) return 'null';
  return field.type.kind === 'string' || field.type.kind === 'asset' ? '""' : '';
};

const emitCsEnum = (enumType: string, values: readonly string[]): readonly string[] => {
  const unique = uniqueUnionValues(values);
  const lines = [`    public enum ${enumType}`, '    {'];
  unique.forEach((value, idx) => {
    lines.push(
      `        ${toEnumMemberPascal(value)} = ${idx}${idx + 1 < unique.length ? ',' : ''}`,
    );
  });
  lines.push('    }');
  return lines;
};

const emitCsField = (field: HookSchemaField, typeName: string): readonly string[] => {
  const lines: string[] = [];
  const enumType = `${typeName}${toPascalCase(field.name)}`;
  const attr = csRangeAttr(field.type);
  if (attr) lines.push(`        ${attr}`);
  const baseType = field.type.kind === 'union' ? enumType : PRIM_TYPES[field.type.kind]!.cs;
  const isRef = field.type.kind === 'string' || field.type.kind === 'asset';
  const csType = field.optional && !isRef ? `${baseType}?` : baseType;
  const def = csDefaultLiteral(field.defaultValue, field, enumType);
  lines.push(
    `        public ${csType} ${safeCsField(field.name)}${def.length > 0 ? ` = ${def}` : ''};`,
  );
  return lines;
};

const emitCsSchema = (schema: HookSchemaDecl, options?: HookBindingOptions): readonly string[] => {
  const typeName = schemaTypeName(schema, options);
  const fields = sortedFields(schema.fields);
  const lines: string[] = [];
  for (const field of fields) {
    if (field.type.kind === 'union') {
      lines.push(...emitCsEnum(`${typeName}${toPascalCase(field.name)}`, field.type.values), '');
    }
  }
  const targets = sortedTargets(schema.targets).join(', ');
  lines.push(
    `    /// <summary>Schema ${schema.id} (targets: ${targets || 'any'})</summary>`,
    '    [Serializable]',
    `    public sealed class ${typeName}`,
    '    {',
    `        public const string SchemaId = "${escapeDouble(schema.id)}";`,
  );
  for (const field of fields) lines.push(...emitCsField(field, typeName));
  lines.push('    }');
  return lines;
};

const emitCsBindings = (
  schemas: readonly HookSchemaDecl[],
  options?: HookBindingOptions,
): string => {
  const ns = options?.namespace ?? 'Ashfox.Hooks';
  const lines = [
    '// Generated by Ashfox Universal Hooks — do not edit.',
    'using System;',
    'using UnityEngine;',
    '',
    `namespace ${ns}`,
    '{',
  ];
  const ordered = sortedSchemas(schemas);
  ordered.forEach((schema, idx) => {
    lines.push(...emitCsSchema(schema, options));
    if (idx + 1 < ordered.length) lines.push('');
  });
  lines.push('}');
  return `${lines.join('\n')}\n`;
};

const gdImplicitDefault = (field: HookSchemaField, enumType: string): string => {
  if (field.optional) return 'null';
  if (field.type.kind !== 'union') return PRIM_TYPES[field.type.kind]!.gdDef;
  const first = uniqueUnionValues(field.type.values)[0];
  return first !== undefined ? `${enumType}.${toScreamingSnake(first)}` : '0';
};

const gdAstDefault = (value: HookAstValue, field: HookSchemaField, enumType: string): string => {
  if (value.kind === 'string' || value.kind === 'ref') {
    return field.type.kind === 'union'
      ? `${enumType}.${toScreamingSnake(value.value)}`
      : `"${escapeDouble(value.value)}"`;
  }
  if (value.kind === 'number') {
    return field.type.kind === 'int' ? String(Math.trunc(value.value)) : String(value.value);
  }
  if (value.kind === 'bool') return value.value ? 'true' : 'false';
  if (value.kind === 'vec2') return `Vector2(${value.value[0]}, ${value.value[1]})`;
  return `Vector3(${value.value[0]}, ${value.value[1]}, ${value.value[2]})`;
};

const gdDefaultLiteral = (
  value: HookAstValue | undefined,
  field: HookSchemaField,
  enumType: string,
): string =>
  value === undefined ? gdImplicitDefault(field, enumType) : gdAstDefault(value, field, enumType);

const gdRangeLine = (type: HookFieldType): string | null => {
  if (type.kind !== 'int' && type.kind !== 'float') return null;
  if (type.min !== undefined && type.max !== undefined) {
    return `    @export_range(${type.min}, ${type.max}${type.kind === 'int' ? ', 1' : ''})`;
  }
  if (type.min !== undefined) return `    # min: ${type.min}`;
  return type.max !== undefined ? `    # max: ${type.max}` : null;
};

const emitGdSchema = (schema: HookSchemaDecl, options?: HookBindingOptions): readonly string[] => {
  const typeName = schemaTypeName(schema, options);
  const targets = sortedTargets(schema.targets)
    .map((t) => `"${t}"`)
    .join(', ');
  const fields = sortedFields(schema.fields);
  const lines = [
    `## Schema: ${schema.id}`,
    `class ${typeName}:`,
    `    const SCHEMA_ID: String = "${escapeDouble(schema.id)}"`,
    `    const TARGETS: Array[String] = [${targets}]`,
  ];
  for (const field of fields) {
    if (field.type.kind !== 'union') continue;
    const members = uniqueUnionValues(field.type.values).map(toScreamingSnake);
    lines.push(`    enum ${toPascalCase(field.name)} { ${members.join(', ')} }`);
  }
  for (const field of fields) {
    const enumName = toPascalCase(field.name);
    const range = gdRangeLine(field.type);
    if (range) lines.push(range);
    const prefix = field.optional && field.defaultValue === undefined ? '' : '@export ';
    const gdType =
      field.optional && field.defaultValue === undefined
        ? 'Variant'
        : field.type.kind === 'union'
          ? enumName
          : PRIM_TYPES[field.type.kind]!.gd;
    const def = gdDefaultLiteral(field.defaultValue, field, enumName);
    lines.push(`    ${prefix}var ${safeGdField(field.name)}: ${gdType} = ${def}`);
  }
  return lines;
};

const emitGdBindings = (
  schemas: readonly HookSchemaDecl[],
  options?: HookBindingOptions,
): string => {
  const rootClass = options?.namespace ? toPascalCase(options.namespace) : 'AshfoxHooks';
  const lines = [
    '# Generated by Ashfox Universal Hooks — do not edit.',
    `class_name ${rootClass}`,
    '',
  ];
  const ordered = sortedSchemas(schemas);
  ordered.forEach((schema, idx) => {
    lines.push(...emitGdSchema(schema, options));
    if (idx + 1 < ordered.length) lines.push('');
  });
  return `${lines.join('\n')}\n`;
};

const TARGET_FILE_INFO: Readonly<
  Record<
    HookBindingTarget,
    { readonly extension: '.d.ts' | '.cs' | '.gd'; readonly fileName: string }
  >
> = {
  ts: { extension: '.d.ts', fileName: 'ashfox-hooks.d.ts' },
  cs: { extension: '.cs', fileName: 'AshfoxHooks.cs' },
  gd: { extension: '.gd', fileName: 'ashfox_hooks.gd' },
};

export const generateHookBindings = (
  schemas: readonly HookSchemaDecl[],
  target: HookBindingTarget,
  options?: HookBindingOptions,
): GeneratedBindingFile => {
  const ordered = sortedSchemas(schemas);
  const info = TARGET_FILE_INFO[target];
  const content =
    target === 'ts'
      ? emitTsBindings(ordered, options)
      : target === 'cs'
        ? emitCsBindings(ordered, options)
        : emitGdBindings(ordered, options);
  return Object.freeze({
    target,
    extension: info.extension,
    fileName: info.fileName,
    content,
    schemas: Object.freeze(ordered.map((schema) => schema.id)),
  });
};

export const generateBindingsFromDocument = (
  document: HooksDocument,
  target: HookBindingTarget,
  options?: HookBindingOptions,
): GeneratedBindingFile => generateHookBindings(document.schemas, target, options);

export const generateAllHookBindings = (
  schemas: readonly HookSchemaDecl[],
  options?: HookBindingOptions,
): Readonly<Record<HookBindingTarget, GeneratedBindingFile>> =>
  Object.freeze({
    ts: generateHookBindings(schemas, 'ts', options),
    cs: generateHookBindings(schemas, 'cs', options),
    gd: generateHookBindings(schemas, 'gd', options),
  });
