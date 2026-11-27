import { compareText } from '../../../stableOrder';
import { freeze } from '../../../immutable';
import type { SourceSpan } from '../../../project/source/contract';
import type { AssetDiagnostic } from '../../../project/program/asset/contract';
import { compareDiagnostics } from './diagnostics';
import {
  type AssetSymbolId,
  type TypedAssetAssembly,
  type TypedAssetHir,
  type TypedComponent,
  type TypedGeometryBlock,
  type TypedGeometryStatement,
  type TypedRigContract,
  type TypedSkeleton,
} from './contract';
import { AssetBudgetAbort } from './budgets';
import { composeAssetFrames, type AssetExactFrame } from './frame';
import { identityTypedFrame } from './hirFrames';
import {
  INSTANTIATION_LIMITS,
  InstantiationLedger,
  buildMotions,
  collectSelectedSurfaces,
  placeConnections,
  type InstantiationSession,
} from './instantiatePlan';
import {
  type AssetInstantiationResult,
  type InstantiatedBone,
  type InstantiatedComponentInstance,
  type InstantiatedExpressionVariant,
  type InstantiatedGeometryNode,
  type InstantiatedGeometryProperty,
  type InstantiatedGeometrySurface,
  type InstantiatedSocketEndpoint,
} from './ir';
import { evaluateAssetExpression } from './value/evaluate';
import { type AssetValue } from './value/contract';
import { mirrorInstantiatedNode } from './instantiateMirror';

const rootAsset = (hir: TypedAssetHir): TypedAssetAssembly | null => {
  const rootKeys = new Set(
    Object.entries(hir.modules)
      .filter(([, module]) => module.path === hir.rootPath)
      .map(([key]) => key),
  );
  const matches = Object.values(hir.assets).filter((asset) =>
    rootKeys.has(asset.symbol.modulePath),
  );
  return matches.length === 1 ? matches[0]! : null;
};

interface BoneBuildContext {
  readonly session: InstantiationSession;
  readonly rig: TypedRigContract;
  readonly skeleton: TypedSkeleton;
  readonly path: string;
  readonly bones: InstantiatedBone[];
  readonly world: Map<string, AssetExactFrame>;
  readonly active: Set<string>;
}

const addBone = (id: string, ctx: BoneBuildContext): AssetExactFrame | null => {
  const known = ctx.world.get(id);
  if (known !== undefined) return known;
  const joint = ctx.rig.joints[id];
  const local = ctx.skeleton.binds[id];
  if (joint === undefined || local === undefined || ctx.active.has(id)) return null;
  ctx.active.add(id);
  const parentWorld = joint.parent === null ? identityTypedFrame() : addBone(joint.parent, ctx);
  const restFrame = parentWorld === null ? null : composeAssetFrames(parentWorld, local);
  ctx.active.delete(id);
  if (restFrame === null) {
    ctx.session.issue(
      ctx.path,
      joint.span,
      'asset.invalid-rest-frame',
      `Cannot compose rest frame for semantic joint "${id}".`,
    );
    return null;
  }
  ctx.session.ledger.use('bones', ctx.path, joint.span);
  ctx.world.set(id, restFrame);
  ctx.bones.push(
    freeze({
      id,
      semanticJoint: id,
      parentId: joint.parent,
      parentRestFrame: local,
      role: joint.role,
      channels: joint.channels,
      mirror: joint.mirror,
      limits: joint.limits,
      sourcePath: ctx.path,
      span: joint.span,
    }),
  );
  return restFrame;
};

const buildBones = (
  session: InstantiationSession,
  asset: TypedAssetAssembly,
): Readonly<{
  readonly bones: readonly InstantiatedBone[];
  readonly world: ReadonlyMap<string, AssetExactFrame>;
}> | null => {
  const skeleton = session.hir.skeletons[asset.skeleton.key];
  const rig = skeleton === undefined ? undefined : session.hir.rigs[skeleton.rig.key];
  if (skeleton === undefined || rig === undefined) return null;
  const ctx: BoneBuildContext = {
    session,
    rig,
    skeleton,
    path: session.pathFor(skeleton.symbol),
    bones: [],
    world: new Map<string, AssetExactFrame>(),
    active: new Set<string>(),
  };
  for (const id of Object.keys(rig.joints).sort(compareText)) addBone(id, ctx);
  ctx.bones.sort((left, right) => compareText(left.id, right.id));
  return freeze({ bones: freeze(ctx.bones), world: ctx.world });
};

