import { freeze } from '../../../immutable';
import type { SourceSpan } from '../../../project/source/contract';
import type {
  AssetAssemblyDecl,
  AssetAssemblyUse,
  AssetDeclaration,
  AssetQualifiedName,
} from '../../../project/program/asset/contract';
import { assetExactNumber, assetNumberValue, type AssetValue } from './value/contract';
import {
  type AssetSymbolId,
  type AssetSymbolKind,
  type TypedAssetAssembly,
  type TypedAssetUse,
  type TypedAssemblyConnection,
  type TypedComponent,
  type TypedGeometryStatement,
  type AssetIntegerValue,
  type TypedMotion,
  type TypedRigContract,
  type TypedSkeleton,
  type TypedSurface,
} from './contract';
import { compileAndEvaluateHirExpression, type HirIssue } from './hirValues';

export interface AssemblyState {
  readonly path: string;
  readonly imports: Map<string, string>;
  readonly symbols: Map<string, AssemblyEntry>;
  readonly exports: Map<string, AssemblyEntry>;
}

export interface AssemblyEntry {
  readonly symbol: AssetSymbolId;
  readonly declaration: AssetDeclaration;
  readonly path: string;
}

export interface AssemblyContext {
  readonly issue: HirIssue;
  readonly visitTreeNode: (path: string, span: SourceSpan) => void;
  readonly resolve: (
    state: AssemblyState,
    name: AssetQualifiedName,
    expected?: AssetSymbolKind,
  ) => AssemblyEntry | null;
}

type Port = TypedComponent['ports'][number];
type Instance = Readonly<{ readonly use: AssetAssemblyUse; readonly component: TypedComponent }>;

const record = <T>(): Record<string, T> => Object.create(null) as Record<string, T>;

const bindingKind = (port: Port): AssetSymbolKind =>
  port.domain === 'rig' ? 'rig-contract' : 'surface';

const zeroInteger = (): AssetIntegerValue =>
  assetNumberValue(assetExactNumber(0n, 1n, 'plain')) as AssetIntegerValue;

export interface GeometryHierarchyContext {
  readonly path: string;
  readonly boundBones: ReadonlySet<string>;
  readonly anchorBone: string | null;
  readonly issue: HirIssue;
  readonly budget: (span: SourceSpan) => void;
}

/** Checks geometry ownership without assigning any placement transform. */
export const validateGeometryHierarchy = (
  statements: readonly TypedGeometryStatement[],
  context: GeometryHierarchyContext,
): ReadonlySet<string> => {
  const bones = new Set<string>();
  const competing = new Set([
    'parent',
    'origin',
    'position',
    'rotation',
    'pivot',
    'visible',
    'scale',
  ]);
  const walk = (
    nodes: readonly TypedGeometryStatement[],
    ancestors: readonly string[],
    anchored: boolean,
  ): void => {
    for (const statement of nodes) {
      context.budget(statement.span);
      if (statement.kind !== 'typed-geometry-block') continue;
      const semantic = statement.keyword === 'bone';
      const isAnchored =
        anchored ||
        (semantic && (context.boundBones.has(statement.id) || context.anchorBone === statement.id));
      if (ancestors.length === 0 && !isAnchored)
        context.issue(
          context.path,
          statement.span,
          'asset.unanchored-geometry',
          'Every geometry root must descend from its placement authority.',
        );
      if (semantic) {
        if (bones.has(statement.id))
          context.issue(
            context.path,
            statement.span,
            'asset.duplicate-geometry-bone',
            'Geometry bone "' + statement.id + '" is declared more than once.',
          );
        bones.add(statement.id);
        if (context.boundBones.has(statement.id) || context.anchorBone === statement.id) {
          for (const child of statement.statements) {
            if (child.kind === 'typed-geometry-property' && competing.has(child.name)) {
              context.issue(
                context.path,
                child.span,
                'asset.bound-bone-transform',
                'A geometry bone bound to a semantic joint cannot author a competing transform property.',
              );
            }
          }
        }
      }
      walk(statement.statements, [...ancestors, statement.id], isAnchored);
    }
  };
  walk(statements, [], false);
  return bones;
};

