import { parseSpriteSource, type SpriteSourceUnit } from '../../project/sprite/source';
import { SpriteInputError } from '../../project/sprite/contract';
import type { DirectoryFile } from '../../project/directory/contract';
import { sha256Digest } from '../../provenance/digest';
import { compileItemStudy } from '../sprite/compile';

const relative = (owner: string, target: string): string => {
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
type Units = ReadonlyMap<string, SpriteSourceUnit>;

/** Mutable import-graph walk state for one sprite entry. */
interface SpriteGraph {
  readonly files: ReadonlyMap<string, DirectoryFile>;
  readonly entry: string;
  readonly parsed: Map<string, SpriteSourceUnit>;
  readonly units: Map<string, SpriteSourceUnit>;
  readonly visiting: Set<string>;
  readonly usedImports: Map<string, Set<string>>;
  readonly usedDecls: Set<string>;
}

const spriteSyntaxError = (code: string, file: string, expected: string, actual: string) =>
  new SpriteInputError({ code, file, pointer: 'build', expected, actual });

const markSpriteImportUsed = (graph: SpriteGraph, path: string, alias: string): void => {
  const used = graph.usedImports.get(path) ?? new Set<string>();
  used.add(alias);
  graph.usedImports.set(path, used);
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
  graph.visiting.delete(path);
};

const symbol = (path: string, id: unknown): string =>
  's' + sha256Digest(path + ':' + String(id)).slice(-32);

/** Owner path and local id named by a `local` or `alias.name` reference. */
const referenceTarget = (graph: SpriteGraph, path: string, reference: string): [string, string] => {
  const parts = reference.split('.');
  if (parts.length === 1) return [path, parts[0]!];
  if (parts.length !== 2) throw new Error('Expected local or alias.name reference');
  const imported = graph.units.get(path)!.imports.find((i) => i.alias === parts[0]);
  if (!imported) throw new Error('Unknown import alias ' + parts[0]);
  markSpriteImportUsed(graph, path, imported.alias);
  return [relative(path, imported.path), parts[1]!];
};

const resolve = (
  graph: SpriteGraph,
  path: string,
  reference: unknown,
  kind: DeclarationKind,
): string => {
  if (typeof reference !== 'string') throw new Error('Expected source reference');
  const [owner, id] = referenceTarget(graph, path, reference);
  if (!graph.units.get(owner)![kind].some((d) => d.id === id))
    throw new Error(`Missing ${kind} declaration ${reference}`);
  graph.usedDecls.add(`${owner}\u0000${kind}\u0000${id}`);
  return symbol(owner, id);
};

const resolveLayer = (graph: SpriteGraph, entry: string, l: Record<string, unknown>): unknown => {
  if (l.op === 'part')
    return {
      ...l,
      mask: resolve(graph, entry, l.mask, 'masks'),
      material: resolve(graph, entry, l.material, 'materials'),
    };
  if (l.op === 'stamp') return { ...l, stamp: resolve(graph, entry, l.stamp, 'stamps') };
  return l;
};

const declarations = (units: Units, kind: DeclarationKind) =>
  [...units].flatMap(([p, u]) => u[kind].map((m) => ({ ...m, id: symbol(p, m.id) })));

const checkSpriteHygiene = (graph: SpriteGraph): void => {
  for (const [unitPath, unit] of graph.units) {
    const used = graph.usedImports.get(unitPath) ?? new Set<string>();
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

const studyOf = (graph: SpriteGraph, entry: string) => {
  const root = graph.units.get(entry)!;
  if (!root.item) throw new Error('Entry must declare sprite');
  const layers = (root.item.layers as Record<string, unknown>[]).map((l) =>
    resolveLayer(graph, entry, l),
  );
  checkSpriteHygiene(graph);
  return {
    format: 'ashfox-item-study',
    version: 1,
    masks: declarations(graph.units, 'masks'),
    materials: declarations(graph.units, 'materials'),
    stamps: declarations(graph.units, 'stamps'),
    items: [{ ...root.item, layers }],
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
) => {
  const graph: SpriteGraph = {
    files,
    entry,
    parsed,
    units: new Map(),
    visiting: new Set(),
    usedImports: new Map(),
    usedDecls: new Set(),
  };
  try {
    visitUnit(graph, entry);
    const result = compileItemStudy(JSON.stringify(studyOf(graph, entry)), entry);
    return { result, paths: [...graph.units.keys()].sort() };
  } catch (error) {
    return {
      result: { ok: false as const, diagnostics: [resolveFailure(entry, error)] },
      paths: [...graph.units.keys()],
    };
  }
};
