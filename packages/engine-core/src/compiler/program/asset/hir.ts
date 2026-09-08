import type {
  AssetDeclaration,
  AssetDiagnostic
} from '../../../project/program/asset/contract';
import type {
  WorkspaceCompilationClosure,
  WorkspaceCompilationFile
} from '../../../project/workspace/closure';
import { deepFreeze } from '../../../immutable';
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
  type TypedSurfaceContract
} from './contract';
import {
  buildAssetAssembly,
  type AssemblyContext,
  type AssemblyEntry,
  type AssemblyState
} from './assembly';
import {
  buildRigContract,
  buildSkeleton,
  buildSocketContract,
  buildSurface,
  buildSurfaceContract
} from './definition';
import { buildComponent } from './component';
import { buildMotion } from './motion';
import { elaborateAssetDesigns } from './design';

const freeze = <T>(value: T): T => Object.freeze(value);
const record = <T>(): Record<string, T> => Object.create(null) as Record<string, T>;

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

const compareDiagnostics = (left: AssetDiagnostic, right: AssetDiagnostic): number =>
  left.path.localeCompare(right.path) ||
  left.span.start.offset - right.span.start.offset ||
  left.span.end.offset - right.span.end.offset ||
  left.code.localeCompare(right.code) || left.message.localeCompare(right.message);

const issueFor = (session: BuildSession): AssemblyContext['issue'] =>
  (path, span, code, message): void => {
    if (session.diagnostics.length >= ASSET_BUDGET.diagnostics) {
      session.diagnosticLimitReported = true;
      throw new AssetBudgetAbort();
    }
    session.diagnostics.push(freeze({ severity: 'error', code, message, path, span }));
  };

const symbolFor = (
  file: WorkspaceCompilationFile,
  declaration: AssetDeclaration
): AssetSymbolId => freeze({
  modulePath: file.identity.key,
  name: declaration.id,
  kind: declaration.kind,
  key: [file.identity.key, declaration.kind, declaration.id].join('\u0000')
});

const indexState = (
  session: BuildSession,
  file: WorkspaceCompilationFile,
  importTargets: ReadonlyMap<string, string>,
  issue: AssemblyContext['issue']
): BuildState => {
  const symbols = new Map<string, AssemblyEntry>();
  const exports = new Map<string, AssemblyEntry>();
  for (const declaration of file.unit.declarations) {
    session.declarations += 1;
    if (session.declarations > ASSET_BUDGET.declarations) {
      issue(file.identity.path, declaration.span, 'asset.declaration-limit',
        'Selected asset closure exceeds the declaration budget.');
      throw new AssetBudgetAbort();
    }
    if (symbols.has(declaration.id)) issue(file.identity.path, declaration.span,
      'asset.duplicate-symbol', `Symbol "${declaration.id}" is declared more than once.`);
    const entry = freeze({ symbol: symbolFor(file, declaration), declaration,
      path: file.identity.path });
    symbols.set(declaration.id, entry);
    if (declaration.exported) exports.set(declaration.id, entry);
  }
  return freeze({ path: file.identity.path, file,
    imports: new Map(importTargets), symbols, exports });
};

const createStates = (
  closure: WorkspaceCompilationClosure,
  session: BuildSession,
  issue: AssemblyContext['issue']
): ReadonlyMap<string, BuildState> => {
  const edgeMaps = new Map<string, Map<string, string>>();
  for (const edge of closure.imports) {
    const aliases = edgeMaps.get(edge.importer.key) ?? new Map<string, string>();
    if (aliases.has(edge.alias)) issue(edge.importer.path, freeze({
      start: edge.source.start,
      end: edge.source.end
    }),
      'asset.duplicate-import-alias', `Import alias "${edge.alias}" is declared more than once.`);
    aliases.set(edge.alias, edge.target.key);
    edgeMaps.set(edge.importer.key, aliases);
  }
  const states = new Map<string, BuildState>();
  for (const file of closure.files) states.set(file.identity.key,
    indexState(session, file, edgeMaps.get(file.identity.key) ?? new Map(), issue));
  return states;
};

