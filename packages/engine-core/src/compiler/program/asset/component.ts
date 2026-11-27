import { freeze } from '../../../immutable';
import type { AssetComponentDecl } from '../../../project/program/asset/contract';
import { nullRecord } from './diagnostics';
import type {
  AssetSymbolKind,
  TypedComponent,
  TypedJointBinding,
  TypedPort,
  TypedRigContract,
  TypedSocketBinding,
  TypedSocketContract,
  TypedSurfaceContract,
} from './contract';
import type { AssemblyContext, AssemblyEntry, AssemblyState } from './assembly';
import { validateGeometryHierarchy } from './assembly';
import { buildTypedFrame } from './hirFrames';
import { compileGeometryPayload } from './hirGeometry';
import { compileAndEvaluateHirExpression } from './hirValues';
import type { AssetValue } from './value/contract';

const portKind = (domain: TypedPort['domain']): AssetSymbolKind =>
  domain === 'rig' ? 'rig-contract' : domain === 'surface' ? 'surface-contract' : 'socket-contract';

const buildParameters = (
  context: AssemblyContext,
  state: AssemblyState,
  declaration: AssetComponentDecl,
): {
  readonly parameters: Readonly<Record<string, TypedComponent['parameters'][string]>>;
  readonly parameterDefaults: Readonly<Record<string, AssetValue>>;
} => {
  const parameters = nullRecord<TypedComponent['parameters'][string]>();
  const parameterDefaults = nullRecord<AssetValue>();
  for (const parameter of declaration.parameters) {
    if (parameters[parameter.id] !== undefined) {
      context.issue(
        state.path,
        parameter.span,
        'asset.duplicate-parameter',
        `Component parameter "${parameter.id}" is declared more than once.`,
      );
    }
    parameters[parameter.id] = parameter.type;
    if (parameter.defaultValue) {
      const evaluated = compileAndEvaluateHirExpression(
        parameter.defaultValue,
        parameter.type,
        new Map(),
        new Map(),
        state.path,
        context.issue,
      );
      if (evaluated !== null) parameterDefaults[parameter.id] = evaluated;
    }
  }
  return { parameters: freeze(parameters), parameterDefaults: freeze(parameterDefaults) };
};

const buildPorts = (
  context: AssemblyContext,
  state: AssemblyState,
  declaration: AssetComponentDecl,
): Readonly<{
  readonly ports: readonly TypedPort[];
  readonly portsById: Map<string, TypedPort>;
}> => {
  const ports: TypedPort[] = [];
  const portsById = new Map<string, TypedPort>();
  for (const port of declaration.ports) {
    if (portsById.has(port.id)) {
      context.issue(
        state.path,
        port.span,
        'asset.duplicate-port',
        `Component port "${port.id}" is declared more than once.`,
      );
    }
    const target = context.resolve(state, port.type, portKind(port.domain));
    if (target === null) continue;
    const typed = freeze({
      direction: port.direction,
      domain: port.domain,
      id: port.id,
      type: target.symbol,
      capacity: port.capacity,
      span: port.span,
    });
    ports.push(typed);
    portsById.set(port.id, typed);
  }
  return { ports: freeze(ports), portsById };
};

const resolveJointBinding = (
  context: AssemblyContext,
  state: AssemblyState,
  binding: AssetComponentDecl['jointBindings'][number],
  rigBound: boolean,
  requiredRigPort: string | undefined,
  rig: TypedRigContract | undefined,
  boundBones: Set<string>,
  boundJoints: Set<string>,
): TypedJointBinding | null => {
  if (!rigBound || rig === undefined) {
    context.issue(
      state.path,
      binding.span,
      'asset.component-placement',
      'Only a rig-bound component may bind semantic joints.',
    );
    return null;
  }
  const [port, joint, extra] = binding.rigJoint.segments;
  if (
    extra !== undefined ||
    port !== requiredRigPort ||
    joint === undefined ||
    rig.joints[joint] === undefined
  ) {
    context.issue(
      state.path,
      binding.span,
      'asset.invalid-joint-binding',
      'A component joint binding must name its required rig port and a declared semantic joint.',
    );
    return null;
  }
  if (boundBones.has(binding.geometryBone) || boundJoints.has(joint)) {
    context.issue(
      state.path,
      binding.span,
      'asset.duplicate-joint-binding',
      'Geometry bones and semantic joints bind at most once per component.',
    );
  }
  boundBones.add(binding.geometryBone);
  boundJoints.add(joint);
  return freeze({ geometryBone: binding.geometryBone, rigJoint: joint, span: binding.span });
};

