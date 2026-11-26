import { lexProgramSource, type ProgramToken } from '../project/program/syntax/lex';
import { sha256Digest } from '../provenance/digest';
import { compareText } from '../stableOrder';
import type { HookDiagnostic, HookSourceSpan, HookSourceUnit, HookUnitKind } from './contract';

export type BoilerplateBlockKind = string;

export interface ModularityFileInput {
  readonly path: string;
  readonly source: string;
  readonly parsedUnit?: HookSourceUnit;
}

export interface ModularityGuardOptions {
  readonly minBoilerplateTokens?: number;
  readonly duplicateSeverity?: 'error' | 'warning';
  readonly unusedSeverity?: 'error' | 'warning';
  readonly ignoreUnreferencedModuleExportsWhenNoEntries?: boolean;
}

export interface BoilerplateOccurrence {
  readonly file: string;
  readonly kind: BoilerplateBlockKind;
  readonly id: string;
  readonly line: number;
  readonly column: number;
  readonly span: HookSourceSpan;
}

export interface DuplicateBoilerplateGroup {
  readonly hash: string;
  readonly kind: BoilerplateBlockKind;
  readonly occurrences: readonly BoilerplateOccurrence[];
}

export interface ModularityGuardResult {
  readonly ok: boolean;
  readonly diagnostics: readonly HookDiagnostic[];
  readonly duplicateGroups: readonly DuplicateBoilerplateGroup[];
  readonly summary: Readonly<{
    readonly filesScanned: number;
    readonly errorCount: number;
    readonly warningCount: number;
    readonly duplicateGroupCount: number;
  }>;
}

