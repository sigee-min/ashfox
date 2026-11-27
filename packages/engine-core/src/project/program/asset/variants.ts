import type { DamageStateKind, ModelDamageStateMeta } from '../../../model/hitzone';
import { lexProgramSource, type ProgramToken } from '../syntax/lex';
import { expandStaticForTokens } from '../syntax/staticFor';
import { parseAssetSource } from './parse';

export interface ElaboratedVariantSource {
  readonly baseModelId: string;
  readonly variantId: string;
  readonly modelId: string;
  readonly source: string;
  readonly damageState?: ModelDamageStateMeta;
}

interface ParsedVariantTokens {
  readonly id: string;
  readonly bindings: ReadonlyMap<string, readonly ProgramToken[]>;
  readonly damageMeta?: Omit<ModelDamageStateMeta, 'baseId'>;
}

const findMatchingBrace = (tokens: readonly ProgramToken[], openIdx: number): number | null => {
  let depth = 0;
  for (let i = openIdx; i < tokens.length; i += 1) {
    const val = tokens[i]!.value;
    if (val === '{') depth += 1;
    else if (val === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return null;
};

const findBindingSemi = (
  tokens: readonly ProgramToken[],
  start: number,
  closeIdx: number,
): number => {
  let pDepth = 0;
  let bDepth = 0;
  for (let semi = start; semi < closeIdx; semi += 1) {
    const val = tokens[semi]!.value;
    if (val === '(') pDepth += 1;
    else if (val === ')') pDepth = Math.max(0, pDepth - 1);
    else if (val === '[') bDepth += 1;
    else if (val === ']') bDepth = Math.max(0, bDepth - 1);
    else if (val === ';' && pDepth === 0 && bDepth === 0) return semi;
  }
  return closeIdx;
};

const DAMAGE_META_KEYS = new Set(['state', 'break_vfx', 'break_sound']);

const extractVariantDamageMeta = (
  raw: ReadonlyMap<string, readonly ProgramToken[]>,
): Omit<ModelDamageStateMeta, 'baseId'> | undefined => {
  const stateTok = raw.get('state')?.[0];
  const vfxTok = raw.get('break_vfx')?.[0];
  const sfxTok = raw.get('break_sound')?.[0];
  if (!stateTok && !vfxTok && !sfxTok) return undefined;
  const rawState = stateTok?.value ?? 'intact';
  const state: DamageStateKind =
    rawState === 'damaged' || rawState === 'destroyed' ? rawState : 'intact';
  return Object.freeze({
    state,
    ...(vfxTok?.kind === 'string' ? { breakVfx: vfxTok.value } : {}),
    ...(sfxTok?.kind === 'string' ? { breakSound: sfxTok.value } : {}),
  });
};

const readVariantBindings = (
  tokens: readonly ProgramToken[],
  openIdx: number,
  closeIdx: number,
): {
  readonly bindings: ReadonlyMap<string, readonly ProgramToken[]>;
  readonly damageMeta?: Omit<ModelDamageStateMeta, 'baseId'>;
} => {
  const raw = new Map<string, readonly ProgramToken[]>();
  const bindings = new Map<string, readonly ProgramToken[]>();
  let i = openIdx + 1;
  while (i < closeIdx) {
    const key = tokens[i];
    if (key?.kind === 'identifier' && tokens[i + 1]?.value === '=') {
      const semi = findBindingSemi(tokens, i + 2, closeIdx);
      const val = tokens.slice(i + 2, semi);
      raw.set(key.value, val);
      if (!DAMAGE_META_KEYS.has(key.value)) bindings.set(key.value, val);
      i = semi + 1;
      continue;
    }
    i += 1;
  }
  return { bindings, damageMeta: extractVariantDamageMeta(raw) };
};

const findModelHeader = (
  tokens: readonly ProgramToken[],
): { readonly modelNameIndex: number; readonly modelBodyStart: number } | null => {
  for (let i = 0; i < tokens.length - 2; i += 1) {
    if (tokens[i]!.kind === 'identifier' && tokens[i]!.value === 'model') {
      const nameTok = tokens[i + 1];
      if (nameTok?.kind === 'identifier' && tokens[i + 2]?.value === '{') {
        return { modelNameIndex: i + 1, modelBodyStart: i + 2 };
      }
    }
  }
  return null;
};

const isVariantBlockAt = (tokens: readonly ProgramToken[], index: number, depth: number): boolean =>
  depth === 1 &&
  tokens[index]!.kind === 'identifier' &&
  tokens[index]!.value === 'variant' &&
  tokens[index + 1]?.kind === 'identifier' &&
  tokens[index + 2]?.value === '{';

const extractVariantsAndBase = (tokens: readonly ProgramToken[]) => {
  const header = findModelHeader(tokens);
  if (!header) return null;
  const variants: ParsedVariantTokens[] = [];
  const baseTokens: ProgramToken[] = tokens.slice(0, header.modelBodyStart + 1);
  let depth = 1;
  let i = header.modelBodyStart + 1;
  while (i < tokens.length && tokens[i]!.kind !== 'eof') {
    if (isVariantBlockAt(tokens, i, depth)) {
      const closeIdx = findMatchingBrace(tokens, i + 2);
      if (closeIdx === null) return null;
      const parsed = readVariantBindings(tokens, i + 2, closeIdx);
      variants.push({
        id: tokens[i + 1]!.value,
        bindings: parsed.bindings,
        ...(parsed.damageMeta ? { damageMeta: parsed.damageMeta } : {}),
      });
      i = closeIdx + 1;
      continue;
    }
    const val = tokens[i]!.value;
    if (val === '{') depth += 1;
    else if (val === '}') depth -= 1;
    baseTokens.push(tokens[i]!);
    i += 1;
  }
  return { modelNameIndex: header.modelNameIndex, baseTokens, variants };
};

const NO_SPACE_BEFORE = new Set(['.', ';', ',', ':', ')', ']']);
const NO_SPACE_AFTER = new Set(['.', '(', '[']);
const NEWLINE_AFTER = new Set(['{', '}', ';']);

const serializeTokens = (tokens: readonly ProgramToken[]): string => {
  const parts: string[] = [];
  let prev: ProgramToken | undefined;
  for (const tok of tokens) {
    const text = tok.kind === 'string' ? JSON.stringify(tok.value) : tok.value;
    if (prev !== undefined) {
      if (NEWLINE_AFTER.has(prev.value)) parts.push('\n');
      else if (!NO_SPACE_BEFORE.has(tok.value) && !NO_SPACE_AFTER.has(prev.value)) parts.push(' ');
    }
    parts.push(text);
    prev = tok;
  }
  return parts.join('');
};

const stepParenBracket = (
  val: string,
  pDepth: number,
  bDepth: number,
): readonly [number, number] | null => {
  if (val === '(') return [pDepth + 1, bDepth];
  if (val === '[') return [pDepth, bDepth + 1];
  if (val === ')') return pDepth === 0 && bDepth === 0 ? null : [pDepth - 1, bDepth];
  if (val === ']') return bDepth === 0 ? null : [pDepth, bDepth - 1];
  if (pDepth === 0 && bDepth === 0 && (val === ';' || val === ',' || val === '}')) return null;
  return [pDepth, bDepth];
};

const findRhsEnd = (tokens: readonly ProgramToken[], start: number): number => {
  let pDepth = 0;
  let bDepth = 0;
  let i = start;
  while (i < tokens.length) {
    const next = stepParenBracket(tokens[i]!.value, pDepth, bDepth);
    if (next === null) break;
    [pDepth, bDepth] = next;
    i += 1;
  }
  return i;
};

const canReplaceValueIdent = (
  tokens: readonly ProgramToken[],
  index: number,
  bindings: ReadonlyMap<string, readonly ProgramToken[]>,
): boolean => {
  const tok = tokens[index]!;
  if (tok.kind !== 'identifier' || !bindings.has(tok.value)) return false;
  const prev = tokens[index - 1];
  const next = tokens[index + 1];
  return prev?.value !== '.' && next?.value !== '=' && next?.value !== ':';
};

const stepVariantToken = (
  baseTokens: readonly ProgramToken[],
  i: number,
  depth: number,
  bindings: ReadonlyMap<string, readonly ProgramToken[]>,
  out: ProgramToken[],
): number => {
  const tok = baseTokens[i]!;
  if (
    depth >= 1 &&
    tok.kind === 'identifier' &&
    baseTokens[i + 1]?.value === '=' &&
    bindings.has(tok.value)
  ) {
    out.push(tok, baseTokens[i + 1]!, ...bindings.get(tok.value)!);
    return findRhsEnd(baseTokens, i + 2);
  }
  out.push(...(canReplaceValueIdent(baseTokens, i, bindings) ? bindings.get(tok.value)! : [tok]));
  return i + 1;
};

const substituteForVariant = (
  baseTokens: readonly ProgramToken[],
  modelNameIndex: number,
  targetModelId: string,
  bindings: ReadonlyMap<string, readonly ProgramToken[]>,
): readonly ProgramToken[] => {
  const out: ProgramToken[] = [];
  let inImport = false;
  let depth = 0;
  let i = 0;
  while (i < baseTokens.length) {
    const tok = baseTokens[i]!;
    if (i === modelNameIndex) {
      out.push(Object.freeze({ ...tok, value: targetModelId }));
      i += 1;
      continue;
    }
    depth += tok.value === '{' ? 1 : tok.value === '}' ? -1 : 0;
    inImport = inImport || tok.value === 'import';
    if (inImport) {
      if (tok.value === ';') inImport = false;
      out.push(tok);
      i += 1;
      continue;
    }
    i = stepVariantToken(baseTokens, i, depth, bindings, out);
  }
  return out;
};

const formatDamageStateBlock = (meta: ModelDamageStateMeta): string => {
  const parts = [`state = ${meta.state};`];
  if (meta.baseId) parts.push(`base = ${JSON.stringify(meta.baseId)};`);
  if (meta.breakVfx) parts.push(`break_vfx = ${JSON.stringify(meta.breakVfx)};`);
  if (meta.breakSound) parts.push(`break_sound = ${JSON.stringify(meta.breakSound)};`);
  return `\n  damage_state { ${parts.join(' ')} }`;
};

const injectDamageStateBlock = (serialized: string, meta?: ModelDamageStateMeta): string => {
  if (!meta) return serialized;
  const closeIdx = serialized.lastIndexOf('}');
  if (closeIdx < 0) return serialized;
  return `${serialized.slice(0, closeIdx)}${formatDamageStateBlock(meta)}\n}`;
};

/** Expands `variant` matrix blocks inside an asset model into concrete model sources. */
export const elaborateModelVariants = (
  source: string,
  path = 'main.ashfox',
): readonly ElaboratedVariantSource[] => {
  const parsed = parseAssetSource(source, path);
  if (parsed.diagnostics.length > 0 || parsed.unit?.kind !== 'asset') return Object.freeze([]);
  const assembly = parsed.unit.declarations.find((d) => d.kind === 'asset');
  if (!assembly?.variants || assembly.variants.length === 0) return Object.freeze([]);
  const lexed = lexProgramSource(source);
  if (lexed.diagnostics.length > 0) return Object.freeze([]);
  const expanded = expandStaticForTokens(lexed.tokens);
  if (expanded.diagnostics.length > 0) return Object.freeze([]);
  const extracted = extractVariantsAndBase(expanded.tokens);
  if (!extracted || extracted.variants.length === 0) return Object.freeze([]);
  const baseModelId = parsed.unit.id;
  return Object.freeze(
    extracted.variants.map((variant) => {
      const modelId = `${baseModelId}_${variant.id}`;
      const tokens = substituteForVariant(
        extracted.baseTokens,
        extracted.modelNameIndex,
        modelId,
        variant.bindings,
      );
      const damageState: ModelDamageStateMeta | undefined = variant.damageMeta
        ? Object.freeze({ ...variant.damageMeta, baseId: baseModelId })
        : undefined;
      return Object.freeze({
        baseModelId,
        variantId: variant.id,
        modelId,
        source: injectDamageStateBlock(serializeTokens(tokens), damageState),
        ...(damageState ? { damageState } : {}),
      });
    }),
  );
};
