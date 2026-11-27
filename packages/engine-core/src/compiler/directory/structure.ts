import type {
  HookFloorFrame,
  HookParentRef,
  HookRoomBounds,
  HookSchemaDecl,
  HooksDocument,
} from '../../hooks/contract';
import { compileHooksForWorkspaceFile } from '../../hooks/resolve';
import { propagateHooksTransforms } from '../../hooks/transform';
import { deepFreeze } from '../../immutable';
import type { CompiledModel } from '../../model/compiled';
import type { DirectoryFile } from '../../project/directory/contract';
import type { AssetSourceParseResult } from '../../project/program/asset/contract';
import { lexProgramSource } from '../../project/program/syntax/lex';
import {
  parseStructureSource,
  StructureInputError,
  type StructureSourceUnit,
} from '../../project/structure';
import {
  compileStructureUnits,
  type StructureAuditEvaluator,
  type StructureProduct,
} from '../structure';
import {
  qualifyCustomAssetKey,
  type CompoundChildPlacement,
  type EvaluatedStructureResult,
  type StructureGrid,
} from '../structure/contract';
import type { CachedCustomModel, DirectoryWorkspaceCache } from './cache';
import {
  compileImportedModel,
  resolveStructureImportPath as relativePath,
} from './structureCustom';

export { collectStructureOnlyCustomPaths } from './structureCustom';

interface StructureGraphState {
  readonly filesByPath: ReadonlyMap<string, DirectoryFile>;
  readonly entryPath: string;
  readonly units: Map<string, StructureSourceUnit>;
  readonly parsedUnitCache: Map<string, StructureSourceUnit>;
  readonly topKinds: Map<string, string | undefined>;
  readonly assetUnits: Map<string, AssetSourceParseResult>;
  readonly visiting: Set<string>;
  readonly customModels: Record<string, CompiledModel>;
  readonly modelCache: Map<string, CachedCustomModel>;
  readonly customModelPaths: Set<string>;
}

const topKindOf = (
  state: StructureGraphState,
  filePath: string,
  source: string,
): string | undefined => {
  if (state.topKinds.has(filePath)) return state.topKinds.get(filePath);
  const kind = lexProgramSource(source).tokens[2]?.value;
  state.topKinds.set(filePath, kind);
  return kind;
};

const parseStructureCached = (
  state: StructureGraphState,
  filePath: string,
  source: string,
): StructureSourceUnit => {
  const cached = state.parsedUnitCache.get(filePath);
  if (cached) return cached;
  const unit = deepFreeze(parseStructureSource(source, filePath));
  state.parsedUnitCache.set(filePath, unit);
  return unit;
};

const visitStructureUnit = (
  state: StructureGraphState,
  filePath: string,
  alias?: string,
  ownerPath?: string,
): void => {
  if (state.visiting.has(filePath)) throw new Error(`Structure import cycle: ${filePath}`);
  const file = state.filesByPath.get(filePath);
  if (!file) throw new Error(`Missing or ignored source: ${filePath}`);
  if (topKindOf(state, filePath, file.source) === 'model') {
    if (!alias || !ownerPath || filePath === state.entryPath)
      throw new Error(`Unexpected model entry: ${filePath}`);
    state.customModels[qualifyCustomAssetKey(ownerPath, alias)] = compileImportedModel(
      filePath,
      state.filesByPath,
      state.modelCache,
      state.customModelPaths,
      state.assetUnits,
    );
    return;
  }
  if (state.units.has(filePath)) return;
  if (state.visiting.size >= 32) throw new Error('Structure import depth exceeds 32');
  state.visiting.add(filePath);
  const unit = parseStructureCached(state, filePath, file.source);
  const ownerKind = ownerPath ? state.units.get(ownerPath)?.kind : undefined;
  const allowStructure = ownerKind === 'structure';
  if (
    filePath !== state.entryPath &&
    unit.kind !== 'module' &&
    !(allowStructure && unit.kind === 'structure')
  ) {
    throw new Error(`Structure import must refer to a module or asset: ${filePath}`);
  }
  state.units.set(filePath, unit);
  for (const dep of unit.imports) {
    visitStructureUnit(state, relativePath(filePath, dep.path), dep.alias, filePath);
  }
  state.visiting.delete(filePath);
};

const prefixParentRef = (
  alias: string,
  parent: HookParentRef | undefined,
): HookParentRef | undefined =>
  parent && (parent.kind === 'room' || parent.kind === 'floor' || parent.kind === 'compound')
    ? { ...parent, id: `${alias}.${parent.id}` }
    : parent;

const prefixSpatialFields = <
  T extends {
    readonly id: string;
    readonly room?: string;
    readonly floor?: string;
    readonly parent?: HookParentRef;
  },
>(
  alias: string,
  item: T,
): T => ({
  ...item,
  id: `${alias}.${item.id}`,
  ...(item.room ? { room: `${alias}.${item.room}` } : {}),
  ...(item.floor ? { floor: `${alias}.${item.floor}` } : {}),
  ...(item.parent ? { parent: prefixParentRef(alias, item.parent) } : {}),
});

