import { compareText } from '../../stableOrder';
import type { HookSchemaDecl, HookSchemaField, HookTargetKind } from '../contract';

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

export interface BindingTargetStrategy {
  readonly extension: '.d.ts' | '.cs' | '.gd';
  readonly fileName: string;
  readonly emit: (schemas: readonly HookSchemaDecl[], options?: HookBindingOptions) => string;
}

export const PRIM_TYPES: Readonly<
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

export const toPascalCase = (raw: string): string => {
  const words = splitWords(raw);
  return words.length === 0
    ? 'Hook'
    : words.map((w) => w[0]!.toUpperCase() + w.slice(1).toLowerCase()).join('');
};

export const toScreamingSnake = (raw: string): string => {
  const words = splitWords(raw);
  if (words.length === 0) return 'VALUE';
  const joined = words.map((w) => w.toUpperCase()).join('_');
  return /^[0-9]/.test(joined) ? `V_${joined}` : joined;
};

export const toEnumMemberPascal = (raw: string): string => {
  const ident = toPascalCase(raw);
  return /^[0-9]/.test(ident) ? `Value${ident}` : ident;
};

export const escapeSingle = (value: string): string =>
  value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

export const escapeDouble = (value: string): string =>
  value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

export const sortedSchemas = (schemas: readonly HookSchemaDecl[]): readonly HookSchemaDecl[] =>
  [...schemas].sort((left, right) => compareText(left.id, right.id));

export const sortedFields = (fields: readonly HookSchemaField[]): readonly HookSchemaField[] =>
  [...fields].sort((left, right) => compareText(left.name, right.name));

export const sortedTargets = (targets: readonly HookTargetKind[]): readonly HookTargetKind[] =>
  [...new Set(targets)].sort(compareText);

export const schemaTypeName = (schema: HookSchemaDecl, options?: HookBindingOptions): string =>
  [
    options?.classPrefix ?? '',
    (options?.includeNamespaceInType ?? true) ? schema.namespace : '',
    schema.name,
  ]
    .filter((part) => part.length > 0)
    .map(toPascalCase)
    .join('');

export const uniqueUnionValues = (values: readonly string[]): readonly string[] => {
  const seen = new Set<string>();
  return values.filter((val) => {
    if (seen.has(val)) return false;
    seen.add(val);
    return true;
  });
};