const buildJointBindings = (
  context: AssemblyContext,
  state: AssemblyState,
  declaration: AssetComponentDecl,
  rigBound: boolean,
  requiredRig: readonly TypedPort[],
  rigs: Readonly<Record<string, TypedRigContract>>,
): Readonly<{
  readonly jointBindings: readonly TypedJointBinding[];
  readonly boundBones: Set<string>;
}> => {
  const jointBindings: TypedJointBinding[] = [];
  const boundBones = new Set<string>();
  const boundJoints = new Set<string>();
  const rig = requiredRig.length === 1 ? rigs[requiredRig[0]!.type.key] : undefined;
  for (const binding of declaration.jointBindings) {
    const resolved = resolveJointBinding(
      context,
      state,
      binding,
      rigBound,
      requiredRig[0]?.id,
      rig,
      boundBones,
      boundJoints,
    );
    if (resolved !== null) jointBindings.push(resolved);
  }
  if (rigBound && jointBindings.length === 0) {
    context.issue(
      state.path,
      declaration.span,
      'asset.component-placement',
      'A rig-bound component requires at least one semantic joint binding.',
    );
  }
  return { jointBindings: freeze(jointBindings), boundBones };
};

const resolveSocketBinding = (
  context: AssemblyContext,
  state: AssemblyState,
  binding: AssetComponentDecl['socketBindings'][number],
  portsById: ReadonlyMap<string, TypedPort>,
  socketContracts: Readonly<Record<string, TypedSocketContract>>,
  socketEndpoints: Set<string>,
): TypedSocketBinding | null => {
  const port = portsById.get(binding.port);
  const contract = port?.domain === 'socket' ? socketContracts[port.type.key] : undefined;
  if (port?.domain !== 'socket' || contract === undefined) {
    context.issue(
      state.path,
      binding.span,
      'asset.invalid-socket-binding',
      'A component socket binding must name one declared socket port.',
    );
    return null;
  }
  if (socketEndpoints.has(binding.port)) {
    context.issue(
      state.path,
      binding.span,
      'asset.duplicate-socket-binding',
      `Socket port "${binding.port}" is bound more than once.`,
    );
  }
  socketEndpoints.add(binding.port);
  const frame = buildTypedFrame(
    state.path,
    binding.frame,
    null,
    contract.handedness === 'left',
    binding.span,
    contract.handedness,
    context.issue,
  );
  return frame === null
    ? null
    : freeze({ port: binding.port, geometryBone: binding.geometryBone, frame, span: binding.span });
};

const buildSocketBindings = (
  context: AssemblyContext,
  state: AssemblyState,
  declaration: AssetComponentDecl,
  ports: readonly TypedPort[],
  portsById: ReadonlyMap<string, TypedPort>,
  socketContracts: Readonly<Record<string, TypedSocketContract>>,
): readonly TypedSocketBinding[] => {
  const socketBindings: TypedSocketBinding[] = [];
  const socketPorts = ports.filter((port) => port.domain === 'socket');
  const socketEndpoints = new Set<string>();
  for (const binding of declaration.socketBindings) {
    const resolved = resolveSocketBinding(
      context,
      state,
      binding,
      portsById,
      socketContracts,
      socketEndpoints,
    );
    if (resolved !== null) socketBindings.push(resolved);
  }
  for (const port of socketPorts) {
    if (!socketEndpoints.has(port.id)) {
      context.issue(
        state.path,
        declaration.span,
        'asset.missing-socket-endpoint',
        `Socket port "${port.id}" requires exactly one geometry endpoint.`,
      );
    }
  }
  return freeze(socketBindings);
};

const validateSocketAuthorities = (
  context: AssemblyContext,
  state: AssemblyState,
  socketBindings: readonly TypedSocketBinding[],
  jointBindings: readonly TypedJointBinding[],
  rigBound: boolean,
  socketAnchored: boolean,
  requiredSocketId: string | undefined,
): void => {
  const anchorBinding =
    requiredSocketId === undefined
      ? null
      : (socketBindings.find((binding) => binding.port === requiredSocketId) ?? null);
  for (const binding of socketBindings) {
    const rigBone = jointBindings.some((joint) => joint.geometryBone === binding.geometryBone);
    const validAuthority = rigBound
      ? rigBone
      : socketAnchored &&
        anchorBinding !== null &&
        binding.geometryBone === anchorBinding.geometryBone;
    if (!validAuthority) {
      context.issue(
        state.path,
        binding.span,
        'asset.socket-placement-authority',
        rigBound
          ? 'Rig-bound socket endpoints must attach to semantic joint-bound geometry bones.'
          : 'Socket-anchored endpoints must share the required socket anchor geometry bone.',
      );
    }
  }
};

const validateMissingBones = (
  context: AssemblyContext,
  state: AssemblyState,
  jointBindings: readonly TypedJointBinding[],
  socketBindings: readonly TypedSocketBinding[],
  geometryBones: ReadonlySet<string>,
): void => {
  for (const binding of jointBindings) {
    if (!geometryBones.has(binding.geometryBone)) {
      context.issue(
        state.path,
        binding.span,
        'asset.missing-geometry-bone',
        `Joint binding names missing geometry bone "${binding.geometryBone}".`,
      );
    }
  }
  for (const binding of socketBindings) {
    if (!geometryBones.has(binding.geometryBone)) {
      context.issue(
        state.path,
        binding.span,
        'asset.missing-geometry-bone',
        `Socket endpoint names missing geometry bone "${binding.geometryBone}".`,
      );
    }
  }
};

