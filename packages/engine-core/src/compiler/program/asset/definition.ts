import { freeze } from '../../../immutable';
import type {
  AssetRigContractDecl,
  AssetSkeletonDecl,
  AssetSocketContractDecl,
} from '../../../project/program/asset/contract';
import {
  type TypedRigContract,
  type TypedRigSocket,
  type TypedSkeleton,
  type TypedSocketContract,
} from './contract';
import type { AssemblyContext, AssemblyEntry, AssemblyState } from './assembly';
import { buildTypedFrame } from './hirFrames';

const record = <T>(): Record<string, T> => Object.create(null) as Record<string, T>;

export const buildSocketContract = (
  context: AssemblyContext,
  state: AssemblyState,
  entry: AssemblyEntry,
): TypedSocketContract | null => {
  const declaration = entry.declaration as AssetSocketContractDecl;
  const frame = buildTypedFrame(
    state.path,
    declaration.frame,
    null,
    true,
    declaration.span,
    declaration.handedness,
    context.issue,
  );
  if (frame === null) return null;
  if (frame.origin.some((value) => value.numerator !== 0n)) {
    context.issue(
      state.path,
      declaration.frame?.span ?? declaration.span,
      'asset.socket-contract-origin',
      'Socket contract frames must have an exact zero origin.',
    );
    return null;
  }
  return freeze({
    symbol: entry.symbol,
    handedness: declaration.handedness,
    frame,
    span: declaration.span,
  });
};

const validateJointGraph = (
  context: AssemblyContext,
  state: AssemblyState,
  declaration: AssetRigContractDecl,
  joints: TypedRigContract['joints'],
): void => {
  const roots = Object.values(joints).filter((joint) => joint.parent === null);
  if (roots.length !== 1) {
    context.issue(
      state.path,
      declaration.span,
      'asset.rig-root',
      'A rig contract requires exactly one semantic root joint.',
    );
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): void => {
    if (visiting.has(id)) {
      context.issue(
        state.path,
        joints[id]?.span ?? declaration.span,
        'asset.rig-cycle',
        'Rig joint parents must form an acyclic tree.',
      );
      return;
    }
    if (visited.has(id)) return;
    visiting.add(id);
    const parent = joints[id]?.parent;
    if (parent !== null && parent !== undefined) visit(parent);
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of Object.keys(joints)) visit(id);
};

const buildRigJoint = (
  context: AssemblyContext,
  state: AssemblyState,
  handedness: AssetRigContractDecl['handedness'],
  joint: AssetRigContractDecl['joints'][number],
): TypedRigContract['joints'][string] | null => {
  const localFrame = buildTypedFrame(
    state.path,
    joint.frame,
    null,
    true,
    joint.span,
    handedness,
    context.issue,
  );
  const parent = joint.parent?.segments.length === 1 ? joint.parent.segments[0]! : null;
  if (joint.parent !== null && joint.parent.segments.length !== 1) {
    context.issue(
      state.path,
      joint.parent.span,
      'asset.invalid-joint-parent',
      'Rig joint parents are local semantic joint names.',
    );
  }
  const mirror = joint.mirror?.segments.length === 1 ? joint.mirror.segments[0]! : null;
  if (joint.mirror !== null && joint.mirror.segments.length !== 1) {
    context.issue(
      state.path,
      joint.mirror.span,
      'asset.invalid-joint-mirror',
      'Rig mirror pairs are local semantic joint names.',
    );
  }
  if (new Set(joint.channels).size !== joint.channels.length) {
    context.issue(
      state.path,
      joint.span,
      'asset.duplicate-joint-channel',
      'A rig joint cannot declare the same transform channel twice.',
    );
  }
  return localFrame === null
    ? null
    : freeze({
        id: joint.id,
        parent,
        role: joint.role,
        frame: localFrame,
        channels: freeze([...joint.channels]),
        mirror,
        span: joint.span,
      });
};

const buildRigJoints = (
  context: AssemblyContext,
  state: AssemblyState,
  declaration: AssetRigContractDecl,
): Record<string, TypedRigContract['joints'][string]> => {
  const joints = record<TypedRigContract['joints'][string]>();
  for (const joint of declaration.joints) {
    if (joints[joint.id] !== undefined) {
      context.issue(
        state.path,
        joint.span,
        'asset.duplicate-joint',
        `Rig joint "${joint.id}" is declared more than once.`,
      );
    }
    const typed = buildRigJoint(context, state, declaration.handedness, joint);
    if (typed !== null) joints[joint.id] = typed;
  }
  return joints;
};

const validateRigJointReferences = (
  context: AssemblyContext,
  state: AssemblyState,
  joints: TypedRigContract['joints'],
): void => {
  for (const joint of Object.values(joints)) {
    if (joint.parent !== null && joints[joint.parent] === undefined) {
      context.issue(
        state.path,
        joint.span,
        'asset.missing-joint-parent',
        `Rig joint "${joint.id}" names a missing parent "${joint.parent}".`,
      );
    }
    if (joint.mirror === null) continue;
    const other = joints[joint.mirror];
    if (joint.mirror === joint.id) {
      context.issue(
        state.path,
        joint.span,
        'asset.invalid-joint-mirror',
        `Rig joint "${joint.id}" cannot mirror itself.`,
      );
    } else if (other === undefined || other.mirror !== joint.id) {
      context.issue(
        state.path,
        joint.span,
        'asset.invalid-joint-mirror',
        `Rig joint "${joint.id}" requires a reciprocal mirror pair.`,
      );
    } else if (
      joint.id < other.id &&
      (joint.channels.length !== other.channels.length ||
        joint.channels.some((channel) => !other.channels.includes(channel)))
    ) {
      context.issue(
        state.path,
        joint.span,
        'asset.mirror-channel-mismatch',
        `Mirrored joints "${joint.id}" and "${other.id}" must expose identical channels.`,
      );
    }
  }
};

