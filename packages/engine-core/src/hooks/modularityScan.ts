import { lexProgramSource, type ProgramToken } from '../project/program/syntax/lex';
import { sha256Digest } from '../provenance/digest';
import { compareText } from '../stableOrder';
import type { HookDiagnostic, HookSourceSpan, HookSourceUnit } from './contract';

export type ImportRec = { path: string; resolved: string; alias: string; span: HookSourceSpan };
export type SchemaRec = { name: string; ns: string; inline: boolean; span: HookSourceSpan };
export type BlockRec = {
  kind: string;
  id: string;
  hash: string;
  count: number;
  span: HookSourceSpan;
};
export type FileFacts = {
  file: string;
  unitKind: string;
  unitId: string;
  imports: ImportRec[];
  schemas: SchemaRec[];
  blocks: BlockRec[];
  usedAliases: Set<string>;
  qualRefs: Set<string>;
  localRefs: Set<string>;
  known: ReadonlySet<string>;
  importOffsets: Set<number>;
};

const UNIT_KINDS = new Set('module model sprite sound structure vfx hooks'.split(' '));
const HOOK_KINDS = new Set('anchor volume cue meta zone'.split(' '));
const NAMED_BLOCKS = new Set(
  'prefab voice seq timeline sequence material surface component stamp mask'.split(' '),
);
const CONTAINER_BLOCKS = new Set(
  'floor room facade bone motion rig skeleton surface component element emitter seq'.split(' '),
);
const DECL_KW = new Set([
  ...'module model sprite sound structure vfx hooks schema room floor'.split(' '),
  ...HOOK_KINDS,
  ...NAMED_BLOCKS,
]);
const VALUE_PREV = new Set('= ( [ , : + - * / %'.split(' '));

export const normalizeWorkspacePath = (rawPath: string): string => {
  const segs: string[] = [];
  for (const part of rawPath.replace(/\\/g, '/').trim().split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..')
      segs.length > 0 && segs[segs.length - 1] !== '..' ? segs.pop() : segs.push(part);
    else segs.push(part);
  }
  return segs.join('/');
};

const resolveImport = (importer: string, spec: string, known: ReadonlySet<string>): string => {
  const dir = importer.includes('/') ? importer.slice(0, importer.lastIndexOf('/')) : '';
  const norm = normalizeWorkspacePath(dir ? `${dir}/${spec}` : spec);
  if (known.has(norm)) return norm;
  return !norm.endsWith('.ashfox') && known.has(`${norm}.ashfox`) ? `${norm}.ashfox` : norm;
};

const spanOf = (file: string, first: ProgramToken, last: ProgramToken): HookSourceSpan =>
  Object.freeze({ file, start: first.span.start, end: last.span.end });

export const hookGuardDiag = (
  severity: 'error' | 'warning',
  code: string,
  message: string,
  token: string,
  span: HookSourceSpan,
): HookDiagnostic => {
  const { file, start } = span;
  return Object.freeze({
    severity,
    code,
    message,
    file,
    line: start.line,
    column: start.column,
    token,
    span,
  });
};

const matchBrace = (tokens: readonly ProgramToken[], openIdx: number): number => {
  let depth = 0;
  for (let idx = openIdx; idx < tokens.length; idx += 1) {
    if (tokens[idx]!.value === '{') depth += 1;
    else if (tokens[idx]!.value === '}' && --depth === 0) return idx;
  }
  return tokens.length - 1;
};

const paletteHash = (body: readonly ProgramToken[]): string => {
  const entries: string[] = [];
  let cur: ProgramToken[] = [];
  let depth = 0;
  for (const tok of body) {
    if (tok.kind === 'symbol' && '{(['.includes(tok.value)) depth += 1;
    else if (tok.kind === 'symbol' && '})]'.includes(tok.value)) depth = Math.max(0, depth - 1);
    if (depth === 0 && tok.kind === 'symbol' && tok.value === ';') {
      if (cur.length > 0) entries.push(cur.map((t) => `${t.kind}:${t.value}`).join('|'));
      cur = [];
    } else cur.push(tok);
  }
  if (cur.length > 0) entries.push(cur.map((t) => `${t.kind}:${t.value}`).join('|'));
  return sha256Digest(`palette{${entries.sort(compareText).join(';')}}`);
};

const blockHash = (kind: string, tokens: readonly ProgramToken[], idIdx: number | null): string => {
  if (kind === 'palette') {
    const open = tokens.findIndex((t) => t.kind === 'symbol' && t.value === '{');
    if (open >= 0 && tokens.length - 1 > open) return paletteHash(tokens.slice(open + 1, -1));
  }
  const ser = tokens
    .map((t, i) => (i === idIdx ? 'identifier:<ID>' : `${t.kind}:${t.value}`))
    .join('|');
  return sha256Digest(`${kind}:${ser}`);
};

