import type { SourceSpan } from '../../../project/source/contract';
import type { AssetDiagnostic } from '../../../project/program/asset/contract';
import {
  type AssetSymbolId,
  type TypedAssetAssembly,
  type TypedAssetHir,
  type TypedComponent,
  type TypedGeometryBlock,
  type TypedGeometryStatement,
  type TypedMotion
} from './contract';
import { AssetBudgetAbort } from './budgets';
import {
  composeAssetFrames,
  connectAssetFrames,
  type AssetExactFrame
} from './frame';
import { identityTypedFrame } from './hirFrames';
import {
  type AssetBudgetDimension,
  type AssetBudgetLedger,
  type AssetInstantiationResult,
  type InstantiatedBone,
  type InstantiatedComponentInstance,
  type InstantiatedGeometryNode,
  type InstantiatedGeometryProperty,
  type InstantiatedGeometrySurface,
  type InstantiatedMotion,
  type InstantiatedMotionChannel,
  type InstantiatedMotionKey,
  type InstantiatedSocketConnection,
  type InstantiatedSocketEndpoint,
  type InstantiatedSurfaceBinding
} from './ir';
import { evaluateAssetExpression } from './valueEvaluate';
import {
  assetExactNumber,
  assetNumberValue,
  assetVectorValue,
  type AssetValue,
  type AssetVectorValue
} from './value/contract';

const freeze = <T>(value: T): T => Object.freeze(value);

const LIMITS: Readonly<Record<AssetBudgetDimension, number>> = freeze({
  instances: 1024,
  bones: 4096,
  nodes: 16384,
  faces: 65536,
  motionKeys: 65536,
  diagnostics: 256
});

class Ledger {
  private readonly values = new Map<AssetBudgetDimension, number>();
  constructor(private readonly issue: (path: string, span: SourceSpan,
    code: string, message: string) => void) {}
  use(dimension: AssetBudgetDimension, path: string, span: SourceSpan): void {
    const next = (this.values.get(dimension) ?? 0) + 1;
    this.values.set(dimension, next);
    if (next > LIMITS[dimension]) {
      this.issue(path, span, 'asset.instantiation-limit',
        `Asset instantiation exceeds the ${dimension} budget.`);
      throw new AssetBudgetAbort();
    }
  }
  note(dimension: AssetBudgetDimension): void {
    this.values.set(dimension, (this.values.get(dimension) ?? 0) + 1);
  }
  snapshot(): AssetBudgetLedger {
    const used = Object.create(null) as Record<AssetBudgetDimension, number>;
    for (const key of Object.keys(LIMITS) as AssetBudgetDimension[]) {
      used[key] = this.values.get(key) ?? 0;
    }
    return freeze({ limits: LIMITS, used: freeze(used) });
  }
}

interface Session {
  readonly hir: TypedAssetHir;
  readonly diagnostics: AssetDiagnostic[];
  readonly ledger: Ledger;
  readonly nodeIds: Set<string>;
  readonly pathFor: (symbol: AssetSymbolId) => string;
  readonly issue: (path: string, span: SourceSpan, code: string, message: string) => void;
}

const compareDiagnostics = (left: AssetDiagnostic, right: AssetDiagnostic): number =>
  left.path.localeCompare(right.path) || left.span.start.offset - right.span.start.offset ||
  left.span.end.offset - right.span.end.offset || left.code.localeCompare(right.code);

const rootAsset = (hir: TypedAssetHir): TypedAssetAssembly | null => {
  const rootKeys = new Set(Object.entries(hir.modules)
    .filter(([, module]) => module.path === hir.rootPath).map(([key]) => key));
  const matches = Object.values(hir.assets).filter((asset) =>
    rootKeys.has(asset.symbol.modulePath));
  return matches.length === 1 ? matches[0]! : null;
};