const resolvePlacementMode = (
  context: AssemblyContext,
  state: AssemblyState,
  declaration: AssetComponentDecl,
  ports: readonly TypedPort[],
) => {
  const requiredRig = ports.filter(
    (port) => port.domain === 'rig' && port.direction === 'requires',
  );
  const requiredSocket = ports.filter(
    (port) => port.domain === 'socket' && port.direction === 'requires',
  );
  const rigBound = requiredRig.length === 1 && requiredSocket.length === 0;
  const socketAnchored = requiredRig.length === 0 && requiredSocket.length === 1;
  if (!rigBound && !socketAnchored) {
    context.issue(
      state.path,
      declaration.span,
      'asset.component-placement',
      'A component must be either one-rig-bound or one-required-socket-anchored.',
    );
  }
  return { requiredRig, requiredSocket, rigBound, socketAnchored };
};

const compileValidatedGeometry = (
  context: AssemblyContext,
  state: AssemblyState,
  declaration: AssetComponentDecl,
  parameters: TypedComponent['parameters'],
  portsById: ReadonlyMap<string, TypedPort>,
  surfaceContracts: Readonly<Record<string, TypedSurfaceContract>>,
  jointBindings: readonly TypedJointBinding[],
  socketBindings: readonly TypedSocketBinding[],
  boundBones: ReadonlySet<string>,
  anchorBone: string | null,
) => {
  const geometry = compileGeometryPayload(declaration.geometry, {
    path: state.path,
    environment: new Map(Object.entries(parameters)),
    issue: context.issue,
    surfaceChart: (portId: string, chart: string): boolean => {
      const port = portsById.get(portId);
      const contract = port?.domain === 'surface' ? surfaceContracts[port.type.key] : undefined;
      return port?.direction === 'requires' && contract?.charts[chart] !== undefined;
    },
  });
  const geometryBones = validateGeometryHierarchy(geometry.statements, {
    path: state.path,
    boundBones,
    anchorBone,
    issue: context.issue,
    budget: (span) => context.visitTreeNode(state.path, span),
  });
  validateMissingBones(context, state, jointBindings, socketBindings, geometryBones);
  return geometry;
};

const buildComponentBindings = (
  context: AssemblyContext,
  state: AssemblyState,
  declaration: AssetComponentDecl,
  ports: readonly TypedPort[],
  portsById: ReadonlyMap<string, TypedPort>,
  rigs: Readonly<Record<string, TypedRigContract>>,
  socketContracts: Readonly<Record<string, TypedSocketContract>>,
) => {
  const { requiredRig, requiredSocket, rigBound, socketAnchored } = resolvePlacementMode(
    context,
    state,
    declaration,
    ports,
  );
  const { jointBindings, boundBones } = buildJointBindings(
    context,
    state,
    declaration,
    rigBound,
    requiredRig,
    rigs,
  );
  const socketBindings = buildSocketBindings(
    context,
    state,
    declaration,
    ports,
    portsById,
    socketContracts,
  );
  const requiredSocketId = requiredSocket[0]?.id;
  validateSocketAuthorities(
    context,
    state,
    socketBindings,
    jointBindings,
    rigBound,
    socketAnchored,
    requiredSocketId,
  );
  const anchorBone = socketAnchored
    ? (socketBindings.find((binding) => binding.port === requiredSocketId)?.geometryBone ?? null)
    : null;
  return { jointBindings, socketBindings, boundBones, anchorBone };
};

export const buildComponent = (
  context: AssemblyContext,
  state: AssemblyState,
  entry: AssemblyEntry,
  rigs: Readonly<Record<string, TypedRigContract>>,
  socketContracts: Readonly<Record<string, TypedSocketContract>>,
  surfaceContracts: Readonly<Record<string, TypedSurfaceContract>>,
): TypedComponent => {
  const declaration = entry.declaration as AssetComponentDecl;
  const { parameters, parameterDefaults } = buildParameters(context, state, declaration);
  const { ports, portsById } = buildPorts(context, state, declaration);
  const { jointBindings, socketBindings, boundBones, anchorBone } = buildComponentBindings(
    context,
    state,
    declaration,
    ports,
    portsById,
    rigs,
    socketContracts,
  );
  const geometry = compileValidatedGeometry(
    context,
    state,
    declaration,
    parameters,
    portsById,
    surfaceContracts,
    jointBindings,
    socketBindings,
    boundBones,
    anchorBone,
  );
  return freeze({
    symbol: entry.symbol,
    parameters,
    parameterDefaults,
    ports,
    jointBindings,
    socketBindings,
    geometry,
    span: declaration.span,
  });
};
