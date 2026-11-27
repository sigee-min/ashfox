import { compareText } from '../../../stableOrder';
import type { AssetDeclaration, AssetDiagnostic } from '../../../project/program/asset/contract';
import type {
  WorkspaceCompilationClosure,
  WorkspaceCompilationFile,
} from '../../../project/workspace/closure';
import { deepFreeze, freeze } from '../../../immutable';
import { ASSET_BUDGET, AssetBudgetAbort } from './budgets';
import {
  type AssetHirResult,
  type AssetSymbolId,
  type AssetSymbolKind,
  type TypedAssetHir,
  type TypedAssetModule,
  type TypedComponent,
  type TypedMotion,
  type TypedRigContract,
  type TypedSkeleton,
  type TypedSocketContract,
  type TypedSurface,
  type TypedSurfaceContract,
} from './contract';
import {
  buildAssetAssembly,
  type AssemblyContext,
  type AssemblyEntry,
  type AssemblyState,
} from './assembly';
import { buildRigContract, buildSkeleton, buildSocketContract } from './definition';
import { buildSurface, buildSurfaceContract } from './definitionSurface';
import { buildComponent } from './component';
import { buildMotion } from './motion';
import { elaborateAssetDesigns } from './design';
import { compareDiagnostics, nullRecord } from './diagnostics';

interface BuildState extends AssemblyState {
  readonly file: WorkspaceCompilationFile;
}

interface BuildSession {
  readonly diagnostics: AssetDiagnostic[];
  states: ReadonlyMap<string, BuildState>;
  declarations: number;
  treeNodes: number;
  diagnosticLimitReported: boolean;
  treeLimitReported: boolean;
}

const issueFor =
  (session: BuildSession): AssemblyContext['issue'] =>
  (path, span, code, message, hint): void => {
    if (session.diagnostics.length >= ASSET_BUDGET.diagnostics) {
      session.diagnosticLimitReported = true;
      throw new AssetBudgetAbort();
    }
    session.diagnostics.push(
      freeze({
        severity: 'error',
        code,
        message,
        path,
        span,
        ...(hint !== undefined ? { hint } : {}),
      }),
    );
  };

const symbolFor = (file: WorkspaceCompilationFile, declaration: AssetDeclaration): AssetSymbolId =>
  freeze({
    modulePath: file.identity.key,
    name: declaration.id,
    kind: declaration.kind,
    key: [file.identity.key, declaration.kind, declaration.id].join('\u0000'),
  });

const indexState = (
  session: BuildSession,
  file: WorkspaceCompilationFile,
  importTargets: ReadonlyMap<string, string>,
  issue: AssemblyContext['issue'],
): BuildState => {
  const symbols = new Map<string, AssemblyEntry>();
  const exports = new Map<string, AssemblyEntry>();
  for (const declaration of file.unit.declarations) {
    session.declarations += 1;
    if (session.declarations > ASSET_BUDGET.declarations) {
      issue(
        file.identity.path,
        declaration.span,
        'asset.declaration-limit',
        'Selected asset closure exceeds the declaration budget.',
      );
      throw new AssetBudgetAbort();
    }
    if (symbols.has(declaration.id))
      issue(
        file.identity.path,
        declaration.span,
        'asset.duplicate-symbol',
        `Symbol "${declaration.id}" is declared more than once.`,
      );
    const entry = freeze({
      symbol: symbolFor(file, declaration),
      declaration,
      path: file.identity.path,
    });
    symbols.set(declaration.id, entry);
    if (declaration.exported) exports.set(declaration.id, entry);
  }
  return freeze({
    path: file.identity.path,
    file,
    imports: new Map(importTargets),
    symbols,
    exports,
  });
};

const createStates = (
  closure: WorkspaceCompilationClosure,
  session: BuildSession,
  issue: AssemblyContext['issue'],
): ReadonlyMap<string, BuildState> => {
  const edgeMaps = new Map<string, Map<string, string>>();
  for (const edge of closure.imports) {
    const aliases = edgeMaps.get(edge.importer.key) ?? new Map<string, string>();
    if (aliases.has(edge.alias))
      issue(
        edge.importer.path,
        freeze({
          start: edge.source.start,
          end: edge.source.end,
        }),
        'asset.duplicate-import-alias',
        `Import alias "${edge.alias}" is declared more than once.`,
      );
    aliases.set(edge.alias, edge.target.key);
    edgeMaps.set(edge.importer.key, aliases);
  }
  const states = new Map<string, BuildState>();
  for (const file of closure.files)
    states.set(
      file.identity.key,
      indexState(session, file, edgeMaps.get(file.identity.key) ?? new Map(), issue),
    );
  return states;
};

