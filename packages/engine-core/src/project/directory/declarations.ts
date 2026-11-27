import type { ProgramToken } from '../program/syntax/lex';
import type {
  AshfoxAssignStmt,
  AshfoxBareStmt,
  AshfoxBlock,
  AshfoxExpr,
} from '../program/syntax/blockAst';
import { ashfoxScalarExprValue } from '../program/syntax/blockLowering';
import {
  expectTok,
  failDecl,
  lowerPreviewFromBlock,
  parsePreviewTokens,
  readScalarToken,
  validateSinglePreview,
  type DeclaredAssetKind,
  type DeclaredPreviewSpec,
  type RawDeclaredPreview,
} from './previewDecl';

export {
  lowerPreviewFromBlock,
  parsePreviewTokens,
  type DeclaredAssetKind,
  type DeclaredPreviewSpec,
  type RawDeclaredPreview,
};

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

export interface DeclaredOutputSpec {
  readonly format: DeclaredOutputFormat;
  readonly encoding?: 'portable' | 'optimized';
  readonly namespace?: string;
  readonly modelPath?: string;
}

export interface AssetDeclarations {
  readonly outputs: readonly DeclaredOutputSpec[];
  readonly previews: readonly DeclaredPreviewSpec[];
}

export interface RawDeclaredOutput {
  readonly format: string;
  readonly attributes: Readonly<Record<string, unknown>>;
}

const FORMATS_BY_KIND: Readonly<Record<DeclaredAssetKind, readonly DeclaredOutputFormat[]>> = {
  model: ['glb', 'gltf', 'java_block', 'geckolib5', 'bedrock'],
  sprite: ['png'],
  sound: ['wav'],
  structure: ['java_structure', 'glb'],
  vfx: ['glb'],
};

const DEFAULT_OUTPUTS_BY_KIND: Readonly<Record<DeclaredAssetKind, readonly DeclaredOutputSpec[]>> =
  {
    model: [{ format: 'glb' }],
    sprite: [{ format: 'png' }],
    sound: [{ format: 'wav' }],
    structure: [{ format: 'java_structure' }, { format: 'glb' }],
    vfx: [{ format: 'glb' }],
  };

const DEFAULT_OUTPUT_ALLOWED = new Set(DECLARED_OUTPUT_FORMATS as readonly string[]);

/** Parses an `outputs { ... }` token sequence into raw output specifications. */
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

const readEncodingAttr = (
  format: DeclaredOutputFormat,
  val: unknown,
  file: string,
): DeclaredOutputSpec['encoding'] => {
  if (val === undefined) return undefined;
  if (format !== 'glb' && format !== 'gltf') failDecl(file, 'encoding applies only to glb/gltf');
  if (val !== 'portable' && val !== 'optimized') {
    failDecl(file, 'encoding must be portable or optimized');
  }
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
  if (!DEFAULT_OUTPUT_ALLOWED.has(raw.format)) {
    failDecl(file, `Unknown output format "${raw.format}"`);
  }
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

const lowerBareOutputStmt = (stmt: AshfoxBareStmt, file: string): RawDeclaredOutput => {
  const attributes: Record<string, unknown> = {};
  for (let i = 0; i < stmt.items.length; i += 3) {
    const keyItem = stmt.items[i];
    const eqItem = stmt.items[i + 1];
    const valItem = stmt.items[i + 2];
    if (
      keyItem?.kind !== 'expr' ||
      keyItem.value.kind !== 'path' ||
      eqItem?.kind !== 'symbol' ||
      eqItem.value !== '=' ||
      valItem?.kind !== 'expr'
    ) {
      failDecl(file, 'Expected output attribute assignment');
    }
    const decoded = ashfoxScalarExprValue(valItem.value);
    if (!decoded.ok) failDecl(file, `Unexpected declaration expression "${decoded.kind}"`);
    attributes[keyItem.value.value] = decoded.value;
  }
  return { format: stmt.stmtKind, attributes };
};

export const lowerOutputsFromBlock = (
  block: AshfoxBlock,
  file: string,
): readonly RawDeclaredOutput[] =>
  block.statements.map((stmt) => {
    if (stmt.kind !== 'bare' || stmt.block !== null) {
      return failDecl(file, 'Expected output format statement inside outputs');
    }
    return lowerBareOutputStmt(stmt, file);
  });

const lowerOutputsFromList = (expr: AshfoxExpr, file: string): readonly RawDeclaredOutput[] => {
  if (expr.kind !== 'list') return failDecl(file, 'outputs must be a list of format names');
  return expr.elements.map((elem) => {
    if (elem.kind !== 'path') return failDecl(file, 'Expected output format name');
    return { format: elem.value, attributes: {} };
  });
};

export const lowerAssignOutputs = (
  stmt: AshfoxAssignStmt,
  file: string,
): readonly RawDeclaredOutput[] => lowerOutputsFromList(stmt.value, file);
