import { deepFreeze } from '../../immutable';
import { parseSpriteSource, type SpriteSourceUnit } from '../../project/sprite/source';
import { SpriteInputError } from '../../project/sprite/contract';
import type { DirectoryFile } from '../../project/directory/contract';
import { isVirtualLibrarySpecifier, virtualLibraryLogicalPath } from '../../project/stdlib/resolve';
import { sha256Digest } from '../../provenance/digest';
import { compileSpriteDocument } from '../sprite/compile';
import type { SpriteModuleLookup } from './cache';

const relative = (owner: string, target: string): string => {
  if (isVirtualLibrarySpecifier(target)) return virtualLibraryLogicalPath(target);
  if (!target.startsWith('./') && !target.startsWith('../'))
    throw new Error('Sprite imports must be relative .ashfox paths');
  if (!target.endsWith('.ashfox') || /[\\\x00-\x1f]/.test(target))
    throw new Error('Invalid sprite import');
  const parts = owner.split('/').slice(0, -1);
  for (const p of target.split('/')) {
    if (p === '.') continue;
    if (p === '..') {
      if (!parts.length) throw new Error('Import escapes root');
      parts.pop();
    } else if (!p) throw new Error('Empty import path component');
    else parts.push(p);
  }
  return parts.join('/');
};

type DeclarationKind = 'masks' | 'materials' | 'stamps';

export interface SpriteLookupCache {
  readonly spriteLookups: Map<string, SpriteModuleLookup>;
  readonly spriteSymbols: Map<string, string>;
}

interface SpriteGraph {
  readonly files: ReadonlyMap<string, DirectoryFile>;
  readonly entry: string;
  readonly parsed: Map<string, SpriteSourceUnit>;
  readonly units: Map<string, SpriteSourceUnit>;
  readonly importTargets: Map<string, ReadonlyMap<string, string>>;
  readonly declIds: Map<string, Readonly<Record<DeclarationKind, ReadonlySet<string>>>>;
  readonly visiting: Set<string>;
  readonly usedImports: Map<string, Set<string>>;
  readonly usedDecls: Set<string>;
  readonly cache?: SpriteLookupCache;
}

const spriteSyntaxError = (code: string, file: string, expected: string, actual: string) =>
  new SpriteInputError({ code, file, pointer: 'build', expected, actual });

const markSpriteImportUsed = (graph: SpriteGraph, path: string, alias: string): void => {
  const used = graph.usedImports.get(path) ?? new Set<string>();
  used.add(alias);
  graph.usedImports.set(path, used);
};

const symbol = (path: string, id: unknown, cache?: Map<string, string>): string => {
  const key = `${path}\u0000${String(id)}`;
  const cached = cache?.get(key);
  if (cached) return cached;
  const computed = 's' + sha256Digest(path + ':' + String(id)).slice(-32);
  cache?.set(key, computed);
  return computed;
};

const buildUnitLookup = (
  path: string,
  unit: SpriteSourceUnit,
  symCache?: Map<string, string>,
): SpriteModuleLookup => ({
  importTargets: new Map(unit.imports.map((imp) => [imp.alias, relative(path, imp.path)])),
  declIds: {
    masks: new Set(unit.masks.map((d) => String(d.id))),
    materials: new Set(unit.materials.map((d) => String(d.id))),
    stamps: new Set(unit.stamps.map((d) => String(d.id))),
  },
  exported: deepFreeze({
    masks: unit.masks.map((m) => ({ ...m, id: symbol(path, m.id, symCache) })),
    materials: unit.materials.map((m) => ({ ...m, id: symbol(path, m.id, symCache) })),
    stamps: unit.stamps.map((m) => ({ ...m, id: symbol(path, m.id, symCache) })),
  }),
});

const indexUnitLookups = (graph: SpriteGraph, path: string, unit: SpriteSourceUnit): void => {
  let lookup = graph.cache?.spriteLookups.get(path);
  if (!lookup) {
    lookup = buildUnitLookup(path, unit, graph.cache?.spriteSymbols);
    graph.cache?.spriteLookups.set(path, lookup);
  }
  graph.importTargets.set(path, lookup.importTargets);
  graph.declIds.set(path, lookup.declIds);
};

const visitUnit = (graph: SpriteGraph, path: string): void => {
  if (graph.visiting.has(path)) throw new Error('Sprite import cycle: ' + path);
  if (graph.units.has(path)) return;
  if (graph.visiting.size >= 32) throw new Error('Sprite import depth exceeds 32');
  const file = graph.files.get(path);
  if (!file) throw new Error('Missing or ignored source: ' + path);
  graph.visiting.add(path);
  const unit = graph.parsed.get(path) ?? parseSpriteSource(file.source, path);
  graph.parsed.set(path, unit);
  if (path !== graph.entry && unit.kind !== 'module')
    throw new Error('Import must refer to a module: ' + path);
  for (const dependency of unit.imports) visitUnit(graph, relative(path, dependency.path));
  graph.units.set(path, unit);
  indexUnitLookups(graph, path, unit);
  graph.visiting.delete(path);
};

/** Owner path and local id named by a `local` or `alias.name` reference. */
const referenceTarget = (graph: SpriteGraph, path: string, reference: string): [string, string] => {
  const parts = reference.split('.');
  if (parts.length === 1) return [path, parts[0]!];
  if (parts.length !== 2) throw new Error('Expected local or alias.name reference');
  const targetPath = graph.importTargets.get(path)!.get(parts[0]!);
  if (!targetPath) throw new Error('Unknown import alias ' + parts[0]);
  markSpriteImportUsed(graph, path, parts[0]!);
  return [targetPath, parts[1]!];
};