const resolveFor =
  (session: BuildSession, issue: AssemblyContext['issue']): AssemblyContext['resolve'] =>
  (state, name, expected) => {
    let entry: AssemblyEntry | undefined;
    if (name.segments.length === 1) entry = state.symbols.get(name.segments[0]!);
    else if (name.segments.length === 2) {
      const targetKey = state.imports.get(name.segments[0]!);
      const target = targetKey === undefined ? undefined : session.states.get(targetKey);
      entry = target?.exports.get(name.segments[1]!);
    }
    if (entry === undefined) {
      issue(
        state.path,
        name.span,
        'asset.unresolved-symbol',
        `Cannot resolve nominal symbol "${name.segments.join('.')}".`,
      );
      return null;
    }
    if (expected !== undefined && entry.symbol.kind !== expected) {
      issue(
        state.path,
        name.span,
        'asset.symbol-kind',
        `Symbol "${name.segments.join('.')}" is ${entry.symbol.kind}, expected ${expected}.`,
      );
      return null;
    }
    return entry;
  };

const moduleFor = (state: BuildState): TypedAssetModule => {
  const imports = nullRecord<string>();
  for (const [alias, target] of [...state.imports].sort(([left], [right]) =>
    compareText(left, right),
  ))
    imports[alias] = target;
  const exports = nullRecord<AssetSymbolId>();
  for (const [name, entry] of [...state.exports].sort(([left], [right]) =>
    compareText(left, right),
  ))
    exports[name] = entry.symbol;
  const declarations = [...state.symbols.values()]
    .sort((left, right) => compareText(left.symbol.key, right.symbol.key))
    .map((entry) => entry.symbol);
  return freeze({
    path: state.path,
    id: state.file.identity.unitName,
    imports: freeze(imports),
    exports: freeze(exports),
    declarations: freeze(declarations),
  });
};

const orderedStates = (states: ReadonlyMap<string, BuildState>): BuildState[] =>
  [...states.values()].sort((left, right) =>
    compareText(left.file.identity.key, right.file.identity.key),
  );

const entriesOf = (
  states: ReadonlyMap<string, BuildState>,
  kind: AssetSymbolKind,
): readonly Readonly<{ readonly state: BuildState; readonly entry: AssemblyEntry }>[] => {
  const entries: { state: BuildState; entry: AssemblyEntry }[] = [];
  for (const state of states.values())
    for (const entry of state.symbols.values()) {
      if (entry.symbol.kind === kind) entries.push({ state, entry });
    }
  return entries.sort((left, right) => compareText(left.entry.symbol.key, right.entry.symbol.key));
};

const add = <T extends { readonly symbol: AssetSymbolId }>(
  target: Record<string, T>,
  value: T | null,
): void => {
  if (value !== null) target[value.symbol.key] = value;
};

const requireRootAsset = (
  closure: WorkspaceCompilationClosure,
  state: BuildState,
  issue: AssemblyContext['issue'],
): void => {
  if (state.file.unit.kind !== 'asset')
    issue(
      state.path,
      state.file.unit.span,
      'asset.root-unit',
      'A selected workspace entry must be an asset source unit.',
    );
  const root = state.exports.get(closure.build.entryName);
  const rootAsset = root?.symbol.kind === 'asset' ? root : undefined;
  if (rootAsset === undefined)
    issue(
      state.path,
      state.file.unit.span,
      'asset.root-export',
      `Selected entry must export asset "${closure.build.entryName}".`,
    );
  const rootAssets = [...state.symbols.values()].filter((entry) => entry.symbol.kind === 'asset');
  if (
    rootAsset !== undefined &&
    (rootAssets.length !== 1 || rootAssets[0]!.symbol.key !== rootAsset.symbol.key)
  )
    issue(
      state.path,
      state.file.unit.span,
      'asset.root-export',
      'A selected source unit contains exactly the selected exported asset entry.',
    );
};

const visitTreeNodeFor =
  (session: BuildSession, issue: AssemblyContext['issue']): AssemblyContext['visitTreeNode'] =>
  (path, span): void => {
    session.treeNodes += 1;
    if (session.treeNodes <= ASSET_BUDGET.treeNodes) return;
    if (!session.treeLimitReported) {
      session.treeLimitReported = true;
      issue(
        path,
        span,
        'asset.tree-limit',
        'Selected asset closure exceeds the semantic tree budget.',
      );
    }
    throw new AssetBudgetAbort();
  };

const requireFileBudget = (
  closure: WorkspaceCompilationClosure,
  issue: AssemblyContext['issue'],
): void => {
  if (closure.files.length <= ASSET_BUDGET.files) return;
  issue(
    closure.root.identity.path,
    closure.root.unit.span,
    'asset.file-limit',
    'Selected asset closure exceeds the file budget.',
  );
  throw new AssetBudgetAbort();
};

/** Builds every declaration of one kind in symbol-key order into a keyed record. */
const collect = <T extends { readonly symbol: AssetSymbolId }>(
  states: ReadonlyMap<string, BuildState>,
  kind: AssetSymbolKind,
  build: (state: BuildState, entry: AssemblyEntry) => T | null,
): Record<string, T> => {
  const target = nullRecord<T>();
  for (const item of entriesOf(states, kind)) add(target, build(item.state, item.entry));
  return target;
};

