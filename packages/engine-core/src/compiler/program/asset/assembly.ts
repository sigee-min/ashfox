import { freeze } from '../../../immutable';
import type { SourceSpan } from '../../../project/source/contract';
import type {
  AssetAssemblyDecl,
  AssetDeclaration,
  AssetQualifiedName,
} from '../../../project/program/asset/contract';
import { assetExactNumber, assetNumberValue } from './value/contract';
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
import {
  buildHitzones,
  buildTypedDamageState,
  buildUse,
  type AssemblyInstance,
} from './assemblyUse';
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
type Instance = AssemblyInstance;
type TypedGeometryBlockNode = Extract<
  TypedGeometryStatement,
  { readonly kind: 'typed-geometry-block' }
>;

const zeroInteger = (): AssetIntegerValue =>
  assetNumberValue(assetExactNumber(0n, 1n, 'plain')) as AssetIntegerValue;

const COMPETING_BONE_PROPERTIES = new Set([
  'parent',
  'origin',
  'position',
  'rotation',
  'pivot',
  'visible',
  'scale',
]);

export interface GeometryHierarchyContext {
  readonly path: string;
  readonly boundBones: ReadonlySet<string>;
  readonly anchorBone: string | null;
  readonly issue: HirIssue;
  readonly budget: (span: SourceSpan) => void;
}

const checkBoundBoneProperties = (
  statement: TypedGeometryBlockNode,
  context: GeometryHierarchyContext,
): void => {
  if (!context.boundBones.has(statement.id) && context.anchorBone !== statement.id) return;
  for (const child of statement.statements) {
    if (child.kind === 'typed-geometry-property' && COMPETING_BONE_PROPERTIES.has(child.name)) {
      context.issue(
        context.path,
        child.span,
        'asset.bound-bone-transform',
        'A geometry bone bound to a semantic joint cannot author a competing transform property.',
      );
    }
  }
};

const walkHierarchy = (
  nodes: readonly TypedGeometryStatement[],
  ancestors: readonly string[],
  anchored: boolean,
  bones: Set<string>,
  context: GeometryHierarchyContext,
): void => {
  for (const statement of nodes) {
    context.budget(statement.span);
    if (statement.kind !== 'typed-geometry-block') continue;
    const semantic = statement.keyword === 'bone';
    const isAnchored =
      anchored ||
      (semantic && (context.boundBones.has(statement.id) || context.anchorBone === statement.id));
    if (ancestors.length === 0 && !isAnchored) {
      context.issue(
        context.path,
        statement.span,
        'asset.unanchored-geometry',
        'Every geometry root must descend from its placement authority.',
      );
    }
    if (semantic) {
      if (bones.has(statement.id)) {
        context.issue(
          context.path,
          statement.span,
          'asset.duplicate-geometry-bone',
          'Geometry bone "' + statement.id + '" is declared more than once.',
        );
      }
      bones.add(statement.id);
      checkBoundBoneProperties(statement, context);
    }
    walkHierarchy(statement.statements, [...ancestors, statement.id], isAnchored, bones, context);
  }
};