const buildSettings = (
  declaration: AssetAssemblyDecl,
  path: string,
  issue: HirIssue,
): TypedAssetAssembly['settings'] => {
  const settings = declaration.settings;
  const density =
    settings?.density === null || settings?.density === undefined
      ? null
      : compileAndEvaluateHirExpression(
          settings.density,
          'integer',
          new Map(),
          new Map(),
          path,
          issue,
        );
  const validDensity =
    density?.kind === 'number' &&
    density.type === 'integer' &&
    density.value.numerator === 16n &&
    density.value.denominator === 1n;
  if (settings === null || !validDensity || settings.forward === null)
    issue(
      path,
      declaration.span,
      'asset.invalid-settings',
      'Asset assemblies require density = 16 and a horizontal forward direction.',
    );
  return freeze({
    density: validDensity ? (density as AssetIntegerValue) : zeroInteger(),
    forward: settings?.forward ?? null,
  });
};

const buildUse = (
  context: AssemblyContext,
  state: AssemblyState,
  use: AssetAssemblyUse,
  component: TypedComponent,
  skeleton: TypedSkeleton,
  surfaces: Readonly<Record<string, TypedSurface>>,
  instances: Map<string, Instance>,
): TypedAssetUse => {
  if (instances.has(use.id))
    context.issue(
      state.path,
      use.span,
      'asset.duplicate-instance',
      'Component instance "' + use.id + '" is declared more than once.',
    );
  const parameters = record<AssetValue>();
  const sets = new Map<string, AssetAssemblyUse['parameterSets'][number]>();
  for (const set of use.parameterSets) {
    if (sets.has(set.id))
      context.issue(
        state.path,
        set.span,
        'asset.duplicate-parameter-set',
        'Component parameter "' + set.id + '" is set more than once.',
      );
    sets.set(set.id, set);
    const type = component.parameters[set.id];
    if (type === undefined) {
      context.issue(
        state.path,
        set.span,
        'asset.unknown-parameter',
        'Component use sets an undeclared parameter "' + set.id + '".',
      );
      continue;
    }
    const value = compileAndEvaluateHirExpression(
      set.value,
      type,
      new Map(),
      new Map(),
      state.path,
      context.issue,
    );
    if (value !== null) parameters[set.id] = value;
  }
  for (const id of Object.keys(component.parameters))
    if (!sets.has(id))
      context.issue(
        state.path,
        use.span,
        'asset.missing-parameter',
        'Component parameter "' + id + '" must be set exactly once.',
      );

  const bindings = new Map<string, AssetAssemblyUse['portBindings'][number]>();
  const portBindings = record<AssetSymbolId>();
  for (const binding of use.portBindings) {
    if (bindings.has(binding.port))
      context.issue(
        state.path,
        binding.span,
        'asset.duplicate-port-binding',
        'Component port "' + binding.port + '" is bound more than once.',
      );
    bindings.set(binding.port, binding);
    const port = component.ports.find((candidate) => candidate.id === binding.port);
    if (port === undefined) {
      context.issue(
        state.path,
        binding.span,
        'asset.unknown-port-binding',
        'Component binding names an undeclared port "' + binding.port + '".',
      );
      continue;
    }
    if (port.domain === 'socket') {
      context.issue(
        state.path,
        binding.span,
        'asset.socket-port-binding',
        'Socket ports are bound only by connect provider -> required statements.',
      );
      continue;
    }
    if (port.direction !== 'requires') {
      context.issue(
        state.path,
        binding.span,
        'asset.provided-port-binding',
        'Provided component ports cannot be bound by an assembly use.',
      );
      continue;
    }
    const target = context.resolve(state, binding.target, bindingKind(port));
    if (target === null) continue;
    if (port.domain === 'rig') {
      if (target.symbol.key !== skeleton.rig.key)
        context.issue(
          state.path,
          binding.span,
          'asset.port-binding-mismatch',
          'A component rig port must bind the selected skeleton rig.',
        );
      else portBindings[port.id] = target.symbol;
    } else {
      const surface = surfaces[target.symbol.key];
      if (surface === undefined || surface.contract.key !== port.type.key)
        context.issue(
          state.path,
          binding.span,
          'asset.port-binding-mismatch',
          'A component surface port must bind a concrete surface implementing its nominal contract.',
        );
      else portBindings[port.id] = target.symbol;
    }
  }
  for (const port of component.ports)
    if (port.direction === 'requires' && port.domain !== 'socket' && !bindings.has(port.id))
      context.issue(
        state.path,
        use.span,
        'asset.missing-port-binding',
        'Required component port "' + port.id + '" must be bound by the assembly.',
      );
  const typed: TypedAssetUse = freeze({
    component: component.symbol,
    id: use.id,
    parameters: freeze(parameters),
    portBindings: freeze(portBindings),
    span: use.span,
  });
  instances.set(use.id, { use, component });
  return typed;
};