const mergeHooksDocs = (base: HooksDocument, children: readonly HooksDocument[]): HooksDocument => {
  if (children.length === 0) return base;
  const schemaById = new Map<string, HookSchemaDecl>();
  for (const s of base.schemas) schemaById.set(s.id, s);
  const anchors = [...base.anchors];
  const volumes = [...base.volumes];
  const cues = [...base.cues];
  const meta = [...base.meta];
  const zones = [...base.zones];
  for (const child of children) {
    for (const s of child.schemas) if (!schemaById.has(s.id)) schemaById.set(s.id, s);
    anchors.push(...child.anchors);
    volumes.push(...child.volumes);
    cues.push(...child.cues);
    meta.push(...child.meta);
    zones.push(...child.zones);
  }
  return Object.freeze({
    schemaVersion: base.schemaVersion,
    assetId: base.assetId,
    schemas: Object.freeze([...schemaById.values()]),
    anchors: Object.freeze(anchors),
    volumes: Object.freeze(volumes),
    cues: Object.freeze(cues),
    meta: Object.freeze(meta),
    zones: Object.freeze(zones),
  });
};

const compileHooksTree = (
  unitPath: string,
  filesByPath: ReadonlyMap<string, DirectoryFile>,
  grid: StructureGrid,
  compoundChildren: readonly CompoundChildPlacement[] | undefined,
  collectedPaths: Set<string>,
): HooksDocument => {
  const floors: Record<string, HookFloorFrame> = {};
  for (const fl of grid.floors) floors[fl.name] = { id: fl.name, y: fl.y, height: fl.height };
  const rooms: Record<string, HookRoomBounds> = {};
  for (const r of grid.rooms) rooms[r.name] = { id: r.name, min: r.from, max: r.to };
  const res = compileHooksForWorkspaceFile(unitPath, filesByPath, { floors, rooms });
  if (!res.ok) {
    const first = res.diagnostics[0]!;
    throw new StructureInputError({
      code: first.code,
      file: first.file,
      pointer: `line:${first.line}:${first.column}`,
      expected: 'valid hook declarations',
      actual: first.message,
    });
  }
  for (const p of res.referencedPaths) collectedPaths.add(p);
  const childDocs = (compoundChildren ?? []).map((child) => {
    const rawChild = compileHooksTree(
      child.unitPath,
      filesByPath,
      child.grid,
      child.compoundChildren,
      collectedPaths,
    );
    const xformed = propagateHooksTransforms(rawChild, {
      postTransforms: [
        {
          kind: 'compound_place',
          alias: child.alias,
          origin: child.origin,
          rotate: child.rotate,
          childSize: child.grid.size,
        },
      ],
    });
    return Object.freeze({
      ...xformed,
      anchors: xformed.anchors.map((a) => prefixSpatialFields(child.alias, a)),
      volumes: xformed.volumes.map((v) => prefixSpatialFields(child.alias, v)),
      cues: xformed.cues.map((c) => ({ ...c, id: `${child.alias}.${c.id}` })),
      meta: xformed.meta.map((m) => ({ ...m, id: `${child.alias}.${m.id}` })),
      zones: xformed.zones.map((z) => prefixSpatialFields(child.alias, z)),
    });
  });
  return mergeHooksDocs(res.document, childDocs);
};

const resolveDirectoryStructureHooks = (
  entryPath: string,
  filesByPath: ReadonlyMap<string, DirectoryFile>,
  grid: StructureGrid,
  compoundChildren: readonly CompoundChildPlacement[] | undefined,
  onPaths: (paths: readonly string[]) => void,
): HooksDocument => {
  const paths = new Set<string>();
  const doc = compileHooksTree(entryPath, filesByPath, grid, compoundChildren, paths);
  onPaths([...paths]);
  return doc;
};

export const compileDirectoryStructure = (
  filesByPath: ReadonlyMap<string, DirectoryFile>,
  entryPath: string,
  evaluateAudit: StructureAuditEvaluator,
  cache?: DirectoryWorkspaceCache,
): {
  readonly structure: StructureProduct;
  readonly rootUnit: StructureSourceUnit;
  readonly structurePaths: readonly string[];
  readonly customPaths: readonly string[];
} => {
  const evaluatedGrids: Map<string, EvaluatedStructureResult> | undefined = cache?.evaluatedGrids;
  const state: StructureGraphState = {
    filesByPath,
    entryPath,
    units: new Map(),
    parsedUnitCache: cache?.structureUnits ?? new Map(),
    topKinds: cache?.topKinds ?? new Map(),
    assetUnits: cache?.assetUnits ?? new Map(),
    visiting: new Set(),
    customModels: {},
    modelCache: cache?.customModels ?? new Map(),
    customModelPaths: new Set(),
  };
  visitStructureUnit(state, entryPath);
  const rootUnit = state.units.get(entryPath)!;
  const nonEmpty = filesByPath
    .get(entryPath)!
    .source.split(/\r?\n/u)
    .filter((l) => l.trim().length > 0).length;
  if (nonEmpty > 140 && rootUnit.imports.length === 0 && rootUnit.prefabs.length >= 3) {
    throw new StructureInputError({
      code: 'structure.monolithic-entry',
      file: entryPath,
      pointer: 'build',
      expected: 'modular imports or fewer inline prefabs',
      actual: `${rootUnit.prefabs.length} inline prefabs across ${nonEmpty} non-empty lines`,
    });
  }
  let hookPaths: readonly string[] = [];
  const structure = compileStructureUnits(
    entryPath,
    state.units,
    state.customModels,
    relativePath,
    evaluateAudit,
    evaluatedGrids,
    (grid, compoundChildren) =>
      resolveDirectoryStructureHooks(entryPath, filesByPath, grid, compoundChildren, (paths) => {
        hookPaths = paths;
      }),
  );
  const hookSet = hookPaths.filter((p) => !state.customModelPaths.has(p));
  return {
    structure,
    rootUnit,
    structurePaths: [...new Set([...state.units.keys(), ...hookSet])],
    customPaths: [...state.customModelPaths],
  };
};
