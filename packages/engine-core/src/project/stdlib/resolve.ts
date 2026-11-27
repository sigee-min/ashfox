import { compareText } from '../../stableOrder';
import { lexProgramSource, type ProgramToken } from '../program/syntax/lex';
import type {
  VirtualLibraryDescriptor,
  VirtualModuleDescription,
  VirtualModuleExport,
  VirtualModuleParam,
} from './contract';

export const STD_LIBRARY_PREFIX = 'std/';
export const STD_LOGICAL_ROOT = 'library/std/';

const VIRTUAL_SPECIFIER_RE = /^std\/[a-z][a-z0-9_]*(?:\/[a-z][a-z0-9_]*){1,3}$/;
const STD_PATH_PREFIX = 'library/std/';
const ASHFOX_EXT = '.ashfox';

export type VirtualFileLookup =
  | ReadonlyMap<string, unknown>
  | ReadonlySet<string>
  | Readonly<{ readonly has: (key: string) => boolean }>;

/** Returns true when `spec` is a canonical virtual `std/<domain>/<category>/<module>` specifier. */
export const isVirtualLibrarySpecifier = (spec: string): boolean => VIRTUAL_SPECIFIER_RE.test(spec);

/** Maps `"std/model/rig/biped"` to `"library/std/model/rig/biped.ashfox"`. */
export const virtualLibraryLogicalPath = (spec: string): string => {
  if (!isVirtualLibrarySpecifier(spec)) {
    throw new Error(`Invalid virtual library specifier: ${spec}`);
  }
  return `library/${spec}${ASHFOX_EXT}`;
};

/** Maps `"library/std/model/rig/biped.ashfox"` back to `"std/model/rig/biped"`, or null. */
export const virtualLibrarySpecifierFromPath = (logicalPath: string): string | null => {
  if (!logicalPath.startsWith(STD_PATH_PREFIX) || !logicalPath.endsWith(ASHFOX_EXT)) {
    return null;
  }
  const spec = logicalPath.slice('library/'.length, -ASHFOX_EXT.length);
  return isVirtualLibrarySpecifier(spec) ? spec : null;
};

/** Returns true when `logicalPath` points to a canonical `library/std/**` module path. */
export const isStdLibraryLogicalPath = (logicalPath: string): boolean =>
  virtualLibrarySpecifierFromPath(logicalPath) !== null;

const resolveRelativePath = (ownerPath: string, specifier: string): string | null => {
  if (!specifier.startsWith('./') && !specifier.startsWith('../')) return null;
  if (!specifier.endsWith(ASHFOX_EXT) || /[\\\x00-\x1f]/u.test(specifier)) return null;
  const parts = ownerPath.split('/').slice(0, -1);
  for (const segment of specifier.split('/')) {
    if (segment === '.') continue;
    if (segment === '..') {
      if (parts.length === 0) return null;
      parts.pop();
    } else if (!segment) {
      return null;
    } else {
      parts.push(segment);
    }
  }
  return parts.length > 0 ? parts.join('/') : null;
};

/** Resolves either a virtual `"std/..."` import or a relative `./` / `../` `.ashfox` import path. */
export const resolveImportPath = (ownerPath: string, specifier: string): string | null =>
  isVirtualLibrarySpecifier(specifier)
    ? virtualLibraryLogicalPath(specifier)
    : resolveRelativePath(ownerPath, specifier);

/** Resolves an import specifier against `files` (local `library/std/...` overrides virtual entries). */
export const resolveSourceImport = (
  ownerPath: string,
  specifier: string,
  files?: VirtualFileLookup,
): string | null => {
  const resolved = resolveImportPath(ownerPath, specifier);
  if (resolved === null) return null;
  if (files !== undefined && !files.has(resolved)) return null;
  return resolved;
};

const normalizeStdSpecifier = (specifierOrId: string): string => {
  const trimmed = specifierOrId.trim().replace(/^\/+|\/+$/gu, '');
  const withPrefix = trimmed.startsWith(STD_LIBRARY_PREFIX)
    ? trimmed
    : `${STD_LIBRARY_PREFIX}${trimmed}`;
  if (!isVirtualLibrarySpecifier(withPrefix)) {
    throw new Error(`Invalid virtual library specifier: ${specifierOrId}`);
  }
  return withPrefix;
};

const matchBrace = (tokens: readonly ProgramToken[], openIdx: number): number => {
  let depth = 0;
  for (let i = openIdx; i < tokens.length; i += 1) {
    if (tokens[i]!.value === '{') depth += 1;
    else if (tokens[i]!.value === '}' && --depth === 0) return i;
  }
  return tokens.length - 1;
};

