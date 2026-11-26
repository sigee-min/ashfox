import type { ProgramToken } from '../program/syntax/lex';

export const DECLARED_OUTPUT_FORMATS = [
  'glb',
  'gltf',
  'java_block',
  'java_structure',
  'geckolib5',
  'bedrock',
  'png',
  'wav',
] as const;

export type DeclaredOutputFormat = (typeof DECLARED_OUTPUT_FORMATS)[number];
export type DeclaredAssetKind = 'model' | 'sprite' | 'sound' | 'structure';

export interface DeclaredOutputSpec {
  readonly format: DeclaredOutputFormat;
  readonly encoding?: 'portable' | 'optimized';
  readonly namespace?: string;
  readonly modelPath?: string;
}

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
  readonly sheet?: 'turnaround' | 'inspect' | 'exterior' | 'cutaway' | 'interior';
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

export interface AssetDeclarations {
  readonly outputs: readonly DeclaredOutputSpec[];
  readonly previews: readonly DeclaredPreviewSpec[];
}

export interface RawDeclaredOutput {
  readonly format: string;
  readonly attributes: Readonly<Record<string, unknown>>;
}

export interface RawDeclaredPreview {
  readonly name: string;
  readonly properties: Readonly<Record<string, unknown>>;
}

const FORMATS_BY_KIND: Readonly<Record<DeclaredAssetKind, readonly DeclaredOutputFormat[]>> = {
  model: ['glb', 'gltf', 'java_block', 'geckolib5', 'bedrock'],
  sprite: ['png'],
  sound: ['wav'],
  structure: ['java_structure', 'glb'],
};

const DEFAULT_OUTPUTS_BY_KIND: Readonly<Record<DeclaredAssetKind, readonly DeclaredOutputSpec[]>> =
  {
    model: [{ format: 'glb' }],
    sprite: [{ format: 'png' }],
    sound: [{ format: 'wav' }],
    structure: [{ format: 'java_structure' }, { format: 'glb' }],
  };

const PREVIEW_ENUMS = {
  kind: ['still', 'gif'],
  camera: ['perspective', 'native', 'front', 'back', 'left', 'right', 'top', 'bottom'],
  environment: ['studio', 'day', 'evening', 'night'],
  background: ['environment', 'transparent', 'checker', 'light', 'dark'],
  sheet: ['turnaround', 'inspect', 'exterior', 'cutaway', 'interior'],
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

const DEFAULT_OUTPUT_ALLOWED = new Set(DECLARED_OUTPUT_FORMATS as readonly string[]);

function failDecl(file: string, message: string): never {
  throw new Error(`${file}: ${message}`);
}

const readScalarToken = (
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

const expectTok = (
  tokens: readonly ProgramToken[],
  index: number,
  value: string,
  file: string,
): number => {
  const tok = tokens[index];
  if (tok?.value !== value) failDecl(file, `Expected "${value}", got "${tok?.value ?? 'EOF'}"`);
  return index + 1;
};

export const parseOutputsTokens = (
  tokens: readonly ProgramToken[],
  startIndex: number,
  file: string,
): { readonly outputs: readonly RawDeclaredOutput[]; readonly nextIndex: number } => {
  let i = expectTok(tokens, startIndex, '{', file);
  const outputs: RawDeclaredOutput[] = [];
  while (tokens[i] && tokens[i]!.value !== '}') {
    const fmtTok = tokens[i];
    if (fmtTok?.kind !== 'identifier') failDecl(file, 'Expected output format name');
    i += 1;
    const attributes: Record<string, unknown> = {};
    while (tokens[i] && tokens[i]!.value !== ';') {
      const keyTok = tokens[i];
      if (keyTok?.kind !== 'identifier') failDecl(file, 'Expected output attribute name');
      i = expectTok(tokens, i + 1, '=', file);
      const scalar = readScalarToken(tokens, i, file);
      attributes[keyTok.value] = scalar.value;
      i = scalar.nextIndex;
    }
    i = expectTok(tokens, i, ';', file);
    outputs.push({ format: fmtTok.value, attributes });
  }
  i = expectTok(tokens, i, '}', file);
  return { outputs, nextIndex: i };
};

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
    if (Object.hasOwn(properties, keyTok.value))
      failDecl(file, `Duplicate preview field "${keyTok.value}"`);
    i = expectTok(tokens, i + 1, '=', file);
    const scalar = readScalarToken(tokens, i, file);
    properties[keyTok.value] = scalar.value;
    i = expectTok(tokens, scalar.nextIndex, ';', file);
  }
  i = expectTok(tokens, i, '}', file);
  return { preview: { name, properties }, nextIndex: i };
};

const readEncodingAttr = (
  format: DeclaredOutputFormat,
  val: unknown,
  file: string,
): DeclaredOutputSpec['encoding'] => {
  if (val === undefined) return undefined;
  if (format !== 'glb' && format !== 'gltf') failDecl(file, 'encoding applies only to glb/gltf');
  if (val !== 'portable' && val !== 'optimized')
    failDecl(file, 'encoding must be portable or optimized');
  return val;
};