/** Checks geometry ownership without assigning any placement transform. */
export const validateGeometryHierarchy = (
  statements: readonly TypedGeometryStatement[],
  context: GeometryHierarchyContext,
): ReadonlySet<string> => {
  const bones = new Set<string>();
  walkHierarchy(statements, [], false, bones, context);
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
  if (settings === null || !validDensity || settings.forward === null) {
    issue(
      path,
      declaration.span,
      'asset.invalid-settings',
      'Asset assemblies require density = 16 and a horizontal forward direction.',
    );
  }
  return freeze({
    density: validDensity ? (density as AssetIntegerValue) : zeroInteger(),
    forward: settings?.forward ?? null,
    profile: settings?.profile ?? null,
  });
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

const resolveMotions = (
  context: AssemblyContext,
  state: AssemblyState,
  declaration: AssetAssemblyDecl,
  skeleton: TypedSkeleton,
  motions: Readonly<Record<string, TypedMotion>>,
): readonly AssetSymbolId[] => {
  const motionIds: AssetSymbolId[] = [];
  const motionKeys = new Set<string>();
  for (const reference of declaration.motions) {
    const motionEntry = context.resolve(state, reference, 'motion');
    const motion = motionEntry === null ? null : motions[motionEntry.symbol.key];
    if (motion === null || motion === undefined) continue;
    if (motionKeys.has(motion.symbol.key)) {
      context.issue(
        state.path,
        reference.span,
        'asset.duplicate-motion',
        'An asset cannot select the same motion more than once.',
      );
    }
    motionKeys.add(motion.symbol.key);
    if (motion.rig.key !== skeleton.rig.key) {
      context.issue(
        state.path,
        reference.span,
        'asset.nominal-mismatch',
        'Motion rig contract is incompatible with the assembly skeleton.',
      );
    }
    motionIds.push(motion.symbol);
  }
  return freeze(motionIds);
};

interface ConnectionState {
  readonly connections: TypedAssemblyConnection[];
  readonly requiredConnected: Set<string>;
  readonly providerUseCount: Map<string, number>;
  readonly edges: Map<string, Set<string>>;
}

const resolveSourceSocket = (
  from: readonly string[],
  instances: ReadonlyMap<string, Instance>,
  rig: TypedRigContract,
) => {
  const sourceInstance = from[0] === 'skeleton' ? null : instances.get(from[0]!);
  const sourcePort = sourceInstance?.component.ports.find((port) => port.id === from[1]);
  const providedPort =
    sourcePort !== undefined &&
    sourcePort.domain === 'socket' &&
    sourcePort.direction === 'provides'
      ? sourcePort
      : undefined;
  const sourceType = from[0] === 'skeleton' ? rig.sockets[from[1]!]?.contract : providedPort?.type;
  return { sourceInstance, sourcePort, sourceType };
};

const addConnection = (
  context: AssemblyContext,
  state: AssemblyState,
  item: AssetAssemblyDecl['connections'][number],
  instances: ReadonlyMap<string, Instance>,
  rig: TypedRigContract,
  acc: ConnectionState,
): void => {
  const from = item.from.segments;
  const to = item.to.segments;
  const targetPort = instances.get(to[0]!)?.component.ports.find((port) => port.id === to[1]);
  const typed = connection(context, state, item.span, from, to, targetPort);
  if (typed === null) return;
  const { sourceInstance, sourcePort, sourceType } = resolveSourceSocket(from, instances, rig);
  if (sourceType === undefined || sourceType.key !== targetPort!.type.key) {
    context.issue(
      state.path,
      item.span,
      'asset.socket-mismatch',
      'Connected socket contracts must match nominally and have explicit endpoints.',
    );
    return;
  }
  const key = to.join('.');
  if (acc.requiredConnected.has(key)) {
    context.issue(
      state.path,
      item.span,
      'asset.socket-cardinality',
      'Every required socket endpoint must connect exactly once.',
    );
  }
  acc.requiredConnected.add(key);
  const providerKey = from.join('.');
  const count = (acc.providerUseCount.get(providerKey) ?? 0) + 1;
  acc.providerUseCount.set(providerKey, count);
  const capacity = from[0] === 'skeleton' ? rig.sockets[from[1]!]?.capacity : sourcePort?.capacity;
  if (capacity === 'one' && count > 1) {
    context.issue(
      state.path,
      item.span,
      'asset.socket-cardinality',
      'A one-capacity provider cannot feed multiple required endpoints.',
    );
  }
  if (sourceInstance !== undefined && sourceInstance !== null) {
    const targets = acc.edges.get(from[0]!) ?? new Set<string>();
    targets.add(to[0]!);
    acc.edges.set(from[0]!, targets);
  }
  acc.connections.push(freeze({ ...typed, span: item.span }));
};

const checkMissingRequiredSockets = (
  context: AssemblyContext,
  state: AssemblyState,
  instances: ReadonlyMap<string, Instance>,
  requiredConnected: ReadonlySet<string>,
): void => {
  for (const [id, item] of instances) {
    for (const port of item.component.ports) {
      if (
        port.domain === 'socket' &&
        port.direction === 'requires' &&
        !requiredConnected.has(id + '.' + port.id)
      ) {
        context.issue(
          state.path,
          item.use.span,
          'asset.missing-socket-connection',
          'Every required socket port needs exactly one provider connection.',
        );
      }
    }
  }
};

const visitSocketGraph = (
  id: string,
  visiting: Set<string>,
  visited: Set<string>,
  edges: ReadonlyMap<string, ReadonlySet<string>>,
  context: AssemblyContext,
  state: AssemblyState,
  declaration: AssetAssemblyDecl,
): void => {
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
  for (const next of edges.get(id) ?? []) {
    visitSocketGraph(next, visiting, visited, edges, context, state, declaration);
  }
  visiting.delete(id);
  visited.add(id);
};

const resolveAssemblyGraph = (
  context: AssemblyContext,
  state: AssemblyState,
  declaration: AssetAssemblyDecl,
  skeleton: TypedSkeleton,
  rig: TypedRigContract,
  surfaces: Readonly<Record<string, TypedSurface>>,
  components: Readonly<Record<string, TypedComponent>>,
) => {
  const instances = new Map<string, Instance>();
  const typedUses: TypedAssetUse[] = [];
  for (const use of declaration.uses) {
    const componentEntry = context.resolve(state, use.component, 'component');
    const component = componentEntry === null ? null : components[componentEntry.symbol.key];
    if (component !== null && component !== undefined) {
      typedUses.push(buildUse(context, state, use, component, skeleton, surfaces, instances));
    }
  }
  const acc: ConnectionState = {
    connections: [],
    requiredConnected: new Set(),
    providerUseCount: new Map(),
    edges: new Map(),
  };
  for (const item of declaration.connections)
    addConnection(context, state, item, instances, rig, acc);
  checkMissingRequiredSockets(context, state, instances, acc.requiredConnected);
  const visiting = new Set<string>();
  const visited = new Set<string>();
  for (const id of instances.keys()) {
    visitSocketGraph(id, visiting, visited, acc.edges, context, state, declaration);
  }
  return { typedUses, connections: acc.connections };
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
  const rig = skeleton === undefined ? undefined : rigs[skeleton.rig.key];
  if (skeleton === undefined || rig === undefined) return null;
  const motionIds = resolveMotions(context, state, declaration, skeleton, motions);
  const { typedUses, connections } = resolveAssemblyGraph(
    context,
    state,
    declaration,
    skeleton,
    rig,
    surfaces,
    components,
  );
  const hitzones = buildHitzones(context, state, declaration);
  const damageState = buildTypedDamageState(declaration);
  return freeze({
    symbol: entry.symbol,
    settings,
    skeleton: skeleton.symbol,
    motions: motionIds,
    uses: freeze(typedUses),
    connections: freeze(connections),
    ...(hitzones.length > 0 ? { hitzones } : {}),
    ...(damageState ? { damageState } : {}),
    span: declaration.span,
  });
};