const buildBones = (
  session: Session,
  asset: TypedAssetAssembly
): Readonly<{
  readonly bones: readonly InstantiatedBone[];
  readonly world: ReadonlyMap<string, AssetExactFrame>;
}> | null => {
  const skeleton = session.hir.skeletons[asset.skeleton.key];
  const rig = skeleton === undefined ? undefined : session.hir.rigs[skeleton.rig.key];
  if (skeleton === undefined || rig === undefined) return null;
  const path = session.pathFor(skeleton.symbol);
  const bones: InstantiatedBone[] = [];
  const world = new Map<string, AssetExactFrame>();
  const active = new Set<string>();
  const add = (id: string): AssetExactFrame | null => {
    const known = world.get(id);
    if (known !== undefined) return known;
    const joint = rig.joints[id];
    const local = skeleton.binds[id];
    if (joint === undefined || local === undefined || active.has(id)) return null;
    active.add(id);
    const parentWorld = joint.parent === null ? identityTypedFrame() : add(joint.parent);
    const restFrame = parentWorld === null ? null : composeAssetFrames(parentWorld, local);
    active.delete(id);
    if (restFrame === null) {
      session.issue(path, joint.span, 'asset.invalid-rest-frame',
        `Cannot compose rest frame for semantic joint "${id}".`);
      return null;
    }
    session.ledger.use('bones', path, joint.span);
    world.set(id, restFrame);
    bones.push(freeze({ id, semanticJoint: id, parentId: joint.parent,
      parentRestFrame: local, sourcePath: path, span: joint.span }));
    return restFrame;
  };
  for (const id of Object.keys(rig.joints).sort()) add(id);
  bones.sort((left, right) => left.id.localeCompare(right.id));
  return freeze({ bones: freeze(bones), world });
};

const evaluated = (
  session: Session,
  path: string,
  statement: Extract<TypedGeometryStatement, { readonly kind: 'typed-geometry-property' }>,
  environment: ReadonlyMap<string, AssetValue>
): InstantiatedGeometryProperty | null => {
  const result = evaluateAssetExpression(statement.expression, environment);
  if (!result.ok) {
    for (const item of result.diagnostics) session.issue(path, item.span,
      item.code, item.message);
    return null;
  }
  return freeze({ name: statement.name, value: result.value, span: statement.span });
};

const surfaceOf = (
  session: Session,
  path: string,
  block: TypedGeometryBlock,
  bindings: Readonly<Record<string, AssetSymbolId>>
): InstantiatedGeometrySurface | null => {
  const surfaces = block.statements.filter((statement) =>
    statement.kind === 'typed-geometry-surface-bind');
  if (surfaces.length === 0) return null;
  const source = surfaces[0]!;
  const surface = bindings[source.surfacePort];
  if (surface === undefined || session.hir.surfaces[surface.key] === undefined) {
    session.issue(path, source.span, 'asset.missing-surface-binding',
      `Geometry surface port "${source.surfacePort}" has no concrete binding.`);
    return null;
  }
  return freeze({ port: source.surfacePort, chart: source.chart,
    surface, span: source.span });
};

const instantiateGeometry = (
  session: Session,
  component: TypedComponent,
  instanceId: string,
  environment: ReadonlyMap<string, AssetValue>,
  surfaceBindings: Readonly<Record<string, AssetSymbolId>>
): readonly InstantiatedGeometryNode[] => {
  const path = session.pathFor(component.symbol);
  const jointBindings = new Map(component.jointBindings.map((binding) =>
    [binding.geometryBone, binding.rigJoint]));
  const walk = (
    statements: readonly TypedGeometryStatement[],
    attachment: string | null,
    lexicalPath: readonly string[]
  ): InstantiatedGeometryNode[] => {
    const nodes: InstantiatedGeometryNode[] = [];
    for (const statement of statements) {
      if (statement.kind !== 'typed-geometry-block') continue;
      const nextPath = [...lexicalPath, statement.id];
      const bound = statement.keyword === 'bone' ? jointBindings.get(statement.id) : undefined;
      const nextAttachment = bound ?? (statement.keyword === 'bone'
        ? [instanceId, ...nextPath].join('/') : attachment);
      if (bound !== undefined) {
        nodes.push(...walk(statement.statements, bound, nextPath));
        continue;
      }
      const id = [instanceId, ...nextPath].join('/');
      if (session.nodeIds.has(id)) session.issue(path, statement.span,
        'asset.duplicate-emitted-id', `Instantiated node id "${id}" is not unique.`);
      session.nodeIds.add(id);
      session.ledger.use(statement.keyword === 'face' ? 'faces' : 'nodes', path, statement.span);
      const properties: InstantiatedGeometryProperty[] = [];
      for (const child of statement.statements) if (child.kind === 'typed-geometry-property') {
        const property = evaluated(session, path, child, environment);
        if (property !== null) properties.push(property);
      }
      nodes.push(freeze({ kind: statement.keyword, id, attachmentBoneId: attachment,
        properties: freeze(properties),
        surface: surfaceOf(session, path, statement, surfaceBindings),
        children: freeze(walk(statement.statements, nextAttachment, nextPath)),
        sourcePath: path, span: statement.span }));
    }
    return nodes;
  };
  return freeze(walk(component.geometry.statements, null, freeze([])));
};