const unitHeader = (tokens: readonly ProgramToken[]) => {
  const idx = tokens[0]?.value === 'ashfox' && tokens[1]?.value === '1' ? 2 : 0;
  const [decl, name, brace] = [tokens[idx], tokens[idx + 1], tokens[idx + 2]];
  if (
    decl?.kind === 'identifier' &&
    UNIT_KINDS.has(decl.value) &&
    name?.kind === 'identifier' &&
    brace?.value === '{'
  ) {
    return {
      unitKind: decl.value,
      unitId: name.value,
      bodyStart: idx + 3,
      bodyEnd: matchBrace(tokens, idx + 2),
    };
  }
  return { unitKind: 'hooks', unitId: '', bodyStart: idx, bodyEnd: tokens.length };
};

const stmtEnd = (tokens: readonly ProgramToken[], start: number, limit: number): number => {
  for (let idx = start; idx < limit; idx += 1) {
    if (tokens[idx]!.kind === 'symbol' && tokens[idx]!.value === ';') return idx;
    if (tokens[idx]!.kind === 'symbol' && tokens[idx]!.value === '{')
      return Math.min(limit - 1, matchBrace(tokens, idx));
  }
  return Math.max(start, limit - 1);
};

const readImport = (tokens: readonly ProgramToken[], idx: number, f: FileFacts): number | null => {
  const [p, asTok, alias] = [tokens[idx + 1], tokens[idx + 2], tokens[idx + 3]];
  if (p?.kind !== 'string' || asTok?.value !== 'as' || alias?.kind !== 'identifier') return null;
  const end = tokens[idx + 4]?.value === ';' ? idx + 4 : idx + 3;
  for (let pos = idx; pos <= end; pos += 1) f.importOffsets.add(tokens[pos]!.span.start.offset);
  f.imports.push({
    path: p.value,
    resolved: resolveImport(f.file, p.value, f.known),
    alias: alias.value,
    span: spanOf(f.file, tokens[idx]!, tokens[end]!),
  });
  return end;
};

const readSchema = (tokens: readonly ProgramToken[], idx: number, f: FileFacts): number | null => {
  const name = tokens[idx + 1];
  if (name?.kind !== 'identifier') return null;
  const end = stmtEnd(tokens, idx, tokens.length);
  f.schemas.push({
    name: name.value,
    ns: f.unitKind === 'module' ? f.unitId : '',
    inline: f.unitKind !== 'module',
    span: spanOf(f.file, tokens[idx]!, tokens[end]!),
  });
  return end;
};

const addBlock = (
  f: FileFacts,
  kind: string,
  id: string,
  slice: readonly ProgramToken[],
  idIdx: number | null,
): void => {
  const span = spanOf(f.file, slice[0]!, slice[slice.length - 1]!);
  f.blocks.push({ kind, id, hash: blockHash(kind, slice, idIdx), count: slice.length, span });
};

const scanBlockStmt = (
  tokens: readonly ProgramToken[],
  kwIdx: number,
  end: number,
  f: FileFacts,
): number => {
  const blockEnd = stmtEnd(tokens, kwIdx, end);
  const kind = tokens[kwIdx]!.value;
  const slice = tokens.slice(kwIdx, blockEnd + 1);
  const isStampCall =
    kind === 'stamp' && !slice.some((t) => t.kind === 'identifier' && t.value === 'pixels');
  if (!isStampCall) addBlock(f, kind, tokens[kwIdx + 1]!.value, slice, 1);
  if (CONTAINER_BLOCKS.has(kind)) {
    const open = slice.findIndex((t) => t.value === '{');
    if (open >= 0) scanRange(tokens, kwIdx + open + 1, blockEnd, f);
  }
  return blockEnd + 1;
};

const scanKeyword = (
  tokens: readonly ProgramToken[],
  kwIdx: number,
  end: number,
  f: FileFacts,
): number => {
  const kw = tokens[kwIdx]!;
  if (kw.value === 'import') return (readImport(tokens, kwIdx, f) ?? kwIdx) + 1;
  if (kw.value === 'schema') return (readSchema(tokens, kwIdx, f) ?? kwIdx) + 1;
  if (kw.value === 'palette' && tokens[kwIdx + 1]?.value === '{') {
    const close = Math.min(end - 1, matchBrace(tokens, kwIdx + 1));
    addBlock(f, 'palette', 'palette', tokens.slice(kwIdx, close + 1), null);
    return close + 1;
  }
  const hasName = tokens[kwIdx + 1]?.kind === 'identifier';
  if ((HOOK_KINDS.has(kw.value) || NAMED_BLOCKS.has(kw.value)) && hasName)
    return scanBlockStmt(tokens, kwIdx, end, f);
  if (CONTAINER_BLOCKS.has(kw.value) && hasName) {
    const open = tokens.slice(kwIdx, end).findIndex((t) => t.value === '{');
    if (open >= 0) {
      const close = Math.min(end - 1, matchBrace(tokens, kwIdx + open));
      scanRange(tokens, kwIdx + open + 1, close, f);
      return close + 1;
    }
  }
  return kwIdx + 1;
};

