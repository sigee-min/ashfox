import type {
  AssetRigContractDecl,
  AssetSkeletonDecl,
  AssetSocketContractDecl,
  AssetSurfaceContractDecl,
  AssetSurfaceDecl
} from '../../../project/program/asset/contract';
import {
  type AssetValue
} from './value/contract';
import type { AssetValueType } from '../../../project/program/asset/contract';
import {
  type AssetTexelValue,
  type AssetUnloweredTextureSource,
  type TypedChartAbi,
  type TypedRigContract,
  type TypedRigSocket,
  type TypedSkeleton,
  type TypedSocketContract,
  type TypedSurface,
  type TypedSurfaceContract
} from './contract';
import type { AssemblyContext, AssemblyEntry, AssemblyState } from './assembly';
import { buildTypedFrame } from './hirFrames';
import { compileAndEvaluateHirExpression } from './hirValues';
import { validateConcreteSurfaceCharts } from './surface';

const freeze = <T>(value: T): T => Object.freeze(value);
const record = <T>(): Record<string, T> => Object.create(null) as Record<string, T>;

const texel = (
  expression: Parameters<typeof compileAndEvaluateHirExpression>[0] | null,
  path: string,
  owner: Parameters<AssemblyContext['issue']>[1],
  issue: AssemblyContext['issue']
): AssetTexelValue | null => {
  if (expression === null) {
    issue(path, owner, 'asset.missing-size', 'An explicit integral texel size is required.');
    return null;
  }
  const value = compileAndEvaluateHirExpression(expression, 'texel', new Map(),
    new Map(), path, issue);
  if (value?.kind !== 'number' || value.type !== 'texel' ||
      value.value.denominator !== 1n || value.value.numerator <= 0n) {
    issue(path, expression.span, 'asset.invalid-size',
      'Atlas and chart dimensions require positive integral texel values.');
    return null;
  }
  return value as AssetTexelValue;
};

export const buildSocketContract = (
  context: AssemblyContext,
  state: AssemblyState,
  entry: AssemblyEntry
): TypedSocketContract | null => {
  const declaration = entry.declaration as AssetSocketContractDecl;
  const frame = buildTypedFrame(state.path, declaration.frame, null, true,
    declaration.span, declaration.handedness, context.issue);
  if (frame === null) return null;
  if (frame.origin.some((value) => value.numerator !== 0n)) {
    context.issue(state.path, declaration.frame?.span ?? declaration.span,
      'asset.socket-contract-origin',
      'Socket contract frames must have an exact zero origin.');
    return null;
  }
  return freeze({
    symbol: entry.symbol,
    handedness: declaration.handedness,
    frame,
    span: declaration.span
  });
};