const buildInstance = (
  session: Session,
  use: TypedAssetAssembly['uses'][number]
): InstantiatedComponentInstance | null => {
  const component = session.hir.components[use.component.key];
  if (component === undefined) return null;
  const path = session.pathFor(component.symbol);
  session.ledger.use('instances', path, use.span);
  const surfaceBindings = Object.create(null) as Record<string, AssetSymbolId>;
  for (const [port, symbol] of Object.entries(use.portBindings)) {
    if (session.hir.surfaces[symbol.key] !== undefined) surfaceBindings[port] = symbol;
  }
  const environment = new Map(Object.entries(use.parameters));
  const placementAuthority = component.ports.some((port) =>
    port.direction === 'requires' && port.domain === 'rig') ? 'rig' : 'socket';
  const socketEndpoints: InstantiatedSocketEndpoint[] = component.socketBindings.map((binding) => {
    const port = component.ports.find((candidate) => candidate.id === binding.port)!;
    const semantic = component.jointBindings.find((candidate) =>
      candidate.geometryBone === binding.geometryBone)?.rigJoint;
    return freeze({ port: binding.port,
      geometryBoneId: semantic ?? `${use.id}/${binding.geometryBone}`,
      frame: binding.frame, contract: port.type, sourcePath: path, span: binding.span });
  });
  return freeze({ id: use.id, component: component.symbol,
    placementAuthority,
    placement: identityTypedFrame(), parameters: use.parameters,
    socketEndpoints: freeze(socketEndpoints),
    geometry: instantiateGeometry(session, component, use.id, environment,
      freeze(surfaceBindings)), sourcePath: path, span: use.span });
};

const endpoint = (
  instance: InstantiatedComponentInstance,
  port: string
): InstantiatedSocketEndpoint | null => instance.socketEndpoints.find((item) =>
  item.port === port) ?? null;

