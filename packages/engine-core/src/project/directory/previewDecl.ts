import type { ProgramToken } from '../program/syntax/lex';
import type { AshfoxNamedBlock } from '../program/syntax/blockAst';
import { ashfoxScalarExprValue } from '../program/syntax/blockLowering';

export type DeclaredAssetKind = 'model' | 'sprite' | 'sound' | 'structure' | 'vfx';

export interface DeclaredPreviewSpec {
  readonly name: string;
  readonly kind?: 'still' | 'gif';
  readonly width?: number;
  readonly height?: number;
  readonly camera?:
    'perspective' | 'native' | 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom';
  readonly azimuth?: number;
  readonly elevation?: number;
  readonly zoom?: number;
  readonly environment?: 'studio' | 'day' | 'evening' | 'night';
  readonly background?: 'environment' | 'transparent' | 'checker' | 'light' | 'dark';
  readonly sheet?: 'turnaround' | 'inspect' | 'exterior' | 'cutaway' | 'interior' | 'flipbook';
  readonly mode?: 'motion' | 'turntable' | 'build';
  readonly clip?: string;
  readonly time?: number;
  readonly fps?: number;
  readonly duration?: number;
  readonly wireframe?: boolean;
  readonly skeleton?: boolean;
  readonly textures?: boolean;
  readonly texture?: string;
  readonly scale?: number;
  readonly stage?: 'final' | 'silhouette' | 'shade' | 'grain';
  readonly variant?: string;
  readonly cutaway?: number;
}

export interface RawDeclaredPreview {
  readonly name: string;
  readonly properties: Readonly<Record<string, unknown>>;
}

const PREVIEW_ENUMS = {
  kind: ['still', 'gif'],
  camera: ['perspective', 'native', 'front', 'back', 'left', 'right', 'top', 'bottom'],
  environment: ['studio', 'day', 'evening', 'night'],
  background: ['environment', 'transparent', 'checker', 'light', 'dark'],
  sheet: ['turnaround', 'inspect', 'exterior', 'cutaway', 'interior', 'flipbook'],
  mode: ['motion', 'turntable', 'build'],
  stage: ['final', 'silhouette', 'shade', 'grain'],
} as const;

const PREVIEW_NUMERIC_RANGES: Readonly<Record<string, readonly [number, number, boolean]>> = {
  width: [16, 2048, true],
  height: [16, 2048, true],
  azimuth: [-360, 360, false],
  elevation: [-89, 89, false],
  zoom: [0.1, 10, false],
  time: [0, 60, false],
  fps: [1, 30, true],
  duration: [0.01, 30, false],
  scale: [1, 32, true],
  cutaway: [1, 64, true],
};

const MODEL_STRUCTURE_PREVIEW_KEYS = new Set([
  'camera',
  'azimuth',
  'elevation',
  'zoom',
  'clip',
  'time',
  'wireframe',
  'skeleton',
  'textures',
  'texture',
  'mode',
]);

const KNOWN_PREVIEW_KEYS = new Set([
  'kind',
  'width',
  'height',
  'camera',
  'azimuth',
  'elevation',
  'zoom',
  'environment',
  'background',
  'sheet',
  'mode',
  'clip',
  'time',
  'fps',
  'duration',
  'wireframe',
  'skeleton',
  'textures',
  'texture',
  'scale',
  'stage',
  'variant',
  'cutaway',
]);

/** Throws a file-attributed declaration parse/validation error. */
export function failDecl(file: string, message: string): never {
  throw new Error(`${file}: ${message}`);
}

/** Reads a signed numeric, string, boolean, or identifier scalar token from a declaration block. */
export const readScalarToken = (
  tokens: readonly ProgramToken[],
  index: number,
  file: string,
): { readonly value: unknown; readonly nextIndex: number } => {
  const tok = tokens[index];
  if (!tok || tok.kind === 'eof') failDecl(file, 'Unexpected end of declaration block');
  if (tok.kind === 'symbol' && tok.value === '-') {
    const num = tokens[index + 1];
    if (num?.kind !== 'number') failDecl(file, 'Expected number after "-"');
    return { value: -Number(num.value), nextIndex: index + 2 };
  }
  if (tok.kind === 'number') return { value: Number(tok.value), nextIndex: index + 1 };
  if (tok.kind === 'string') return { value: tok.value, nextIndex: index + 1 };
  if (tok.kind === 'identifier') {
    if (tok.value === 'true') return { value: true, nextIndex: index + 1 };
    if (tok.value === 'false') return { value: false, nextIndex: index + 1 };
    return { value: tok.value, nextIndex: index + 1 };
  }
  return failDecl(file, `Unexpected token "${tok.value}"`);
};

/** Expects the token at `index` to match `value` and returns the next token index. */
export const expectTok = (
  tokens: readonly ProgramToken[],
  index: number,
  value: string,
  file: string,
): number => {
  const tok = tokens[index];
  if (tok?.value !== value) failDecl(file, `Expected "${value}", got "${tok?.value ?? 'EOF'}"`);
  return index + 1;
};