const validateJointGraph = (
  context: AssemblyContext,
  state: AssemblyState,
  declaration: AssetRigContractDecl,
  joints: TypedRigContract['joints']
): void => {
  const roots = Object.values(joints).filter((joint) => joint.parent === null);
  if (roots.length !== 1) context.issue(state.path, declaration.span,
    'asset.rig-root', 'A rig contract requires exactly one semantic root joint.');
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): void => {
    if (visiting.has(id)) {
      context.issue(state.path, joints[id]?.span ?? declaration.span,
        'asset.rig-cycle', 'Rig joint parents must form an acyclic tree.');
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

export const buildRigContract = (
  context: AssemblyContext,
  state: AssemblyState,
  entry: AssemblyEntry,
  socketContracts: Readonly<Record<string, TypedSocketContract>>
): TypedRigContract | null => {
  const declaration = entry.declaration as AssetRigContractDecl;
  const frame = buildTypedFrame(state.path, declaration.frame, null, true,
    declaration.span, declaration.handedness, context.issue);
  const joints = record<TypedRigContract['joints'][string]>();
  for (const joint of declaration.joints) {
    if (joints[joint.id] !== undefined) context.issue(state.path, joint.span,
      'asset.duplicate-joint', `Rig joint "${joint.id}" is declared more than once.`);
    const localFrame = buildTypedFrame(state.path, joint.frame, null, true,
      joint.span, declaration.handedness, context.issue);
    const parent = joint.parent?.segments.length === 1 ? joint.parent.segments[0]! : null;
    if (joint.parent !== null && joint.parent.segments.length !== 1) context.issue(
      state.path, joint.parent.span, 'asset.invalid-joint-parent',
      'Rig joint parents are local semantic joint names.');
    const mirror = joint.mirror?.segments.length === 1 ? joint.mirror.segments[0]! : null;
    if (joint.mirror !== null && joint.mirror.segments.length !== 1) context.issue(
      state.path, joint.mirror.span, 'asset.invalid-joint-mirror',
      'Rig mirror pairs are local semantic joint names.');
    if (new Set(joint.channels).size !== joint.channels.length) context.issue(
      state.path, joint.span, 'asset.duplicate-joint-channel',
      'A rig joint cannot declare the same transform channel twice.');
    if (localFrame !== null) joints[joint.id] = freeze({
      id: joint.id, parent, role: joint.role, frame: localFrame,
      channels: freeze([...joint.channels]), mirror, span: joint.span
    });
  }
  for (const joint of Object.values(joints)) {
    if (joint.parent !== null && joints[joint.parent] === undefined) context.issue(
      state.path, joint.span, 'asset.missing-joint-parent',
      `Rig joint "${joint.id}" names a missing parent "${joint.parent}".`);
    if (joint.mirror !== null) {
      const other = joints[joint.mirror];
      if (joint.mirror === joint.id) context.issue(state.path, joint.span,
        'asset.invalid-joint-mirror',
        `Rig joint "${joint.id}" cannot mirror itself.`);
      else if (other === undefined || other.mirror !== joint.id) context.issue(
        state.path, joint.span, 'asset.invalid-joint-mirror',
        `Rig joint "${joint.id}" requires a reciprocal mirror pair.`);
      else if (joint.id < other.id &&
        (joint.channels.length !== other.channels.length ||
          joint.channels.some((channel) => !other.channels.includes(channel)))) {
        context.issue(state.path, joint.span, 'asset.mirror-channel-mismatch',
          `Mirrored joints "${joint.id}" and "${other.id}" must expose identical channels.`);
      }
    }
  }
  validateJointGraph(context, state, declaration, joints);
  const sockets = record<TypedRigSocket>();
  for (const socket of declaration.sockets) {
    if (sockets[socket.id] !== undefined) context.issue(state.path, socket.span,
      'asset.duplicate-socket', `Rig socket "${socket.id}" is declared more than once.`);
    const contractEntry = context.resolve(state, socket.contract, 'socket-contract');
    const contract = contractEntry === null ? null : socketContracts[contractEntry.symbol.key];
    if (contractEntry !== null && contract === undefined) context.issue(state.path,
      socket.contract.span, 'asset.internal-reference',
      'Resolved socket contract is missing from the typed HIR index.');
    const joint = socket.joint.segments.length === 1 ? socket.joint.segments[0]! : '';
    if (socket.joint.segments.length !== 1 || joints[joint] === undefined) context.issue(
      state.path, socket.joint.span, 'asset.missing-socket-joint',
      'Rig sockets must bind one local semantic joint.');
    const localFrame = contract === null || contract === undefined ? null : buildTypedFrame(
      state.path, socket.frame, null, true, socket.span,
      contract.handedness, context.issue);
    if (contractEntry !== null && contract !== undefined && localFrame !== null && joint !== '') {
      sockets[socket.id] = freeze({ contract: contractEntry.symbol, joint,
        capacity: socket.capacity, frame: localFrame, span: socket.span });
    }
  }
  return frame === null ? null : freeze({
    symbol: entry.symbol, frame, handedness: declaration.handedness,
    joints: freeze(joints), sockets: freeze(sockets), span: declaration.span
  });
};

export const buildSkeleton = (
  context: AssemblyContext,
  state: AssemblyState,
  entry: AssemblyEntry,
  rigs: Readonly<Record<string, TypedRigContract>>
): TypedSkeleton | null => {
  const declaration = entry.declaration as AssetSkeletonDecl;
  const rigEntry = context.resolve(state, declaration.implements, 'rig-contract');
  const rig = rigEntry === null ? null : rigs[rigEntry.symbol.key];
  if (rigEntry === null) return null;
  if (rig === null || rig === undefined) {
    context.issue(state.path, declaration.implements.span, 'asset.internal-reference',
      'Resolved rig contract is missing from the typed HIR index.');
    return null;
  }
  const binds = record<TypedSkeleton['binds'][string]>();
  for (const binding of declaration.binds) {
    if (binds[binding.joint] !== undefined) context.issue(state.path, binding.span,
      'asset.duplicate-skeleton-bind', `Skeleton joint "${binding.joint}" is bound more than once.`);
    if (rig.joints[binding.joint] === undefined) {
      context.issue(state.path, binding.span, 'asset.unknown-skeleton-joint',
        `Skeleton binds a joint outside rig "${binding.joint}".`);
      continue;
    }
    const frame = buildTypedFrame(state.path, binding.frame, binding.parentOrigin, true,
      binding.span, rig.handedness, context.issue);
    if (frame !== null) binds[binding.joint] = frame;
  }
  for (const joint of Object.keys(rig.joints)) if (binds[joint] === undefined) context.issue(
    state.path, declaration.span, 'asset.missing-skeleton-bind',
    `Skeleton must implement semantic joint "${joint}" exactly once.`);
  return freeze({ symbol: entry.symbol, rig: rig.symbol,
    binds: freeze(binds), span: declaration.span });
};

export const buildSurfaceContract = (
  context: AssemblyContext,
  state: AssemblyState,
  entry: AssemblyEntry
): TypedSurfaceContract | null => {
  const declaration = entry.declaration as AssetSurfaceContractDecl;
  const width = texel(declaration.atlas?.width ?? null, state.path,
    declaration.atlas?.span ?? declaration.span, context.issue);
  const height = texel(declaration.atlas?.height ?? null, state.path,
    declaration.atlas?.span ?? declaration.span, context.issue);
  if (declaration.atlas === null) context.issue(state.path, declaration.span,
    'asset.missing-atlas', 'Surface contracts require one explicit atlas.');
  if (declaration.material === null) context.issue(state.path, declaration.span,
    'asset.missing-material', 'Surface contracts require an explicit material.');
  const charts = record<TypedChartAbi>();
  for (const chart of declaration.charts) {
    if (charts[chart.id] !== undefined) context.issue(state.path, chart.span,
      'asset.duplicate-chart', `Surface chart "${chart.id}" is declared more than once.`);
    const chartWidth = texel(chart.width, state.path, chart.span, context.issue);
    const chartHeight = texel(chart.height, state.path, chart.span, context.issue);
    if (chart.coverage === null) context.issue(state.path, chart.span,
      'asset.missing-coverage', 'Surface charts require an explicit coverage policy.');
    if (chartWidth !== null && chartHeight !== null && chart.coverage !== null) {
      charts[chart.id] = freeze({ id: chart.id, layout: chart.layout,
        width: chartWidth, height: chartHeight, coverage: chart.coverage, span: chart.span });
    }
  }
  const slots = record<AssetValueType>();
  for (const slot of declaration.slots) {
    if (slots[slot.id] !== undefined) context.issue(state.path, slot.span,
      'asset.duplicate-slot', `Surface slot "${slot.id}" is declared more than once.`);
    slots[slot.id] = slot.type;
  }
  if (width === null || height === null || declaration.material === null) return null;
  return freeze({ symbol: entry.symbol,
    atlas: freeze({ width, height, span: declaration.atlas?.span ?? declaration.span }),
    charts: freeze(charts), material: declaration.material,
    slots: freeze(slots), span: declaration.span });
};

export const buildSurface = (
  context: AssemblyContext,
  state: AssemblyState,
  entry: AssemblyEntry,
  contracts: Readonly<Record<string, TypedSurfaceContract>>
): TypedSurface | null => {
  const declaration = entry.declaration as AssetSurfaceDecl;
  const contractEntry = context.resolve(state, declaration.contract, 'surface-contract');
  const contract = contractEntry === null ? null : contracts[contractEntry.symbol.key];
  if (contractEntry === null) return null;
  if (contract === null || contract === undefined) {
    context.issue(state.path, declaration.contract.span, 'asset.internal-reference',
      'Resolved surface contract is missing from the typed HIR index.');
    return null;
  }
  if (declaration.material === null || declaration.material !== contract.material) context.issue(
    state.path, declaration.span, 'asset.material-mismatch',
    'A concrete surface must explicitly use its contract material.');
  const slots = record<AssetValue>();
  const seen = new Set<string>();
  for (const slot of declaration.slots) {
    if (seen.has(slot.id)) context.issue(state.path, slot.span,
      'asset.duplicate-slot', `Surface slot "${slot.id}" is set more than once.`);
    seen.add(slot.id);
    const type = contract.slots[slot.id];
    if (type === undefined) {
      context.issue(state.path, slot.span, 'asset.unknown-slot',
        `Concrete surface sets undeclared slot "${slot.id}".`);
      continue;
    }
    if (slot.value !== null) {
      const value = compileAndEvaluateHirExpression(slot.value, type, new Map(), new Map(),
        state.path, context.issue);
      if (value !== null) slots[slot.id] = value;
    }
  }
  for (const id of Object.keys(contract.slots)) if (!seen.has(id)) context.issue(
    state.path, declaration.span, 'asset.missing-slot',
    `Concrete surface must set slot "${id}" exactly once.`);
  const textureSource: AssetUnloweredTextureSource | null = declaration.texture === null
    ? null : freeze({ kind: 'unlowered-texture-source', payload: declaration.texture,
      span: declaration.texture.span });
  validateConcreteSurfaceCharts(textureSource, contract, state.path,
    declaration.span, context.issue);
  return freeze({ symbol: entry.symbol, contract: contract.symbol, textureSource,
    material: declaration.material ?? contract.material,
    slots: freeze(slots), span: declaration.span });
};