type ImportRec = { path: string; resolved: string; alias: string; span: HookSourceSpan };
type SchemaRec = { name: string; ns: string; inline: boolean; span: HookSourceSpan };
type BlockRec = { kind: string; id: string; hash: string; count: number; span: HookSourceSpan };
type FileFacts = {
  file: string;
  unitKind: HookUnitKind;
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

const UNIT_KINDS = new Set('module structure model asset sprite sound compound hooks'.split(' '));
const HOOK_KINDS = new Set('anchor volume cue meta zone'.split(' '));
const NAMED_BLOCKS = new Set(
  'prefab voice timeline sequence material surface component stamp mask'.split(' '),
);
const DECL_KW = new Set([
  ...'module asset structure compound sprite sound hooks schema room floor'.split(' '),
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

const diag = (
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

const blockHash = (
  kind: BoilerplateBlockKind,
  tokens: readonly ProgramToken[],
  idIdx: number | null,
): string => {
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
  const idx = tokens[0]?.value === 'ashfox-model' ? (tokens[1]?.kind === 'number' ? 2 : 1) : 0;
  const [decl, name, brace] = [tokens[idx], tokens[idx + 1], tokens[idx + 2]];
  if (
    decl?.kind === 'identifier' &&
    UNIT_KINDS.has(decl.value) &&
    name?.kind === 'identifier' &&
    brace?.value === '{'
  ) {
    const unitKind: HookUnitKind = decl.value === 'asset' ? 'model' : (decl.value as HookUnitKind);
    return {
      unitKind,
      unitId: name.value,
      bodyStart: idx + 3,
      bodyEnd: matchBrace(tokens, idx + 2),
    };
  }
  return { unitKind: 'hooks' as HookUnitKind, unitId: '', bodyStart: idx, bodyEnd: tokens.length };
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
  addBlock(f, kind, tokens[kwIdx + 1]!.value, tokens.slice(kwIdx, blockEnd + 1), 1);
  if (kind === 'surface' || kind === 'component') {
    const open = tokens.slice(kwIdx, blockEnd + 1).findIndex((t) => t.value === '{');
    if (open >= 0) scanRange(tokens, kwIdx + open + 1, blockEnd, f);
  }
  return blockEnd + 1;
};

const scanKeyword = (
  tokens: readonly ProgramToken[],
  kwIdx: number,
  end: number,
  exported: boolean,
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
  if (kw.value === 'asset' && exported && hasName) {
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
    const exported = tokens[idx]?.kind === 'identifier' && tokens[idx]!.value === 'export';
    const kwIdx = exported ? idx + 1 : idx;
    idx =
      tokens[kwIdx]?.kind === 'identifier' ? scanKeyword(tokens, kwIdx, end, exported, f) : idx + 1;
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
  const isVal = prev && VALUE_PREV.has(prev.value) && !isLhs && !DECL_KW.has(prev.value);
  if (aliases.has(tok.value) && isVal) f.usedAliases.add(tok.value);
  if (prev?.kind === 'identifier' && prev.value === 'as' && schemas.has(tok.value))
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
      const resolved = resolveImport(f.file, imp.path, f.known);
      f.imports.push({ path: imp.path, resolved, alias: imp.alias, span: imp.span });
    }
  }
  for (const d of [...unit.anchors, ...unit.volumes, ...unit.cues, ...unit.meta, ...unit.zones]) {
    mergeHookDecl(d, aliases, f);
  }
};

const analyzeFile = (input: ModularityFileInput, known: ReadonlySet<string>): FileFacts => {
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

const collectDuplicates = (
  facts: readonly FileFacts[],
  minTokens: number,
  sev: 'error' | 'warning',
) => {
  const buckets = new Map<string, { kind: string; items: BoilerplateOccurrence[] }>();
  for (const f of facts) {
    for (const b of f.blocks) {
      if (b.count < minTokens) continue;
      const entry = buckets.get(b.hash) ?? { kind: b.kind, items: [] };
      entry.items.push({
        file: f.file,
        kind: b.kind,
        id: b.id,
        line: b.span.start.line,
        column: b.span.start.column,
        span: b.span,
      });
      buckets.set(b.hash, entry);
    }
  }
  const diagnostics: HookDiagnostic[] = [];
  const groups: DuplicateBoilerplateGroup[] = [];
  for (const [hash, bucket] of [...buckets.entries()].sort((a, b) => compareText(a[0], b[0]))) {
    const distinct = new Set(bucket.items.map((item) => item.file));
    if (distinct.size < 2) continue;
    const ordered = [...bucket.items].sort(
      (a, b) => compareText(a.file, b.file) || a.line - b.line || a.column - b.column,
    );
    groups.push(Object.freeze({ hash, kind: bucket.kind, occurrences: Object.freeze(ordered) }));
    const peers = [...distinct].sort(compareText).join(', ');
    for (const o of ordered) {
      const msg = `Duplicate inline ${o.kind} block (${hash.slice(0, 15)}) across files (${peers}); extract into a shared module and import it.`;
      diagnostics.push(
        diag(sev, 'modular.duplicate-boilerplate', msg, `${o.file}#${o.kind}:${o.id}`, o.span),
      );
    }
  }
  return { diagnostics, groups };
};

const isSchemaUsed = (owner: FileFacts, s: SchemaRec, facts: readonly FileFacts[]): boolean => {
  if (owner.localRefs.has(s.name)) return true;
  const qual = s.ns ? `${s.ns}.${s.name}` : s.name;
  return (
    owner.qualRefs.has(qual) ||
    facts.some(
      (c) =>
        c.qualRefs.has(qual) ||
        c.imports.some((i) => i.resolved === owner.file && c.qualRefs.has(`${i.alias}.${s.name}`)),
    )
  );
};

const fileHygiene = (
  f: FileFacts,
  facts: readonly FileFacts[],
  sev: 'error' | 'warning',
  checkUnused: boolean,
): readonly HookDiagnostic[] => {
  const out: HookDiagnostic[] = [];
  for (const s of f.schemas) {
    if (s.inline) {
      const m = `Inline schema "${s.name}" is forbidden in ${f.unitKind} file "${f.file}"; move it to a module with "export schema" and import it.`;
      out.push(
        diag('error', 'hooks.inline-schema-forbidden', m, `${f.file}#schema:${s.name}`, s.span),
      );
    } else if (checkUnused && !isSchemaUsed(f, s, facts)) {
      const q = s.ns ? `${s.ns}.${s.name}` : s.name;
      const m = `Unused schema "${q}" declared in "${f.file}".`;
      out.push(diag(sev, 'modular.unused-schema', m, `${f.file}#schema:${q}`, s.span));
    }
  }
  for (const i of f.imports) {
    if (!f.usedAliases.has(i.alias)) {
      const m = `Unused import "${i.path}" (alias "${i.alias}") in "${f.file}".`;
      out.push(diag(sev, 'modular.unused-import', m, `${f.file}#import:${i.alias}`, i.span));
    }
  }
  return out;
};

const cmpDiag = (a: HookDiagnostic, b: HookDiagnostic): number =>
  compareText(a.file, b.file) ||
  a.line - b.line ||
  a.column - b.column ||
  compareText(a.code, b.code);

export const checkWorkspaceModularity = (
  files: readonly ModularityFileInput[],
  options?: ModularityGuardOptions,
): ModularityGuardResult => {
  const known = new Set(files.map((f) => normalizeWorkspacePath(f.path)));
  const facts = files.map((file) => analyzeFile(file, known));
  const minTokens = options?.minBoilerplateTokens ?? 10;
  const dup = collectDuplicates(facts, minTokens, options?.duplicateSeverity ?? 'error');
  const checkSchemas =
    !(options?.ignoreUnreferencedModuleExportsWhenNoEntries ?? false) ||
    facts.some((f) => f.unitKind !== 'module');
  const unusedSev = options?.unusedSeverity ?? 'warning';
  const hygiene = facts.flatMap((f) => fileHygiene(f, facts, unusedSev, checkSchemas));
  const diagnostics = Object.freeze([...dup.diagnostics, ...hygiene].sort(cmpDiag));
  const errorCount = diagnostics.filter((d) => d.severity === 'error').length;
  return Object.freeze({
    ok: errorCount === 0,
    diagnostics,
    duplicateGroups: Object.freeze(dup.groups),
    summary: Object.freeze({
      filesScanned: facts.length,
      errorCount,
      warningCount: diagnostics.length - errorCount,
      duplicateGroupCount: dup.groups.length,
    }),
  });
};