const buildRigSocket = (
  context: AssemblyContext,
  state: AssemblyState,
  socket: AssetRigContractDecl['sockets'][number],
  joints: TypedRigContract['joints'],
  socketContracts: Readonly<Record<string, TypedSocketContract>>,
): TypedRigSocket | null => {
  const contractEntry = context.resolve(state, socket.contract, 'socket-contract');
  const contract = contractEntry === null ? null : socketContracts[contractEntry.symbol.key];
  if (contractEntry !== null && contract === undefined) {
    context.issue(
      state.path,
      socket.contract.span,
      'asset.internal-reference',
      'Resolved socket contract is missing from the typed HIR index.',
    );
  }
  const joint = socket.joint.segments.length === 1 ? socket.joint.segments[0]! : '';
  if (socket.joint.segments.length !== 1 || joints[joint] === undefined) {
    context.issue(
      state.path,
      socket.joint.span,
      'asset.missing-socket-joint',
      'Rig sockets must bind one local semantic joint.',
    );
  }
  if (contractEntry === null || contract === null || contract === undefined) return null;
  const localFrame = buildTypedFrame(
    state.path,
    socket.frame,
    null,
    true,
    socket.span,
    contract.handedness,
    context.issue,
  );
  if (localFrame === null || joint === '') return null;
  return freeze({
    contract: contractEntry.symbol,
    joint,
    capacity: socket.capacity,
    frame: localFrame,
    span: socket.span,
  });
};

const buildRigSockets = (
  context: AssemblyContext,
  state: AssemblyState,
  declaration: AssetRigContractDecl,
  joints: TypedRigContract['joints'],
  socketContracts: Readonly<Record<string, TypedSocketContract>>,
): Readonly<Record<string, TypedRigSocket>> => {
  const sockets = record<TypedRigSocket>();
  for (const socket of declaration.sockets) {
    if (sockets[socket.id] !== undefined) {
      context.issue(
        state.path,
        socket.span,
        'asset.duplicate-socket',
        `Rig socket "${socket.id}" is declared more than once.`,
      );
    }
    const typed = buildRigSocket(context, state, socket, joints, socketContracts);
    if (typed !== null) sockets[socket.id] = typed;
  }
  return freeze(sockets);
};

export const buildRigContract = (
  context: AssemblyContext,
  state: AssemblyState,
  entry: AssemblyEntry,
  socketContracts: Readonly<Record<string, TypedSocketContract>>,
): TypedRigContract | null => {
  const declaration = entry.declaration as AssetRigContractDecl;
  const frame = buildTypedFrame(
    state.path,
    declaration.frame,
    null,
    true,
    declaration.span,
    declaration.handedness,
    context.issue,
  );
  const joints = buildRigJoints(context, state, declaration);
  validateRigJointReferences(context, state, joints);
  validateJointGraph(context, state, declaration, joints);
  const sockets = buildRigSockets(context, state, declaration, joints, socketContracts);
  return frame === null
    ? null
    : freeze({
        symbol: entry.symbol,
        frame,
        handedness: declaration.handedness,
        joints: freeze(joints),
        sockets,
        span: declaration.span,
      });
};

const addSkeletonBind = (
  context: AssemblyContext,
  state: AssemblyState,
  rig: TypedRigContract,
  binding: AssetSkeletonDecl['binds'][number],
  binds: Record<string, TypedSkeleton['binds'][string]>,
): void => {
  if (binds[binding.joint] !== undefined) {
    context.issue(
      state.path,
      binding.span,
      'asset.duplicate-skeleton-bind',
      `Skeleton joint "${binding.joint}" is bound more than once.`,
    );
  }
  if (rig.joints[binding.joint] === undefined) {
    context.issue(
      state.path,
      binding.span,
      'asset.unknown-skeleton-joint',
      `Skeleton binds a joint outside rig "${binding.joint}".`,
    );
    return;
  }
  const frame = buildTypedFrame(
    state.path,
    binding.frame,
    binding.parentOrigin,
    true,
    binding.span,
    rig.handedness,
    context.issue,
  );
  if (frame !== null) binds[binding.joint] = frame;
};

export const buildSkeleton = (
  context: AssemblyContext,
  state: AssemblyState,
  entry: AssemblyEntry,
  rigs: Readonly<Record<string, TypedRigContract>>,
): TypedSkeleton | null => {
  const declaration = entry.declaration as AssetSkeletonDecl;
  const rigEntry = context.resolve(state, declaration.implements, 'rig-contract');
  const rig = rigEntry === null ? null : rigs[rigEntry.symbol.key];
  if (rigEntry === null) return null;
  if (rig === null || rig === undefined) {
    context.issue(
      state.path,
      declaration.implements.span,
      'asset.internal-reference',
      'Resolved rig contract is missing from the typed HIR index.',
    );
    return null;
  }
  const binds = record<TypedSkeleton['binds'][string]>();
  for (const binding of declaration.binds) addSkeletonBind(context, state, rig, binding, binds);
  for (const joint of Object.keys(rig.joints)) {
    if (binds[joint] === undefined) {
      context.issue(
        state.path,
        declaration.span,
        'asset.missing-skeleton-bind',
        `Skeleton must implement semantic joint "${joint}" exactly once.`,
      );
    }
  }
  return freeze({
    symbol: entry.symbol,
    rig: rig.symbol,
    binds: freeze(binds),
    span: declaration.span,
  });
};