const evaluated = (
  session: InstantiationSession,
  path: string,
  statement: Extract<TypedGeometryStatement, { readonly kind: 'typed-geometry-property' }>,
  environment: ReadonlyMap<string, AssetValue>,
): InstantiatedGeometryProperty | null => {
  const result = evaluateAssetExpression(statement.expression, environment);
  if (!result.ok) {
    for (const item of result.diagnostics) session.issue(path, item.span, item.code, item.message);
    return null;
  }
  return freeze({ name: statement.name, value: result.value, span: statement.span });
};

const surfaceOf = (
  session: InstantiationSession,
  path: string,
  block: TypedGeometryBlock,
  bindings: Readonly<Record<string, AssetSymbolId>>,
): InstantiatedGeometrySurface | null => {
  const surfaces = block.statements.filter(
    (statement) => statement.kind === 'typed-geometry-surface-bind',
  );
  if (surfaces.length === 0) return null;
  const source = surfaces[0]!;
  const surface = bindings[source.surfacePort];
  if (surface === undefined || session.hir.surfaces[surface.key] === undefined) {
    session.issue(
      path,
      source.span,
      'asset.missing-surface-binding',
      `Geometry surface port "${source.surfacePort}" has no concrete binding.`,
    );
    return null;
  }
  return freeze({ port: source.surfacePort, chart: source.chart, surface, span: source.span });
};

interface GeometryWalkContext {
  readonly session: InstantiationSession;
  readonly path: string;
  readonly instanceId: string;
  readonly environment: ReadonlyMap<string, AssetValue>;
  readonly surfaceBindings: Readonly<Record<string, AssetSymbolId>>;
  readonly jointBindings: ReadonlyMap<string, string>;
}

const expressionVariantsOf = (
  ctx: GeometryWalkContext,
  block: TypedGeometryBlock,
): readonly InstantiatedExpressionVariant[] | undefined => {
  if (block.keyword !== 'expression_slot') return undefined;
  const variants: InstantiatedExpressionVariant[] = [];
  for (const stmt of block.statements) {
    if (stmt.kind !== 'typed-geometry-expr-variant') continue;
    const surface = ctx.surfaceBindings[stmt.surfacePort];
    if (surface === undefined || ctx.session.hir.surfaces[surface.key] === undefined) {
      ctx.session.issue(
        ctx.path,
        stmt.span,
        'asset.missing-surface-binding',
        `Expression variant port "${stmt.surfacePort}" has no concrete binding.`,
      );
      continue;
    }
    variants.push(
      freeze({
        variant: stmt.variant,
        surface: freeze({
          port: stmt.surfacePort,
          chart: stmt.chart,
          surface,
          span: stmt.span,
        }),
        span: stmt.span,
      }),
    );
  }
  return freeze(variants);
};

const evaluateBlockProperties = (
  ctx: GeometryWalkContext,
  block: TypedGeometryBlock,
): readonly InstantiatedGeometryProperty[] => {
  const properties: InstantiatedGeometryProperty[] = [];
  for (const child of block.statements) {
    if (child.kind !== 'typed-geometry-property') continue;
    const property = evaluated(ctx.session, ctx.path, child, ctx.environment);
    if (property !== null) properties.push(property);
  }
  return freeze(properties);
};

const registerNodeId = (
  ctx: GeometryWalkContext,
  id: string,
  span: SourceSpan,
  kind: InstantiatedGeometryNode['kind'],
): void => {
  if (ctx.session.nodeIds.has(id)) {
    ctx.session.issue(
      ctx.path,
      span,
      'asset.duplicate-emitted-id',
      `Instantiated node id "${id}" is not unique.`,
    );
  }
  ctx.session.nodeIds.add(id);
  ctx.session.ledger.use(kind === 'face' ? 'faces' : 'nodes', ctx.path, span);
};

const emitMirroredSibling = (
  ctx: GeometryWalkContext,
  statement: TypedGeometryBlock,
  node: InstantiatedGeometryNode,
  lexicalPath: readonly string[],
  nodes: InstantiatedGeometryNode[],
): void => {
  const mirrorBind = statement.statements.find((entry) => entry.kind === 'typed-geometry-mirror');
  if (mirrorBind === undefined) return;
  const mirroredId = [ctx.instanceId, ...lexicalPath, mirrorBind.targetId].join('/');
  registerNodeId(ctx, mirroredId, mirrorBind.span, node.kind);
  const mirrored = mirrorInstantiatedNode(node, mirroredId, mirrorBind.span);
  for (const child of mirrored.children) registerNodeId(ctx, child.id, child.span, child.kind);
  nodes.push(mirrored);
};