const readNamespaceAttr = (
  format: DeclaredOutputFormat,
  val: unknown,
  file: string,
): string | undefined => {
  if (val === undefined) return undefined;
  if (!['java_block', 'geckolib5', 'bedrock'].includes(format)) {
    failDecl(file, 'namespace requires Minecraft model format');
  }
  if (typeof val !== 'string' || !val.length) failDecl(file, 'namespace must be nonempty string');
  return val;
};

const readModelPathAttr = (
  format: DeclaredOutputFormat,
  val: unknown,
  file: string,
): string | undefined => {
  if (val === undefined) return undefined;
  if (!['java_block', 'geckolib5', 'bedrock', 'glb', 'gltf'].includes(format)) {
    failDecl(file, 'path is not supported for ' + format);
  }
  if (typeof val !== 'string' || !val.length) failDecl(file, 'path must be nonempty string');
  return val;
};

const validateSingleOutput = (
  kind: DeclaredAssetKind,
  raw: RawDeclaredOutput,
  seen: Set<string>,
  file: string,
): DeclaredOutputSpec => {
  if (!DEFAULT_OUTPUT_ALLOWED.has(raw.format))
    failDecl(file, `Unknown output format "${raw.format}"`);
  const format = raw.format as DeclaredOutputFormat;
  if (!FORMATS_BY_KIND[kind].includes(format)) {
    failDecl(file, `Output format "${format}" does not match ${kind} asset`);
  }
  if (seen.has(format)) failDecl(file, `Duplicate output format "${format}"`);
  seen.add(format);
  for (const attrKey of Object.keys(raw.attributes)) {
    if (!['encoding', 'namespace', 'path'].includes(attrKey)) {
      failDecl(file, `Unknown output attribute "${attrKey}"`);
    }
  }
  const encoding = readEncodingAttr(format, raw.attributes.encoding, file);
  const namespace = readNamespaceAttr(format, raw.attributes.namespace, file);
  const modelPath = readModelPathAttr(format, raw.attributes.path, file);
  return Object.freeze({
    format,
    ...(encoding !== undefined ? { encoding } : {}),
    ...(namespace !== undefined ? { namespace } : {}),
    ...(modelPath !== undefined ? { modelPath } : {}),
  });
};

const validatePreviewValue = (key: string, val: unknown, file: string): unknown => {
  if (key in PREVIEW_ENUMS) {
    const allowed = PREVIEW_ENUMS[key as keyof typeof PREVIEW_ENUMS] as readonly string[];
    if (typeof val !== 'string' || !allowed.includes(val))
      failDecl(file, `Invalid ${key} "${String(val)}"`);
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
  if (typeof val !== 'string' || !val.length)
    failDecl(file, `Preview field ${key} must be nonempty string`);
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
  if ((key === 'stage' || key === 'scale') && kind !== 'sprite')
    failDecl(file, `${key} requires sprite asset`);
  if (key === 'variant' && kind !== 'sound') failDecl(file, 'variant requires sound asset');
  if (MODEL_STRUCTURE_PREVIEW_KEYS.has(key) && kind !== 'model' && kind !== 'structure') {
    failDecl(file, `${key} requires model or structure asset`);
  }
  return validatePreviewValue(key, val, file);
};

type MutablePreview = { -readonly [K in keyof DeclaredPreviewSpec]: DeclaredPreviewSpec[K] };

const validateSinglePreview = (
  kind: DeclaredAssetKind,
  raw: RawDeclaredPreview,
  seen: Set<string>,
  file: string,
): DeclaredPreviewSpec => {
  if (!/^[a-zA-Z_][a-zA-Z0-9_-]*$/.test(raw.name))
    failDecl(file, `Invalid preview name "${raw.name}"`);
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

export const defaultOutputsForKind = (kind: DeclaredAssetKind): readonly DeclaredOutputSpec[] =>
  DEFAULT_OUTPUTS_BY_KIND[kind];

export const validateAssetDeclarations = (
  kind: DeclaredAssetKind,
  rawOutputs: readonly RawDeclaredOutput[],
  rawPreviews: readonly RawDeclaredPreview[],
  file: string,
): AssetDeclarations => {
  const seenOutputs = new Set<string>();
  const outputs = rawOutputs.map((entry) => validateSingleOutput(kind, entry, seenOutputs, file));
  const seenPreviews = new Set<string>();
  const previews = rawPreviews.map((entry) =>
    validateSinglePreview(kind, entry, seenPreviews, file),
  );
  return Object.freeze({
    outputs: Object.freeze(outputs.length > 0 ? outputs : defaultOutputsForKind(kind)),
    previews: Object.freeze(previews),
  });
};