const resolveFor = (
  session: BuildSession,
  issue: AssemblyContext['issue']
): AssemblyContext['resolve'] => (state, name, expected) => {
  let entry: AssemblyEntry | undefined;
  if (name.segments.length === 1) entry = state.symbols.get(name.segments[0]!);
  else if (name.segments.length === 2) {
    const targetKey = state.imports.get(name.segments[0]!);
    const target = targetKey === undefined ? undefined : session.states.get(targetKey);
    entry = target?.exports.get(name.segments[1]!);
  }
  if (entry === undefined) {
    issue(state.path, name.span, 'asset.unresolved-symbol',
      `Cannot resolve nominal symbol "${name.segments.join('.')}".`);
    return null;
  }
  if (expected !== undefined && entry.symbol.kind !== expected) {
    issue(state.path, name.span, 'asset.symbol-kind',
      `Symbol "${name.segments.join('.')}" is ${entry.symbol.kind}, expected ${expected}.`);
    return null;
  }
  return entry;
};

const moduleFor = (state: BuildState): TypedAssetModule => {
  const imports = record<string>();
  for (const [alias, target] of [...state.imports].sort(([left], [right]) =>
    left.localeCompare(right))) imports[alias] = target;
  const exports = record<AssetSymbolId>();
  for (const [name, entry] of [...state.exports].sort(([left], [right]) =>
    left.localeCompare(right))) exports[name] = entry.symbol;
  const declarations = [...state.symbols.values()]
    .sort((left, right) => left.symbol.key.localeCompare(right.symbol.key))
    .map((entry) => entry.symbol);
  return freeze({ path: state.path, id: state.file.identity.unitName,
    imports: freeze(imports), exports: freeze(exports),
    declarations: freeze(declarations) });
};

const orderedStates = (states: ReadonlyMap<string, BuildState>): BuildState[] =>
  [...states.values()].sort((left, right) =>
    left.file.identity.key.localeCompare(right.file.identity.key));

const entriesOf = (
  states: ReadonlyMap<string, BuildState>,
  kind: AssetSymbolKind
): readonly Readonly<{ readonly state: BuildState; readonly entry: AssemblyEntry }>[] => {
  const entries: { state: BuildState; entry: AssemblyEntry }[] = [];
  for (const state of states.values()) for (const entry of state.symbols.values()) {
    if (entry.symbol.kind === kind) entries.push({ state, entry });
  }
  return entries.sort((left, right) => left.entry.symbol.key.localeCompare(right.entry.symbol.key));
};

const add = <T extends { readonly symbol: AssetSymbolId }>(
  target: Record<string, T>,
  value: T | null
): void => { if (value !== null) target[value.symbol.key] = value; };

const requireRootAsset = (
  closure: WorkspaceCompilationClosure,
  state: BuildState,
  issue: AssemblyContext['issue']
): void => {
  if (state.file.unit.kind !== 'asset') issue(state.path, state.file.unit.span,
    'asset.root-unit', 'A selected workspace entry must be an asset source unit.');
  const root = state.exports.get(closure.build.entryName);
  const rootAsset = root?.symbol.kind === 'asset' ? root : undefined;
  if (rootAsset === undefined) issue(state.path,
    state.file.unit.span, 'asset.root-export',
    `Selected entry must export asset "${closure.build.entryName}".`);
  const rootAssets = [...state.symbols.values()].filter((entry) =>
    entry.symbol.kind === 'asset');
  if (rootAsset !== undefined && (rootAssets.length !== 1 ||
    rootAssets[0]!.symbol.key !== rootAsset.symbol.key)) issue(state.path, state.file.unit.span,
    'asset.root-export', 'A selected source unit contains exactly the selected exported asset entry.');
};