const optionValueOf = (
  statement: Extract<TypedGeometryStatement, { readonly kind: 'typed-geometry-block' }>,
  name: 'axis' | 'slope' | 'placement',
): string | undefined => {
  const opt = statement.statements.find(
    (entry) => entry.kind === 'typed-geometry-option' && entry.name === name,
  );
  return opt?.kind === 'typed-geometry-option' ? opt.value : undefined;
};

const instantiateGeometryNode = (
  ctx: GeometryWalkContext,
  statement: Extract<TypedGeometryStatement, { readonly kind: 'typed-geometry-block' }>,
  id: string,
  attachment: string | null,
  nextPath: readonly string[],
): InstantiatedGeometryNode => {
  const nextAttachment = statement.keyword === 'bone' ? id : attachment;
  const axis = optionValueOf(statement, 'axis');
  const slope = optionValueOf(statement, 'slope');
  const placement = optionValueOf(statement, 'placement');
  const expressionVariants = expressionVariantsOf(ctx, statement);
  return freeze({
    kind: statement.keyword,
    id,
    attachmentBoneId: attachment,
    properties: evaluateBlockProperties(ctx, statement),
    surface: surfaceOf(ctx.session, ctx.path, statement, ctx.surfaceBindings),
    children: freeze(walkGeometry(ctx, statement.statements, nextAttachment, nextPath)),
    ...(axis !== undefined ? { axis: axis as 'x' | 'y' | 'z' } : {}),
    ...(slope !== undefined ? { slope: slope as 'north' | 'south' | 'east' | 'west' } : {}),
    ...(placement !== undefined
      ? { placement: placement as 'front' | 'lateral_pair' | 'corner_wrap' }
      : {}),
    ...(expressionVariants !== undefined ? { expressionVariants } : {}),
    sourcePath: ctx.path,
    span: statement.span,
  });
};

const walkGeometry = (
  ctx: GeometryWalkContext,
  statements: readonly TypedGeometryStatement[],
  attachment: string | null,
  lexicalPath: readonly string[],
): InstantiatedGeometryNode[] => {
  const nodes: InstantiatedGeometryNode[] = [];
  for (const statement of statements) {
    if (statement.kind !== 'typed-geometry-block') continue;
    const nextPath = [...lexicalPath, statement.id];
    const bound = statement.keyword === 'bone' ? ctx.jointBindings.get(statement.id) : undefined;
    if (bound !== undefined) {
      nodes.push(...walkGeometry(ctx, statement.statements, bound, nextPath));
      continue;
    }
    const id = [ctx.instanceId, ...nextPath].join('/');
    registerNodeId(ctx, id, statement.span, statement.keyword);
    const node = instantiateGeometryNode(ctx, statement, id, attachment, nextPath);
    nodes.push(node);
    emitMirroredSibling(ctx, statement, node, lexicalPath, nodes);
  }
  return nodes;
};

const instantiateGeometry = (
  session: InstantiationSession,
  component: TypedComponent,
  instanceId: string,
  environment: ReadonlyMap<string, AssetValue>,
  surfaceBindings: Readonly<Record<string, AssetSymbolId>>,
): readonly InstantiatedGeometryNode[] => {
  const ctx: GeometryWalkContext = {
    session,
    path: session.pathFor(component.symbol),
    instanceId,
    environment,
    surfaceBindings,
    jointBindings: new Map(
      component.jointBindings.map((binding) => [binding.geometryBone, binding.rigJoint]),
    ),
  };
  return freeze(walkGeometry(ctx, component.geometry.statements, null, freeze([])));
};

const buildInstance = (
  session: InstantiationSession,
  use: TypedAssetAssembly['uses'][number],
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
  const placementAuthority = component.ports.some(
    (port) => port.direction === 'requires' && port.domain === 'rig',
  )
    ? 'rig'
    : 'socket';
  const socketEndpoints: InstantiatedSocketEndpoint[] = component.socketBindings.map((binding) => {
    const port = component.ports.find((candidate) => candidate.id === binding.port)!;
    const semantic = component.jointBindings.find(
      (candidate) => candidate.geometryBone === binding.geometryBone,
    )?.rigJoint;
    return freeze({
      port: binding.port,
      geometryBoneId: semantic ?? `${use.id}/${binding.geometryBone}`,
      frame: binding.frame,
      contract: port.type,
      sourcePath: path,
      span: binding.span,
    });
  });
  return freeze({
    id: use.id,
    component: component.symbol,
    placementAuthority,
    placement: identityTypedFrame(),
    parameters: use.parameters,
    socketEndpoints: freeze(socketEndpoints),
    geometry: instantiateGeometry(session, component, use.id, environment, freeze(surfaceBindings)),
    sourcePath: path,
    span: use.span,
  });
};