const scanRange = (
  tokens: readonly ProgramToken[],
  start: number,
  end: number,
  f: FileFacts,
): void => {
  let idx = start;
  while (idx < end) {
    const kwIdx =
      tokens[idx]?.kind === 'identifier' && tokens[idx]!.value === 'export' ? idx + 1 : idx;
    idx = tokens[kwIdx]?.kind === 'identifier' ? scanKeyword(tokens, kwIdx, end, f) : idx + 1;
  }
};

const checkIdentRef = (
  tokens: readonly ProgramToken[],
  idx: number,
  aliases: ReadonlySet<string>,
  schemas: ReadonlySet<string>,
  f: FileFacts,
): void => {
  const tok = tokens[idx]!;
  const [prev, next, member] = [tokens[idx - 1], tokens[idx + 1], tokens[idx + 2]];
  if (next?.kind === 'symbol' && next.value === '.' && member?.kind === 'identifier') {
    if (aliases.has(tok.value)) {
      f.usedAliases.add(tok.value);
      f.qualRefs.add(`${tok.value}.${member.value}`);
    }
    return;
  }
  const isLhs = next?.kind === 'symbol' && (next.value === '=' || next.value === ':');
  const isCompoundCall = prev?.kind === 'identifier' && prev.value === 'compound_place';
  const isVal =
    isCompoundCall || (prev && VALUE_PREV.has(prev.value) && !isLhs && !DECL_KW.has(prev.value));
  if (aliases.has(tok.value) && isVal) f.usedAliases.add(tok.value);
  if (prev?.kind === 'symbol' && prev.value === ':' && schemas.has(tok.value))
    f.localRefs.add(tok.value);
};

const collectRefs = (tokens: readonly ProgramToken[], f: FileFacts): void => {
  const aliases = new Set(f.imports.map((i) => i.alias));
  const schemas = new Set(f.schemas.map((s) => s.name));
  for (let idx = 0; idx < tokens.length; idx += 1) {
    if (
      !f.importOffsets.has(tokens[idx]!.span.start.offset) &&
      tokens[idx]!.kind === 'identifier'
    ) {
      checkIdentRef(tokens, idx, aliases, schemas, f);
    }
  }
};

const mergeHookDecl = (
  decl: {
    readonly schema?: string;
    readonly props: readonly {
      readonly value: { readonly kind: string; readonly value: unknown };
    }[];
  },
  aliases: ReadonlySet<string>,
  f: FileFacts,
): void => {
  const dot = decl.schema ? decl.schema.indexOf('.') : -1;
  if (dot > 0 && decl.schema) {
    const prefix = decl.schema.slice(0, dot);
    if (aliases.has(prefix)) f.usedAliases.add(prefix);
    f.qualRefs.add(decl.schema);
  } else if (decl.schema) f.localRefs.add(decl.schema);
  for (const p of decl.props) {
    if (p.value.kind === 'ref' && typeof p.value.value === 'string' && aliases.has(p.value.value)) {
      f.usedAliases.add(p.value.value);
    }
  }
};

const mergeParsedUnit = (unit: HookSourceUnit, f: FileFacts): void => {
  for (const s of unit.schemas) {
    if (!f.schemas.some((i) => i.name === s.name))
      f.schemas.push({ name: s.name, ns: s.namespace, inline: s.inline, span: s.span });
  }
  const aliases = new Set(f.imports.map((i) => i.alias));
  for (const imp of unit.imports) {
    aliases.add(imp.alias);
    if (!f.imports.some((i) => i.alias === imp.alias)) {
      f.imports.push({
        path: imp.path,
        resolved: resolveImport(f.file, imp.path, f.known),
        alias: imp.alias,
        span: imp.span,
      });
    }
  }
  for (const d of [...unit.anchors, ...unit.volumes, ...unit.cues, ...unit.meta, ...unit.zones]) {
    mergeHookDecl(d, aliases, f);
  }
};

export const analyzeModularityFile = (
  input: { readonly path: string; readonly source: string; readonly parsedUnit?: HookSourceUnit },
  known: ReadonlySet<string>,
): FileFacts => {
  const file = normalizeWorkspacePath(input.path);
  const tokens = lexProgramSource(input.source).tokens.filter((tok) => tok.kind !== 'eof');
  const hdr = unitHeader(tokens);
  const f: FileFacts = {
    file,
    unitKind: input.parsedUnit?.unitKind ?? hdr.unitKind,
    unitId: input.parsedUnit?.id ?? hdr.unitId,
    imports: [],
    schemas: [],
    blocks: [],
    usedAliases: new Set(),
    qualRefs: new Set(),
    localRefs: new Set(),
    known,
    importOffsets: new Set(),
  };
  scanRange(tokens, hdr.bodyStart, hdr.bodyEnd, f);
  collectRefs(tokens, f);
  if (input.parsedUnit) mergeParsedUnit(input.parsedUnit, f);
  return f;
};