const placeConnections = (
  session: Session,
  asset: TypedAssetAssembly,
  instances: readonly InstantiatedComponentInstance[],
  skeletonWorld: ReadonlyMap<string, AssetExactFrame>
): Readonly<{ readonly instances: readonly InstantiatedComponentInstance[];
  readonly connections: readonly InstantiatedSocketConnection[] }> => {
  const skeleton = session.hir.skeletons[asset.skeleton.key]!;
  const rig = session.hir.rigs[skeleton.rig.key]!;
  const byId = new Map(instances.map((instance) => [instance.id, instance]));
  const placements = new Map(instances.filter((instance) =>
    instance.placementAuthority === 'rig').map((instance) => [instance.id, instance.placement]));
  const placed = new Set(placements.keys());
  const pending = [...asset.connections];
  const connections: InstantiatedSocketConnection[] = [];
  let progressed = true;
  while (pending.length > 0 && progressed) {
    progressed = false;
    for (let index = pending.length - 1; index >= 0; index -= 1) {
      const connection = pending[index]!;
      const target = byId.get(connection.toInstance);
      const required = target === undefined ? null : endpoint(target, connection.toPort);
      let providerWorld: AssetExactFrame | null = null;
      let providerLocal: AssetExactFrame | null = null;
      let parentBoneId: string | null = null;
      if (connection.fromInstance === 'skeleton') {
        const socket = rig.sockets[connection.fromPort];
        const jointWorld = socket === undefined ? undefined : skeletonWorld.get(socket.joint);
        parentBoneId = socket?.joint ?? null;
        providerLocal = socket?.frame ?? null;
        providerWorld = socket === undefined || jointWorld === undefined ? null :
          composeAssetFrames(jointWorld, socket.frame);
      } else {
        const provider = byId.get(connection.fromInstance);
        const provided = provider === undefined ? null : endpoint(provider, connection.fromPort);
        const placement = provider === undefined ? undefined : placements.get(provider.id);
        const semanticWorld = provided === null ? undefined :
          skeletonWorld.get(provided.geometryBoneId);
        const ownerWorld = semanticWorld ?? placement;
        parentBoneId = provided?.geometryBoneId ?? null;
        providerLocal = provided?.frame ?? null;
        providerWorld = provided === null || ownerWorld === undefined ||
          !placed.has(provider!.id) ? null : composeAssetFrames(ownerWorld, provided.frame);
      }
      if (providerWorld === null || providerLocal === null ||
        parentBoneId === null || required === null) continue;
      const parentPlacement = connectAssetFrames(providerLocal, required.frame);
      const placement = connectAssetFrames(providerWorld, required.frame);
      if (parentPlacement === null || placement === null) {
        session.issue(target!.sourcePath, connection.span, 'asset.connection-frame',
          'Socket connection frames cannot be composed exactly.');
        pending.splice(index, 1);
        progressed = true;
        continue;
      }
      placements.set(target!.id, placement);
      placed.add(target!.id);
      connections.push(freeze({ id: `${connection.fromInstance}.${connection.fromPort}->` +
        `${connection.toInstance}.${connection.toPort}`,
      fromInstance: connection.fromInstance, fromPort: connection.fromPort,
      toInstance: connection.toInstance, toPort: connection.toPort,
      targetBoneId: required.geometryBoneId, parentBoneId,
      parentPlacement, span: connection.span }));
      pending.splice(index, 1);
      progressed = true;
    }
  }
  for (const connection of pending) session.issue(session.pathFor(asset.symbol),
    connection.span, 'asset.connection-order',
    'Socket connection cannot resolve a provider placement.');
  const placedInstances = instances.map((instance) => freeze({ ...instance,
    placement: placements.get(instance.id) ?? instance.placement }));
  connections.sort((left, right) => left.id.localeCompare(right.id));
  return freeze({ instances: freeze(placedInstances), connections: freeze(connections) });
};

const buildMotions = (
  session: Session,
  asset: TypedAssetAssembly
): readonly InstantiatedMotion[] => {
  const skeleton = session.hir.skeletons[asset.skeleton.key]!;
  const rig = session.hir.rigs[skeleton.rig.key]!;
  const dot = (left: readonly number[], right: readonly number[]): -1 | 0 | 1 =>
    (left[0]! * right[0]! + left[1]! * right[1]! + left[2]! * right[2]!) as -1 | 0 | 1;
  const mapVector = (
    source: AssetVectorValue,
    target: string,
    property: InstantiatedMotionChannel['property']
  ): AssetVectorValue | null => {
    const semantic = rig.joints[target]?.frame;
    const concrete = skeleton.binds[target];
    if (semantic === undefined || concrete === undefined) return null;
    const semanticAxes = [semantic.xAxis, semantic.yAxis, semantic.zAxis];
    const concreteAxes = [concrete.xAxis, concrete.yAxis, concrete.zAxis];
    try {
      const values = concreteAxes.map((targetAxis) => {
        const sourceIndex = semanticAxes.findIndex((sourceAxis) =>
          dot(targetAxis, sourceAxis) !== 0);
        const coefficient = dot(targetAxis, semanticAxes[sourceIndex]!);
        const input = source.values[sourceIndex]!.value;
        return assetNumberValue(assetExactNumber(
          input.numerator * BigInt(property === 'scale' ? Math.abs(coefficient) : coefficient),
          input.denominator,
          input.unit
        ));
      });
      return assetVectorValue(values, source.type);
    } catch {
      return null;
    }
  };
  return asset.motions.flatMap((symbol) => {
  const motion: TypedMotion | undefined = session.hir.motions[symbol.key];
  if (motion === undefined) return [];
  const path = session.pathFor(motion.symbol);
  const channels: InstantiatedMotionChannel[] = motion.tracks.flatMap((track) => {
    const keys: InstantiatedMotionKey[] = track.keyframes.flatMap((key) => {
      session.ledger.use('motionKeys', path, key.span);
      const value = mapVector(key.value, track.target, track.property);
      if (value === null) {
        session.issue(path, key.span, 'asset.motion-frame-map',
          `Motion key cannot map semantic joint "${track.target}" into its skeleton frame.`);
        return [];
      }
      return [freeze({ time: key.time, value,
        interpolation: key.interpolation, span: key.span })];
    });
    return [freeze({ id: `${motion.symbol.name}:${track.target}:${track.property}`,
      targetBoneId: track.target, property: track.property,
      keys: freeze(keys), span: track.span })];
  });
  return [freeze({ symbol: motion.symbol, sourcePath: path, duration: motion.duration,
    fps: motion.fps, loop: motion.loop, restRelative: motion.restRelative,
    channels: freeze(channels), span: motion.span })];
  });
};