const createSession = (
  hir: TypedAssetHir,
  diagnostics: AssetDiagnostic[],
): InstantiationSession => {
  const modulePaths = new Map(
    Object.entries(hir.modules).map(([key, module]) => [key, module.path]),
  );
  const pathFor = (symbol: AssetSymbolId): string =>
    modulePaths.get(symbol.modulePath) ?? hir.rootPath;
  let ledger!: InstantiationLedger;
  const issue = (path: string, span: SourceSpan, code: string, message: string): void => {
    if (diagnostics.length >= INSTANTIATION_LIMITS.diagnostics) throw new AssetBudgetAbort();
    diagnostics.push(freeze({ severity: 'error', code, message, path, span }));
    if (ledger !== undefined) ledger.note('diagnostics');
  };
  ledger = new InstantiationLedger(issue);
  return freeze({ hir, diagnostics, ledger, nodeIds: new Set<string>(), pathFor, issue });
};

const buildAssetIr = (
  session: ReturnType<typeof createSession>,
  asset: NonNullable<ReturnType<typeof rootAsset>>,
  rig: NonNullable<TypedAssetHir['rigs'][string]>,
  skeleton: NonNullable<TypedAssetHir['skeletons'][string]>,
  bonePlan: NonNullable<ReturnType<typeof buildBones>>,
  placed: ReturnType<typeof placeConnections>,
  surfaces: ReturnType<typeof collectSelectedSurfaces>,
) =>
  freeze({
    asset: asset.symbol,
    settings: freeze({
      density: asset.settings.density,
      forward: asset.settings.forward!,
      profile: asset.settings.profile,
    }),
    rig: rig.symbol,
    skeleton: skeleton.symbol,
    bones: bonePlan.bones,
    chains: rig.chains,
    ikLimbs: rig.ikLimbs,
    anchors: rig.anchors,
    instances: placed.instances,
    surfaces,
    connections: placed.connections,
    motions: freeze(buildMotions(session, asset)),
    budget: session.ledger.snapshot(),
  });

/** Instantiate one selected root asset. HIR and plans never escape the compiler. */
export const instantiateAsset = (hir: TypedAssetHir): AssetInstantiationResult => {
  const diagnostics: AssetDiagnostic[] = [];
  const session = createSession(hir, diagnostics);
  try {
    const asset = rootAsset(hir);
    if (asset === null || asset.settings.forward === null) {
      const span = Object.values(hir.assets)[0]?.span;
      if (span === undefined) throw new TypeError('Typed HIR has no selected root asset span.');
      session.issue(
        hir.rootPath,
        span,
        'asset.root-entry',
        'Typed HIR must contain one selected root asset.',
      );
      throw new AssetBudgetAbort();
    }
    const skeleton = hir.skeletons[asset.skeleton.key];
    const rig = skeleton === undefined ? undefined : hir.rigs[skeleton.rig.key];
    const bonePlan = buildBones(session, asset);
    if (skeleton === undefined || rig === undefined || bonePlan === null) {
      session.issue(
        session.pathFor(asset.symbol),
        asset.span,
        'asset.missing-skeleton',
        'Selected asset requires a complete typed skeleton and rig.',
      );
      throw new AssetBudgetAbort();
    }
    const rawInstances = asset.uses.flatMap((use) => buildInstance(session, use) ?? []);
    const placed = placeConnections(session, asset, rawInstances, bonePlan.world);
    const surfaces = collectSelectedSurfaces(hir, asset);
    if (diagnostics.length > 0) throw new AssetBudgetAbort();
    return freeze({
      ok: true,
      ir: buildAssetIr(session, asset, rig, skeleton, bonePlan, placed, surfaces),
    });
  } catch (error) {
    if (!(error instanceof AssetBudgetAbort)) throw error;
    return freeze({ ok: false, diagnostics: freeze([...diagnostics].sort(compareDiagnostics)) });
  }
};
