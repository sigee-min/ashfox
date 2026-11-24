import { freeze } from '../../../immutable';
import type { AssetComponentDecl } from '../../../project/program/asset/contract';
import type {
  AssetSymbolKind,
  TypedComponent,
  TypedJointBinding,
  TypedPort,
  TypedRigContract,
  TypedSocketBinding,
  TypedSocketContract,
  TypedSurfaceContract
} from './contract';
import type { AssemblyContext, AssemblyEntry, AssemblyState } from './assembly';
import { validateGeometryHierarchy } from './assembly';
import { buildTypedFrame } from './hirFrames';
import { compileGeometryPayload } from './hirGeometry';

const record = <T>(): Record<string, T> => Object.create(null) as Record<string, T>;

const portKind = (domain: TypedPort['domain']): AssetSymbolKind =>
  domain === 'rig' ? 'rig-contract' :
    domain === 'surface' ? 'surface-contract' : 'socket-contract';

export const buildComponent = (
  context: AssemblyContext,
  state: AssemblyState,
  entry: AssemblyEntry,
  rigs: Readonly<Record<string, TypedRigContract>>,
  socketContracts: Readonly<Record<string, TypedSocketContract>>,
  surfaceContracts: Readonly<Record<string, TypedSurfaceContract>>
): TypedComponent => {
  const declaration = entry.declaration as AssetComponentDecl;
  const parameters = record<TypedComponent['parameters'][string]>();
  for (const parameter of declaration.parameters) {
    if (parameters[parameter.id] !== undefined) context.issue(state.path, parameter.span,
      'asset.duplicate-parameter', `Component parameter "${parameter.id}" is declared more than once.`);
    parameters[parameter.id] = parameter.type;
  }

  const ports: TypedPort[] = [];
  const portsById = new Map<string, TypedPort>();
  for (const port of declaration.ports) {
    if (portsById.has(port.id)) context.issue(state.path, port.span,
      'asset.duplicate-port', `Component port "${port.id}" is declared more than once.`);
    const target = context.resolve(state, port.type, portKind(port.domain));
    if (target === null) continue;
    const typed = freeze({ direction: port.direction, domain: port.domain,
      id: port.id, type: target.symbol, capacity: port.capacity, span: port.span });
    ports.push(typed);
    portsById.set(port.id, typed);
  }

  const requiredRig = ports.filter((port) => port.domain === 'rig' &&
    port.direction === 'requires');
  const requiredSocket = ports.filter((port) => port.domain === 'socket' &&
    port.direction === 'requires');
  const rigBound = requiredRig.length === 1 && requiredSocket.length === 0;
  const socketAnchored = requiredRig.length === 0 && requiredSocket.length === 1;
  if (!rigBound && !socketAnchored) context.issue(state.path, declaration.span,
    'asset.component-placement',
    'A component must be either one-rig-bound or one-required-socket-anchored.');

  const jointBindings: TypedJointBinding[] = [];
  const boundBones = new Set<string>();
  const boundJoints = new Set<string>();
  const rig = requiredRig.length === 1 ? rigs[requiredRig[0]!.type.key] : undefined;
  for (const binding of declaration.jointBindings) {
    if (!rigBound || rig === undefined) {
      context.issue(state.path, binding.span, 'asset.component-placement',
        'Only a rig-bound component may bind semantic joints.');
      continue;
    }
    const [port, joint, extra] = binding.rigJoint.segments;
    if (extra !== undefined || port !== requiredRig[0]!.id || joint === undefined ||
      rig.joints[joint] === undefined) {
      context.issue(state.path, binding.span, 'asset.invalid-joint-binding',
        'A component joint binding must name its required rig port and a declared semantic joint.');
      continue;
    }
    if (boundBones.has(binding.geometryBone) || boundJoints.has(joint)) context.issue(
      state.path, binding.span, 'asset.duplicate-joint-binding',
      'Geometry bones and semantic joints bind at most once per component.');
    boundBones.add(binding.geometryBone);
    boundJoints.add(joint);
    jointBindings.push(freeze({ geometryBone: binding.geometryBone,
      rigJoint: joint, span: binding.span }));
  }
  if (rigBound && jointBindings.length === 0) context.issue(state.path, declaration.span,
    'asset.component-placement', 'A rig-bound component requires at least one semantic joint binding.');

  const socketBindings: TypedSocketBinding[] = [];
  const socketPorts = ports.filter((port) => port.domain === 'socket');
  const socketEndpoints = new Set<string>();
  for (const binding of declaration.socketBindings) {
    const port = portsById.get(binding.port);
    const contract = port?.domain === 'socket' ? socketContracts[port.type.key] : undefined;
    if (port?.domain !== 'socket' || contract === undefined) {
      context.issue(state.path, binding.span, 'asset.invalid-socket-binding',
        'A component socket binding must name one declared socket port.');
      continue;
    }
    if (socketEndpoints.has(binding.port)) context.issue(state.path, binding.span,
      'asset.duplicate-socket-binding', `Socket port "${binding.port}" is bound more than once.`);
    socketEndpoints.add(binding.port);
    const frame = buildTypedFrame(state.path, binding.frame, null, true,
      binding.span, contract.handedness, context.issue);
    if (frame !== null) socketBindings.push(freeze({ port: binding.port,
      geometryBone: binding.geometryBone, frame, span: binding.span }));
  }
  for (const port of socketPorts) if (!socketEndpoints.has(port.id)) context.issue(
    state.path, declaration.span, 'asset.missing-socket-endpoint',
    `Socket port "${port.id}" requires exactly one geometry endpoint.`);

  const requiredSocketId = requiredSocket[0]?.id;
  const anchorBinding = requiredSocketId === undefined ? null :
    socketBindings.find((binding) => binding.port === requiredSocketId) ?? null;
  for (const binding of socketBindings) {
    const rigBone = jointBindings.some((joint) =>
      joint.geometryBone === binding.geometryBone);
    const validAuthority = rigBound ? rigBone : socketAnchored &&
      anchorBinding !== null && binding.geometryBone === anchorBinding.geometryBone;
    if (!validAuthority) context.issue(state.path, binding.span,
      'asset.socket-placement-authority', rigBound
        ? 'Rig-bound socket endpoints must attach to semantic joint-bound geometry bones.'
        : 'Socket-anchored endpoints must share the required socket anchor geometry bone.');
  }

  const surfaceChart = (portId: string, chart: string): boolean => {
    const port = portsById.get(portId);
    const contract = port?.domain === 'surface' ? surfaceContracts[port.type.key] : undefined;
    return port?.direction === 'requires' && contract?.charts[chart] !== undefined;
  };
  const geometry = compileGeometryPayload(declaration.geometry, {
    path: state.path,
    environment: new Map(Object.entries(parameters)),
    issue: context.issue,
    surfaceChart
  });
  const anchorBone = socketAnchored
    ? socketBindings.find((binding) => binding.port === requiredSocket[0]!.id)?.geometryBone ?? null
    : null;
  const geometryBones = validateGeometryHierarchy(geometry.statements, {
    path: state.path,
    boundBones,
    anchorBone,
    issue: context.issue,
    budget: (span) => context.visitTreeNode(state.path, span)
  });
  for (const binding of jointBindings) if (!geometryBones.has(binding.geometryBone)) context.issue(
    state.path, binding.span, 'asset.missing-geometry-bone',
    `Joint binding names missing geometry bone "${binding.geometryBone}".`);
  for (const binding of socketBindings) if (!geometryBones.has(binding.geometryBone)) context.issue(
    state.path, binding.span, 'asset.missing-geometry-bone',
    `Socket endpoint names missing geometry bone "${binding.geometryBone}".`);

  return freeze({ symbol: entry.symbol, parameters: freeze(parameters),
    ports: freeze(ports), jointBindings: freeze(jointBindings),
    socketBindings: freeze(socketBindings), geometry, span: declaration.span });
};