const resolve = (
  graph: SpriteGraph,
  path: string,
  reference: unknown,
  kind: DeclarationKind,
): string => {
  if (typeof reference !== 'string') throw new Error('Expected source reference');
  const [owner, id] = referenceTarget(graph, path, reference);
  if (!graph.declIds.get(owner)![kind].has(id))
    throw new Error(`Missing ${kind} declaration ${reference}`);
  graph.usedDecls.add(`${owner}\u0000${kind}\u0000${id}`);
  return symbol(owner, id, graph.cache?.spriteSymbols);
};

const PATTERN_MAT_KEYS = [
  'to_material',
  'mortar_material',
  'edge_material',
  'crack_material',
] as const;

const resolvePatternRefs = (graph: SpriteGraph, entry: string, rawPattern: unknown): unknown => {
  if (!rawPattern || typeof rawPattern !== 'object' || Array.isArray(rawPattern)) return rawPattern;
  const next: Record<string, unknown> = { ...(rawPattern as Record<string, unknown>) };
  for (const key of PATTERN_MAT_KEYS) {
    if (key in next) next[key] = resolve(graph, entry, next[key], 'materials');
  }
  return next;
};

const resolveLayer = (graph: SpriteGraph, entry: string, l: Record<string, unknown>): unknown => {
  const resolved: Record<string, unknown> = { ...l };
  if ('material' in l) resolved.material = resolve(graph, entry, l.material, 'materials');
  if ('pattern' in l) resolved.pattern = resolvePatternRefs(graph, entry, l.pattern);
  if (l.op === 'part') resolved.mask = resolve(graph, entry, l.mask, 'masks');
  if (l.op === 'stamp') resolved.stamp = resolve(graph, entry, l.stamp, 'stamps');
  return resolved;
};

const declarations = (graph: SpriteGraph, kind: DeclarationKind) =>
  [...graph.units].flatMap(
    ([p, u]) =>
      graph.cache?.spriteLookups.get(p)?.exported[kind] ??
      u[kind].map((m) => ({ ...m, id: symbol(p, m.id, graph.cache?.spriteSymbols) })),
  );

const checkSpriteHygiene = (graph: SpriteGraph): void => {
  for (const [unitPath, unit] of graph.units) {
    const used = new Set(graph.usedImports.get(unitPath) ?? []);
    for (const alias of unit.hookAliases ?? []) used.add(alias);
    const dead = unit.imports.find((i) => !used.has(i.alias));
    if (dead)
      throw spriteSyntaxError('sprite.unused-import', unitPath, 'referenced import', dead.alias);
  }
  const root = graph.units.get(graph.entry)!;
  for (const kind of ['masks', 'materials', 'stamps'] as const) {
    const unused = root[kind].find(
      (decl) => !graph.usedDecls.has(`${graph.entry}\u0000${kind}\u0000${String(decl.id)}`),
    );
    if (unused) {
      throw spriteSyntaxError(
        'sprite.unused-declaration',
        graph.entry,
        'used declaration',
        String(unused.id),
      );
    }
  }
  const src = graph.files.get(graph.entry)!.source;
  const nonEmptyLines = src.split(/\r?\n/u).filter((l) => l.trim().length > 0).length;
  const totalDecls = root.masks.length + root.materials.length + root.stamps.length;
  if (nonEmptyLines > 120 && root.imports.length === 0 && totalDecls >= 4) {
    throw spriteSyntaxError(
      'sprite.monolithic-entry',
      graph.entry,
      'modular imports into sprite entry',
      `${totalDecls} inline declarations across ${nonEmptyLines} non-empty lines`,
    );
  }
};

const documentOf = (graph: SpriteGraph, entry: string) => {
  const root = graph.units.get(entry)!;
  if (!root.item) throw new Error('Entry must declare sprite');
  const layers = (root.item.layers as Record<string, unknown>[]).map((l) =>
    resolveLayer(graph, entry, l),
  );
  checkSpriteHygiene(graph);
  return {
    masks: declarations(graph, 'masks'),
    materials: declarations(graph, 'materials'),
    stamps: declarations(graph, 'stamps'),
    item: { ...root.item, layers },
  };
};

const resolveFailure = (entry: string, error: unknown) =>
  error instanceof SpriteInputError
    ? error.diagnostic
    : {
        code: 'sprite.resolve',
        file: entry,
        pointer: '',
        expected: 'closed sprite source graph',
        actual: error instanceof Error ? error.message : String(error),
      };

export const compileDirectorySprite = (
  files: ReadonlyMap<string, DirectoryFile>,
  entry: string,
  parsed: Map<string, SpriteSourceUnit>,
  cache?: SpriteLookupCache,
) => {
  const graph: SpriteGraph = {
    files,
    entry,
    parsed,
    units: new Map(),
    importTargets: new Map(),
    declIds: new Map(),
    visiting: new Set(),
    usedImports: new Map(),
    usedDecls: new Set(),
    cache,
  };
  try {
    visitUnit(graph, entry);
    const result = compileSpriteDocument(documentOf(graph, entry), entry);
    return { result, paths: [...graph.units.keys()].sort() };
  } catch (error) {
    return {
      result: { ok: false as const, diagnostics: [resolveFailure(entry, error)] },
      paths: [...graph.units.keys()],
    };
  }
};
