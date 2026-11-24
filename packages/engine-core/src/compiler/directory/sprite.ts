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
}

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
const referenceTarget = (units: Units, path: string, reference: string): [string, string] => {
  const parts = reference.split('.');
  if (parts.length === 1) return [path, parts[0]!];
  if (parts.length !== 2) throw new Error('Expected local or alias.name reference');
  const imported = units.get(path)!.imports.find((i) => i.alias === parts[0]);
  if (!imported) throw new Error('Unknown import alias ' + parts[0]);
  return [relative(path, imported.path), parts[1]!];
};

const resolve = (units: Units, path: string, reference: unknown, kind: DeclarationKind): string => {
  if (typeof reference !== 'string') throw new Error('Expected source reference');
  const [owner, id] = referenceTarget(units, path, reference);
  if (!units.get(owner)![kind].some((d) => d.id === id))
    throw new Error(`Missing ${kind} declaration ${reference}`);
  return symbol(owner, id);
};

const resolveLayer = (units: Units, entry: string, l: Record<string, unknown>): unknown => {
  if (l.op === 'part')
    return {
      ...l,
      mask: resolve(units, entry, l.mask, 'masks'),
      material: resolve(units, entry, l.material, 'materials'),
    };
  if (l.op === 'stamp') return { ...l, stamp: resolve(units, entry, l.stamp, 'stamps') };
  return l;
};

const declarations = (units: Units, kind: DeclarationKind) =>
  [...units].flatMap(([p, u]) => u[kind].map((m) => ({ ...m, id: symbol(p, m.id) })));

const studyOf = (units: Units, entry: string) => {
  const root = units.get(entry)!;
  if (!root.item) throw new Error('Entry must declare sprite');
  return {
    format: 'ashfox-item-study',
    version: 1,
    masks: declarations(units, 'masks'),
    materials: declarations(units, 'materials'),
    stamps: declarations(units, 'stamps'),
    items: [
      {
        ...root.item,
        layers: (root.item.layers as Record<string, unknown>[]).map((l) =>
          resolveLayer(units, entry, l),
        ),
      },
    ],
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
  const graph: SpriteGraph = { files, entry, parsed, units: new Map(), visiting: new Set() };
  try {
    visitUnit(graph, entry);
    const result = compileItemStudy(JSON.stringify(studyOf(graph.units, entry)), entry);
    return { result, paths: [...graph.units.keys()].sort() };
  } catch (error) {
    return {
      result: { ok: false as const, diagnostics: [resolveFailure(entry, error)] },
      paths: [...graph.units.keys()],
    };
  }
};