type TypedDeclarations = Omit<TypedAssetHir, 'rootPath' | 'modules' | 'symbols'>;

/** Builds declarations in dependency order: each kind only reads kinds built before it. */
const buildDeclarations = (
  context: AssemblyContext,
  states: ReadonlyMap<string, BuildState>,
): TypedDeclarations => {
  const socketContracts = collect<TypedSocketContract>(states, 'socket-contract', (state, entry) =>
    buildSocketContract(context, state, entry),
  );
  const rigs = collect<TypedRigContract>(states, 'rig-contract', (state, entry) =>
    buildRigContract(context, state, entry, socketContracts),
  );
  const skeletons = collect<TypedSkeleton>(states, 'skeleton', (state, entry) =>
    buildSkeleton(context, state, entry, rigs),
  );
  const surfaceContracts = collect<TypedSurfaceContract>(
    states,
    'surface-contract',
    (state, entry) => buildSurfaceContract(context, state, entry),
  );
  const surfaces = collect<TypedSurface>(states, 'surface', (state, entry) =>
    buildSurface(context, state, entry, surfaceContracts),
  );
  const components = collect<TypedComponent>(states, 'component', (state, entry) =>
    buildComponent(context, state, entry, rigs, socketContracts, surfaceContracts),
  );
  const motions = collect<TypedMotion>(states, 'motion', (state, entry) =>
    buildMotion(context, state, entry, rigs),
  );
  const assets = collect<TypedAssetHir['assets'][string]>(states, 'asset', (state, entry) =>
    buildAssetAssembly(context, state, entry, skeletons, rigs, surfaces, components, motions),
  );
  return {
    socketContracts,
    rigs,
    skeletons,
    surfaceContracts,
    surfaces,
    components,
    motions,
    assets,
  };
};

const indexModules = (
  states: ReadonlyMap<string, BuildState>,
): Pick<TypedAssetHir, 'modules' | 'symbols'> => {
  const modules = nullRecord<TypedAssetModule>();
  const symbols = nullRecord<AssetSymbolId>();
  for (const state of orderedStates(states)) {
    modules[state.file.identity.key] = moduleFor(state);
    for (const entry of [...state.symbols.values()].sort((left, right) =>
      compareText(left.symbol.key, right.symbol.key),
    )) {
      symbols[entry.symbol.key] = entry.symbol;
    }
  }
  return { modules, symbols };
};

const assembleHir = (
  closure: WorkspaceCompilationClosure,
  states: ReadonlyMap<string, BuildState>,
  declarations: TypedDeclarations,
): TypedAssetHir => {
  const { modules, symbols } = indexModules(states);
  return deepFreeze({
    rootPath: closure.root.identity.path,
    modules: freeze(modules),
    symbols: freeze(symbols),
    socketContracts: freeze(declarations.socketContracts),
    rigs: freeze(declarations.rigs),
    skeletons: freeze(declarations.skeletons),
    surfaceContracts: freeze(declarations.surfaceContracts),
    surfaces: freeze(declarations.surfaces),
    components: freeze(declarations.components),
    motions: freeze(declarations.motions),
    assets: freeze(declarations.assets),
  });
};

/** Build compiler-private exact HIR from one sealed reachable workspace closure. */
export const buildAssetHir = (closure: WorkspaceCompilationClosure): AssetHirResult => {
  const diagnostics: AssetDiagnostic[] = [];
  const mutableSession: BuildSession = {
    diagnostics,
    states: new Map(),
    declarations: 0,
    treeNodes: 0,
    diagnosticLimitReported: false,
    treeLimitReported: false,
  };
  const issue = issueFor(mutableSession);
  try {
    requireFileBudget(closure, issue);
    const elaborated = elaborateAssetDesigns(closure, issue);
    if (diagnostics.length > 0) throw new AssetBudgetAbort();
    const states = createStates(elaborated, mutableSession, issue);
    mutableSession.states = states;
    const context: AssemblyContext = freeze({
      issue,
      resolve: resolveFor(mutableSession, issue),
      visitTreeNode: visitTreeNodeFor(mutableSession, issue),
    });
    const rootState = states.get(closure.root.identity.key);
    if (rootState === undefined) throw new TypeError('Sealed closure omitted its root state.');
    requireRootAsset(closure, rootState, issue);
    const declarations = buildDeclarations(context, states);
    if (diagnostics.length > 0) throw new AssetBudgetAbort();
    return deepFreeze({ ok: true as const, hir: assembleHir(closure, states, declarations) });
  } catch (error) {
    if (!(error instanceof AssetBudgetAbort)) throw error;
    return freeze({ ok: false, diagnostics: freeze([...diagnostics].sort(compareDiagnostics)) });
  }
};