/** Build compiler-private exact HIR from one sealed reachable workspace closure. */
export const buildAssetHir = (
  closure: WorkspaceCompilationClosure
): AssetHirResult => {
  const diagnostics: AssetDiagnostic[] = [];
  const mutableSession: BuildSession = {
    diagnostics,
    states: new Map(),
    declarations: 0,
    treeNodes: 0,
    diagnosticLimitReported: false,
    treeLimitReported: false
  };
  const issue = issueFor(mutableSession);
  try {
    if (closure.files.length > ASSET_BUDGET.files) {
      issue(closure.root.identity.path, closure.root.unit.span, 'asset.file-limit',
        'Selected asset closure exceeds the file budget.');
      throw new AssetBudgetAbort();
    }
    const elaborated = elaborateAssetDesigns(closure, issue);
    if (diagnostics.length > 0) throw new AssetBudgetAbort();
    const states = createStates(elaborated, mutableSession, issue);
    mutableSession.states = states;
    const resolve = resolveFor(mutableSession, issue);
    const context: AssemblyContext = freeze({
      issue,
      resolve,
      visitTreeNode: (path, span): void => {
        mutableSession.treeNodes += 1;
        if (mutableSession.treeNodes > ASSET_BUDGET.treeNodes) {
          if (!mutableSession.treeLimitReported) {
            mutableSession.treeLimitReported = true;
            issue(path, span, 'asset.tree-limit',
              'Selected asset closure exceeds the semantic tree budget.');
          }
          throw new AssetBudgetAbort();
        }
      }
    });
    const rootState = states.get(closure.root.identity.key);
    if (rootState === undefined) throw new TypeError('Sealed closure omitted its root state.');
    requireRootAsset(closure, rootState, issue);

    const socketContracts = record<TypedSocketContract>();
    for (const item of entriesOf(states, 'socket-contract')) add(socketContracts,
      buildSocketContract(context, item.state, item.entry));
    const rigs = record<TypedRigContract>();
    for (const item of entriesOf(states, 'rig-contract')) add(rigs,
      buildRigContract(context, item.state, item.entry, socketContracts));
    const skeletons = record<TypedSkeleton>();
    for (const item of entriesOf(states, 'skeleton')) add(skeletons,
      buildSkeleton(context, item.state, item.entry, rigs));
    const surfaceContracts = record<TypedSurfaceContract>();
    for (const item of entriesOf(states, 'surface-contract')) add(surfaceContracts,
      buildSurfaceContract(context, item.state, item.entry));
    const surfaces = record<TypedSurface>();
    for (const item of entriesOf(states, 'surface')) add(surfaces,
      buildSurface(context, item.state, item.entry, surfaceContracts));
    const components = record<TypedComponent>();
    for (const item of entriesOf(states, 'component')) add(components,
      buildComponent(context, item.state, item.entry, rigs, socketContracts, surfaceContracts));
    const motions = record<TypedMotion>();
    for (const item of entriesOf(states, 'motion')) add(motions,
      buildMotion(context, item.state, item.entry, rigs));
    const assets = record<TypedAssetHir['assets'][string]>();
    for (const item of entriesOf(states, 'asset')) add(assets,
      buildAssetAssembly(context, item.state, item.entry, skeletons, rigs,
        surfaces, components, motions));
    if (diagnostics.length > 0) throw new AssetBudgetAbort();

    const modules = record<TypedAssetModule>();
    const symbols = record<AssetSymbolId>();
    for (const state of orderedStates(states)) {
      modules[state.file.identity.key] = moduleFor(state);
      for (const entry of [...state.symbols.values()].sort((left, right) =>
        left.symbol.key.localeCompare(right.symbol.key))) {
        symbols[entry.symbol.key] = entry.symbol;
      }
    }
    const hir: TypedAssetHir = deepFreeze({ rootPath: closure.root.identity.path,
      modules: freeze(modules), symbols: freeze(symbols),
      socketContracts: freeze(socketContracts), rigs: freeze(rigs),
      skeletons: freeze(skeletons), surfaceContracts: freeze(surfaceContracts),
      surfaces: freeze(surfaces), components: freeze(components),
      motions: freeze(motions), assets: freeze(assets) });
    return deepFreeze({ ok: true as const, hir });
  } catch (error) {
    if (!(error instanceof AssetBudgetAbort)) throw error;
    return freeze({ ok: false,
      diagnostics: freeze([...diagnostics].sort(compareDiagnostics)) });
  }
};