const formatExprSlice = (tokens: readonly ProgramToken[]): string =>
  tokens
    .map((tok) => (tok.kind === 'string' ? JSON.stringify(tok.value) : tok.value))
    .join(' ')
    .replace(/\s+([,.;)\]])/gu, '$1')
    .replace(/([(\[])\s+/gu, '$1');

const readStmtEnd = (tokens: readonly ProgramToken[], start: number, limit: number): number => {
  for (let i = start; i < limit; i += 1) {
    if (tokens[i]!.value === ';') return i;
    if (tokens[i]!.value === '{') return Math.min(limit - 1, matchBrace(tokens, i));
  }
  return Math.max(start, limit - 1);
};

const parseModuleHeader = (tokens: readonly ProgramToken[]) => {
  const start = tokens[0]?.value === 'ashfox' && tokens[1]?.value === '1' ? 2 : 0;
  const kindTok = tokens[start];
  const idTok = tokens[start + 1];
  const braceTok = tokens[start + 2];
  if (kindTok?.kind === 'identifier' && idTok?.kind === 'identifier' && braceTok?.value === '{') {
    return { unitId: idTok.value, bodyStart: start + 3, bodyEnd: matchBrace(tokens, start + 2) };
  }
  return { unitId: '', bodyStart: start, bodyEnd: tokens.length };
};

const parseDesignParamStmt = (
  tokens: readonly ProgramToken[],
  idx: number,
  closeIdx: number,
): VirtualModuleParam => {
  const semiIdx = readStmtEnd(tokens, idx, closeIdx);
  const eqOffset = tokens.slice(idx + 2, semiIdx).findIndex((t) => t.value === '=');
  const typeEnd = eqOffset >= 0 ? idx + 2 + eqOffset : semiIdx;
  const type = formatExprSlice(tokens.slice(idx + 2, typeEnd));
  const defaultValue =
    eqOffset >= 0 && typeEnd + 1 < semiIdx
      ? formatExprSlice(tokens.slice(typeEnd + 1, semiIdx))
      : undefined;
  return Object.freeze({
    name: tokens[idx]!.value,
    ...(type ? { type } : {}),
    ...(defaultValue ? { defaultValue } : {}),
  });
};

const collectDesignParams = (
  tokens: readonly ProgramToken[],
  openIdx: number,
  closeIdx: number,
  params: VirtualModuleParam[],
): void => {
  let i = openIdx + 1;
  while (i < closeIdx) {
    const cur = tokens[i]!;
    if (cur.value === 'check') {
      i = readStmtEnd(tokens, i, closeIdx) + 1;
    } else if (cur.kind === 'identifier' && tokens[i + 1]?.value === ':') {
      params.push(parseDesignParamStmt(tokens, i, closeIdx));
      i = readStmtEnd(tokens, i, closeIdx) + 1;
    } else {
      i += 1;
    }
  }
};

const collectParamsBlock = (
  tokens: readonly ProgramToken[],
  openIdx: number,
  closeIdx: number,
  params: VirtualModuleParam[],
): void => {
  let i = openIdx + 1;
  while (i < closeIdx) {
    const nameTok = tokens[i];
    if (nameTok?.kind === 'identifier' && tokens[i + 1]?.value === '=') {
      const semi = readStmtEnd(tokens, i, closeIdx);
      params.push(
        Object.freeze({
          name: nameTok.value,
          defaultValue: formatExprSlice(tokens.slice(i + 2, semi)),
        }),
      );
      i = semi + 1;
    } else {
      i += 1;
    }
  }
};

const collectComponentParams = (
  tokens: readonly ProgramToken[],
  openIdx: number,
  closeIdx: number,
  params: VirtualModuleParam[],
): void => {
  let i = openIdx + 1;
  while (i < closeIdx) {
    if (tokens[i]!.value === 'param' && tokens[i + 1]?.kind === 'identifier') {
      const name = tokens[i + 1]!.value;
      const semi = readStmtEnd(tokens, i, closeIdx);
      const type =
        tokens[i + 2]?.value === ':' ? formatExprSlice(tokens.slice(i + 3, semi)) : undefined;
      params.push(Object.freeze({ name, ...(type ? { type } : {}) }));
      i = semi + 1;
    } else if (tokens[i]!.value === '{') {
      i = matchBrace(tokens, i) + 1;
    } else {
      i += 1;
    }
  }
};

const readQualifiedName = (
  tokens: readonly ProgramToken[],
  startIdx: number,
): { readonly name: string; readonly nextIdx: number } => {
  let name = tokens[startIdx]?.value ?? '';
  let scan = startIdx + 1;
  while (tokens[scan]?.value === '.' && tokens[scan + 1]?.kind === 'identifier') {
    name += `.${tokens[scan + 1]!.value}`;
    scan += 2;
  }
  return { name, nextIdx: scan };
};

const readExportKind = (tokens: readonly ProgramToken[], idx: number) => {
  const k1 = tokens[idx + 1]?.value ?? '';
  const twoWord =
    (k1 === 'rig' || k1 === 'surface' || k1 === 'socket') && tokens[idx + 2]?.value === 'contract';
  return { kind: twoWord ? `${k1} contract` : k1, nameIdx: idx + (twoWord ? 3 : 2) };
};

const parseExportDecl = (
  tokens: readonly ProgramToken[],
  idx: number,
  end: number,
  exports: VirtualModuleExport[],
  params: VirtualModuleParam[],
): number => {
  const { kind, nameIdx } = readExportKind(tokens, idx);
  const { name, nextIdx } = readQualifiedName(tokens, nameIdx);
  const rel = tokens[nextIdx]?.value;
  const target =
    rel === 'for' || rel === 'implements' || rel === ':' ? tokens[nextIdx + 1]?.value : undefined;
  const stmtEnd = readStmtEnd(tokens, idx, end);
  if (kind && name) exports.push(Object.freeze({ kind, name, ...(target ? { target } : {}) }));
  const openOffset = tokens.slice(nextIdx, stmtEnd + 1).findIndex((t) => t.value === '{');
  if (openOffset >= 0) {
    const absOpen = nextIdx + openOffset;
    if (kind === 'design') collectDesignParams(tokens, absOpen, stmtEnd, params);
    else if (kind === 'component') collectComponentParams(tokens, absOpen, stmtEnd, params);
  }
  return stmtEnd + 1;
};

const descriptorFromTokens = (
  spec: string,
  tokens: readonly ProgramToken[],
): VirtualLibraryDescriptor => {
  const id = spec.slice(STD_LIBRARY_PREFIX.length);
  const segments = id.split('/');
  const header = parseModuleHeader(tokens);
  return Object.freeze({
    specifier: spec,
    id,
    logicalPath: virtualLibraryLogicalPath(spec),
    domain: segments[0]!,
    category: segments[1]!,
    module: segments.slice(2).join('/'),
    unitId: header.unitId,
  });
};

/** Extracts module path, domain, category, imports, exported symbols, and params from source. */
export const describeVirtualModule = (
  specifierOrId: string,
  source: string,
): VirtualModuleDescription => {
  const spec = normalizeStdSpecifier(specifierOrId);
  const tokens = lexProgramSource(source).tokens.filter((t) => t.kind !== 'eof');
  const header = parseModuleHeader(tokens);
  const imports: string[] = [];
  const exports: VirtualModuleExport[] = [];
  const params: VirtualModuleParam[] = [];
  let idx = header.bodyStart;
  while (idx < header.bodyEnd) {
    const tok = tokens[idx]!;
    if (tok.value === 'import' && tokens[idx + 1]?.kind === 'string') {
      imports.push(tokens[idx + 1]!.value);
      idx = readStmtEnd(tokens, idx, header.bodyEnd) + 1;
    } else if (tok.value === 'params' && tokens[idx + 1]?.value === '{') {
      const close = matchBrace(tokens, idx + 1);
      collectParamsBlock(tokens, idx + 1, close, params);
      idx = close + 1;
    } else if (tok.value === 'export') {
      idx = parseExportDecl(tokens, idx, header.bodyEnd, exports, params);
    } else if (tok.value === '{') {
      idx = matchBrace(tokens, idx) + 1;
    } else {
      idx += 1;
    }
  }
  return Object.freeze({
    ...descriptorFromTokens(spec, tokens),
    imports: Object.freeze(imports),
    exports: Object.freeze(exports),
    params: Object.freeze(params),
    source,
  });
};

/** Returns sorted descriptors for every valid virtual `std/...` entry in `virtualLibraries`. */
export const listVirtualLibraries = (
  virtualLibraries: ReadonlyMap<string, string>,
): readonly VirtualLibraryDescriptor[] =>
  Object.freeze(
    [...virtualLibraries.entries()]
      .filter(([spec]) => isVirtualLibrarySpecifier(spec))
      .sort(([a], [b]) => compareText(a, b))
      .map(([spec, source]) =>
        descriptorFromTokens(
          spec,
          lexProgramSource(source).tokens.filter((t) => t.kind !== 'eof'),
        ),
      ),
  );

/** Filters virtual library descriptors by optional domain/category/module prefix (with or without `std/`). */
export const filterVirtualLibraries = (
  virtualLibraries: ReadonlyMap<string, string>,
  prefix?: string,
): readonly VirtualLibraryDescriptor[] => {
  const all = listVirtualLibraries(virtualLibraries);
  const normalized = prefix
    ?.trim()
    .replace(/^\/+|\/+$/gu, '')
    .replace(/^std\/?/u, '');
  if (!normalized) return all;
  return Object.freeze(
    all.filter((item) => item.id === normalized || item.id.startsWith(`${normalized}/`)),
  );
};

/** Extracts top-level `import "<specifier>" as <alias>;` paths using the shared program lexer. */
export const extractSourceImports = (source: string): readonly string[] => {
  const tokens = lexProgramSource(source).tokens.filter((t) => t.kind !== 'eof');
  const header = parseModuleHeader(tokens);
  const imports: string[] = [];
  let idx = header.bodyStart;
  while (idx < header.bodyEnd) {
    const tok = tokens[idx]!;
    if (tok.value === 'import' && tokens[idx + 1]?.kind === 'string') {
      imports.push(tokens[idx + 1]!.value);
      idx = readStmtEnd(tokens, idx, header.bodyEnd) + 1;
    } else if (tok.value === '{') {
      idx = matchBrace(tokens, idx) + 1;
    } else {
      idx += 1;
    }
  }
  return Object.freeze(imports);
};

const enqueueVirtualDeps = <T extends { readonly path: string; readonly source: string }>(
  current: T,
  available: ReadonlyMap<string, string>,
  present: Set<string>,
  makeFile: (path: string, source: string) => T,
  added: T[],
  queue: T[],
): void => {
  for (const spec of extractSourceImports(current.source)) {
    const target = resolveSourceImport(current.path, spec, available);
    if (!target || !isStdLibraryLogicalPath(target) || present.has(target)) continue;
    const source = available.get(target);
    if (source === undefined) continue;
    present.add(target);
    const created = makeFile(target, source);
    added.push(created);
    queue.push(created);
  }
};

/** Injects transitively referenced virtual `std/*` files, letting local `library/std/` override. */
export const mergeVirtualLibraryFiles = <
  T extends { readonly path: string; readonly source: string },
>(
  files: readonly T[],
  virtualLibraries: ReadonlyMap<string, string> | undefined,
  makeFile: (path: string, source: string) => T,
): readonly T[] => {
  if (!virtualLibraries || virtualLibraries.size === 0) return files;
  const available = new Map<string, string>();
  for (const [spec, source] of virtualLibraries) {
    if (isVirtualLibrarySpecifier(spec)) available.set(virtualLibraryLogicalPath(spec), source);
  }
  for (const file of files) available.set(file.path, file.source);
  const present = new Set(files.map((f) => f.path));
  const queue = [...files];
  const added: T[] = [];
  while (queue.length > 0) {
    enqueueVirtualDeps(queue.pop()!, available, present, makeFile, added, queue);
  }
  return added.length > 0 ? [...files, ...added] : files;
};

/** Builds a synthetic `"std"` workspace package entry for any `library/std/**` logical paths. */
export const buildStdPackageEntry = (logicalPaths: Iterable<string>) => {
  const seen = new Set<string>();
  const modules: Array<{ readonly subpath: string; readonly path: string }> = [];
  for (const filePath of logicalPaths) {
    if (!isStdLibraryLogicalPath(filePath) || seen.has(filePath)) continue;
    seen.add(filePath);
    modules.push({
      subpath: `./${filePath.slice(STD_LOGICAL_ROOT.length, -ASHFOX_EXT.length)}`,
      path: filePath.slice(STD_LOGICAL_ROOT.length),
    });
  }
  if (modules.length === 0) return null;
  modules.sort((a, b) => compareText(a.subpath, b.subpath));
  return {
    name: 'std' as const,
    root: 'library/std' as const,
    manifest: {
      format: 'ashfox-package' as const,
      version: 1 as const,
      dependencies: [] as const,
      entries: [] as const,
      modules,
    },
  };
};