/** Parses a `preview [name] { ... }` token sequence into raw preview properties. */
export const parsePreviewTokens = (
  tokens: readonly ProgramToken[],
  startIndex: number,
  file: string,
): { readonly preview: RawDeclaredPreview; readonly nextIndex: number } => {
  let i = startIndex;
  let name = 'default';
  if (tokens[i]?.value !== '{') {
    const nameTok = tokens[i];
    if (nameTok?.kind !== 'identifier') failDecl(file, 'Expected preview view name or "{"');
    name = nameTok.value;
    i += 1;
  }
  i = expectTok(tokens, i, '{', file);
  const properties: Record<string, unknown> = {};
  while (tokens[i] && tokens[i]!.value !== '}') {
    const keyTok = tokens[i];
    if (keyTok?.kind !== 'identifier') failDecl(file, 'Expected preview field name');
    if (Object.hasOwn(properties, keyTok.value)) {
      failDecl(file, `Duplicate preview field "${keyTok.value}"`);
    }
    i = expectTok(tokens, i + 1, '=', file);
    const scalar = readScalarToken(tokens, i, file);
    properties[keyTok.value] = scalar.value;
    i = expectTok(tokens, scalar.nextIndex, ';', file);
  }
  i = expectTok(tokens, i, '}', file);
  return { preview: { name, properties }, nextIndex: i };
};

const validatePreviewValue = (key: string, val: unknown, file: string): unknown => {
  if (key in PREVIEW_ENUMS) {
    const allowed = PREVIEW_ENUMS[key as keyof typeof PREVIEW_ENUMS] as readonly string[];
    if (typeof val !== 'string' || !allowed.includes(val)) {
      failDecl(file, `Invalid ${key} "${String(val)}"`);
    }
    return val;
  }
  if (key in PREVIEW_NUMERIC_RANGES) {
    const [min, max, isInt] = PREVIEW_NUMERIC_RANGES[key]!;
    const ok =
      typeof val === 'number' &&
      Number.isFinite(val) &&
      val >= min &&
      val <= max &&
      (!isInt || Number.isInteger(val));
    if (!ok) failDecl(file, `Preview field ${key} out of range`);
    return val;
  }
  if (['wireframe', 'skeleton', 'textures'].includes(key)) {
    if (typeof val !== 'boolean') failDecl(file, `Preview field ${key} must be boolean`);
    return val;
  }
  if (typeof val !== 'string' || !val.length) {
    failDecl(file, `Preview field ${key} must be nonempty string`);
  }
  return val;
};

const validatePreviewField = (
  kind: DeclaredAssetKind,
  key: string,
  val: unknown,
  file: string,
): unknown => {
  if (!KNOWN_PREVIEW_KEYS.has(key)) failDecl(file, `Unknown preview field "${key}"`);
  if (key === 'cutaway' && kind !== 'structure') failDecl(file, 'cutaway requires structure asset');
  if ((key === 'stage' || key === 'scale') && kind !== 'sprite') {
    failDecl(file, `${key} requires sprite asset`);
  }
  if (key === 'variant' && kind !== 'sound') failDecl(file, 'variant requires sound asset');
  if (MODEL_STRUCTURE_PREVIEW_KEYS.has(key) && kind !== 'model' && kind !== 'structure') {
    const vfxAllowed =
      kind === 'vfx' &&
      (key === 'camera' ||
        key === 'azimuth' ||
        key === 'elevation' ||
        key === 'zoom' ||
        key === 'time');
    if (!vfxAllowed) failDecl(file, `${key} requires model or structure asset`);
  }
  return validatePreviewValue(key, val, file);
};

type MutablePreview = { -readonly [K in keyof DeclaredPreviewSpec]: DeclaredPreviewSpec[K] };

/** Validates and freezes a single `preview` declaration for an asset kind. */
export const validateSinglePreview = (
  kind: DeclaredAssetKind,
  raw: RawDeclaredPreview,
  seen: Set<string>,
  file: string,
): DeclaredPreviewSpec => {
  if (!/^[a-zA-Z_][a-zA-Z0-9_-]*$/.test(raw.name)) {
    failDecl(file, `Invalid preview name "${raw.name}"`);
  }
  if (seen.has(raw.name)) failDecl(file, `Duplicate preview view "${raw.name}"`);
  seen.add(raw.name);
  const out: MutablePreview = { name: raw.name };
  for (const [key, val] of Object.entries(raw.properties)) {
    Reflect.set(out, key, validatePreviewField(kind, key, val, file));
  }
  if (out.kind === 'gif' && out.sheet !== undefined) {
    failDecl(file, 'preview with kind = "gif" cannot specify sheet');
  }
  if (out.sheet === 'turnaround' && kind !== 'model' && kind !== 'structure') {
    failDecl(file, 'sheet turnaround requires model or structure asset');
  }
  if (
    (out.sheet === 'exterior' || out.sheet === 'cutaway' || out.sheet === 'interior') &&
    kind !== 'structure'
  ) {
    failDecl(file, `sheet ${out.sheet} requires structure asset`);
  }
  return Object.freeze(out);
};

/** Lowers an `ashfox 1` named `preview` block AST node into a `RawDeclaredPreview`. */
export const lowerPreviewFromBlock = (stmt: AshfoxNamedBlock, file: string): RawDeclaredPreview => {
  if (stmt.typeRef || stmt.implementsRef || stmt.forRef) {
    failDecl(file, 'Unexpected preview header clause');
  }
  const properties: Record<string, unknown> = {};
  for (const entry of stmt.block.statements) {
    if (entry.kind !== 'assign' || entry.easing !== null) {
      failDecl(file, 'Expected preview field assignment');
    }
    if (Object.hasOwn(properties, entry.path)) {
      failDecl(file, `Duplicate preview field "${entry.path}"`);
    }
    const decoded = ashfoxScalarExprValue(entry.value);
    if (!decoded.ok) failDecl(file, `Unexpected declaration expression "${decoded.kind}"`);
    properties[entry.path] = decoded.value;
  }
  return { name: stmt.name ?? 'default', properties };
};