/** Instantiate one selected root asset. HIR and plans never escape the compiler. */
export const instantiateAsset = (hir: TypedAssetHir): AssetInstantiationResult => {
  const diagnostics: AssetDiagnostic[] = [];
  const modulePaths = new Map(Object.entries(hir.modules).map(([key, module]) =>
    [key, module.path]));
  const pathFor = (symbol: AssetSymbolId): string =>
    modulePaths.get(symbol.modulePath) ?? hir.rootPath;
  let ledger!: Ledger;
  const issue = (path: string, span: SourceSpan, code: string, message: string): void => {
    if (diagnostics.length >= LIMITS.diagnostics) throw new AssetBudgetAbort();
    diagnostics.push(freeze({ severity: 'error', code, message, path, span }));
    if (ledger !== undefined) ledger.note('diagnostics');
  };
  ledger = new Ledger(issue);
  const session: Session = freeze({ hir, diagnostics, ledger,
    nodeIds: new Set<string>(), pathFor, issue });
  try {
    const asset = rootAsset(hir);
    if (asset === null || asset.settings.forward === null) {
      const span = Object.values(hir.assets)[0]?.span;
      if (span === undefined) throw new TypeError('Typed HIR has no selected root asset span.');
      issue(hir.rootPath, span, 'asset.root-entry',
        'Typed HIR must contain one selected root asset.');
      throw new AssetBudgetAbort();
    }
    const skeleton = hir.skeletons[asset.skeleton.key];
    const rig = skeleton === undefined ? undefined : hir.rigs[skeleton.rig.key];
    const bonePlan = buildBones(session, asset);
    if (skeleton === undefined || rig === undefined || bonePlan === null) {
      issue(pathFor(asset.symbol), asset.span, 'asset.missing-skeleton',
        'Selected asset requires a complete typed skeleton and rig.');
      throw new AssetBudgetAbort();
    }
    const rawInstances = asset.uses.flatMap((use) => {
      const instance = buildInstance(session, use);
      return instance === null ? [] : [instance];
    });
    const placed = placeConnections(session, asset, rawInstances, bonePlan.world);
    const selectedSurfaces = new Map<string, InstantiatedSurfaceBinding>();
    for (const use of asset.uses) for (const symbol of Object.values(use.portBindings)) {
      const surface = hir.surfaces[symbol.key];
      const contract = surface === undefined ? undefined : hir.surfaceContracts[surface.contract.key];
      if (surface === undefined || contract === undefined || selectedSurfaces.has(symbol.key)) continue;
      selectedSurfaces.set(symbol.key, freeze({ surface: symbol, contract: contract.symbol,
        material: surface.material, charts: freeze(Object.keys(contract.charts).sort()),
        span: surface.span }));
    }
    if (diagnostics.length > 0) throw new AssetBudgetAbort();
    return freeze({ ok: true, ir: freeze({ asset: asset.symbol,
      settings: freeze({ density: asset.settings.density,
        forward: asset.settings.forward }), rig: rig.symbol, skeleton: skeleton.symbol,
      bones: bonePlan.bones, instances: placed.instances,
      surfaces: freeze([...selectedSurfaces.values()].sort((left, right) =>
        left.surface.key.localeCompare(right.surface.key))),
      connections: placed.connections, motions: freeze(buildMotions(session, asset)),
      budget: ledger.snapshot() }) });
  } catch (error) {
    if (!(error instanceof AssetBudgetAbort)) throw error;
    return freeze({ ok: false,
      diagnostics: freeze([...diagnostics].sort(compareDiagnostics)) });
  }
};