const connection = (
  context: AssemblyContext,
  state: AssemblyState,
  span: SourceSpan,
  from: readonly string[],
  to: readonly string[],
  target: Port | undefined,
): TypedAssemblyConnection | null => {
  if (from.length !== 2 || to.length !== 2) {
    context.issue(
      state.path,
      span,
      'asset.invalid-connection',
      'Connections require provider.port -> required.port endpoints.',
    );
    return null;
  }
  if (target === undefined || target.domain !== 'socket' || target.direction !== 'requires') {
    context.issue(
      state.path,
      span,
      'asset.socket-direction',
      'Connection targets must be declared required socket ports.',
    );
    return null;
  }
  return freeze({
    fromInstance: from[0]!,
    fromPort: from[1]!,
    toInstance: to[0]!,
    toPort: to[1]!,
    span,
  });
};

export const buildAssetAssembly = (
  context: AssemblyContext,
  state: AssemblyState,
  entry: AssemblyEntry,
  skeletons: Readonly<Record<string, TypedSkeleton>>,
  rigs: Readonly<Record<string, TypedRigContract>>,
  surfaces: Readonly<Record<string, TypedSurface>>,
  components: Readonly<Record<string, TypedComponent>>,
  motions: Readonly<Record<string, TypedMotion>>,
): TypedAssetAssembly | null => {
  const declaration = entry.declaration as AssetAssemblyDecl;
  const settings = buildSettings(declaration, state.path, context.issue);
  const skeletonEntry =
    declaration.skeleton === null ? null : context.resolve(state, declaration.skeleton, 'skeleton');
  if (skeletonEntry === null) {
    context.issue(
      state.path,
      declaration.span,
      'asset.missing-skeleton',
      'Asset assemblies require a concrete skeleton.',
    );
    return null;
  }
  const skeleton = skeletons[skeletonEntry.symbol.key];
  if (skeleton === undefined) return null;
  const rig = rigs[skeleton.rig.key];
  if (rig === undefined) return null;
  const motionIds: AssetSymbolId[] = [];
  const motionKeys = new Set<string>();
  for (const reference of declaration.motions) {
    const motionEntry = context.resolve(state, reference, 'motion');
    const motion = motionEntry === null ? null : motions[motionEntry.symbol.key];
    if (motion === null || motion === undefined) continue;
    if (motionKeys.has(motion.symbol.key))
      context.issue(
        state.path,
        reference.span,
        'asset.duplicate-motion',
        'An asset cannot select the same motion more than once.',
      );
    motionKeys.add(motion.symbol.key);
    if (motion.rig.key !== skeleton.rig.key)
      context.issue(
        state.path,
        reference.span,
        'asset.nominal-mismatch',
        'Motion rig contract is incompatible with the assembly skeleton.',
      );
    motionIds.push(motion.symbol);
  }
  const instances = new Map<string, Instance>();
  const typedUses: TypedAssetUse[] = [];
  for (const use of declaration.uses) {
    const componentEntry = context.resolve(state, use.component, 'component');
    const component = componentEntry === null ? null : components[componentEntry.symbol.key];
    if (component === null || component === undefined) continue;
    typedUses.push(buildUse(context, state, use, component, skeleton, surfaces, instances));
  }
  const connections: TypedAssemblyConnection[] = [];
  const requiredConnected = new Set<string>();
  const providerUseCount = new Map<string, number>();
  const edges = new Map<string, Set<string>>();
  for (const item of declaration.connections) {
    const from = item.from.segments;
    const to = item.to.segments;
    const targetInstance = instances.get(to[0]!);
    const targetPort = targetInstance?.component.ports.find((port) => port.id === to[1]);
    const typed = connection(context, state, item.span, from, to, targetPort);
    if (typed === null) continue;
    const sourceInstance = from[0] === 'skeleton' ? null : instances.get(from[0]!);
    const sourcePort = sourceInstance?.component.ports.find((port) => port.id === from[1]);
    const sourceType =
      from[0] === 'skeleton'
        ? rig.sockets[from[1]!]?.contract
        : sourceInstance?.component.ports.find(
            (port) =>
              port.id === from[1] && port.domain === 'socket' && port.direction === 'provides',
          )?.type;
    if (sourceType === undefined || sourceType.key !== targetPort!.type.key) {
      context.issue(
        state.path,
        item.span,
        'asset.socket-mismatch',
        'Connected socket contracts must match nominally and have explicit endpoints.',
      );
      continue;
    }
    const key = to.join('.');
    if (requiredConnected.has(key))
      context.issue(
        state.path,
        item.span,
        'asset.socket-cardinality',
        'Every required socket endpoint must connect exactly once.',
      );
    requiredConnected.add(key);
    const providerKey = from.join('.');
    const count = (providerUseCount.get(providerKey) ?? 0) + 1;
    providerUseCount.set(providerKey, count);
    const capacity =
      from[0] === 'skeleton' ? rig.sockets[from[1]!]?.capacity : sourcePort?.capacity;
    if (capacity === 'one' && count > 1)
      context.issue(
        state.path,
        item.span,
        'asset.socket-cardinality',
        'A one-capacity provider cannot feed multiple required endpoints.',
      );
    if (sourceInstance !== undefined && sourceInstance !== null) {
      const targets = edges.get(from[0]!) ?? new Set<string>();
      targets.add(to[0]!);
      edges.set(from[0]!, targets);
    }
    connections.push(freeze({ ...typed, span: item.span }));
  }
  for (const [id, item] of instances)
    for (const port of item.component.ports) {
      if (
        port.domain === 'socket' &&
        port.direction === 'requires' &&
        !requiredConnected.has(id + '.' + port.id)
      )
        context.issue(
          state.path,
          item.use.span,
          'asset.missing-socket-connection',
          'Every required socket port needs exactly one provider connection.',
        );
    }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): void => {
    if (visiting.has(id)) {
      context.issue(
        state.path,
        declaration.span,
        'asset.socket-cycle',
        'Socket provider connections must not form a cycle.',
      );
      return;
    }
    if (visited.has(id)) return;
    visiting.add(id);
    for (const next of edges.get(id) ?? []) visit(next);
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of instances.keys()) visit(id);
  return freeze({
    symbol: entry.symbol,
    settings,
    skeleton: skeleton.symbol,
    motions: freeze(motionIds),
    uses: freeze(typedUses),
    connections: freeze(connections),
    span: declaration.span,
  });
};
