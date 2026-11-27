import { freeze } from '../../../immutable';
import type { AssetRigContractDecl, AssetValueType } from '../../../project/program/asset/contract';
import type { ProgramExpr } from '../../../project/program/syntax/contract';
import { nullRecord } from './diagnostics';
import {
  type TypedRigAnchor,
  type TypedRigChain,
  type TypedRigContract,
  type TypedRigIkLimb,
} from './contract';
import type { AssemblyContext, AssemblyState } from './assembly';
import { compileAndEvaluateHirExpression } from './hirValues';

const evalRigVec3 = (
  context: AssemblyContext,
  state: AssemblyState,
  expr: ProgramExpr,
  expectedType: Extract<AssetValueType, 'vec3<unit>' | 'vec3<ratio>'>,
): readonly [number, number, number] | undefined => {
  const val = compileAndEvaluateHirExpression(
    expr,
    expectedType,
    new Map(),
    new Map(),
    state.path,
    context.issue,
  );
  if (val?.kind !== 'vector' || val.values.length !== 3) return undefined;
  return freeze([
    Number(val.values[0]!.value.numerator) / Number(val.values[0]!.value.denominator),
    Number(val.values[1]!.value.numerator) / Number(val.values[1]!.value.denominator),
    Number(val.values[2]!.value.numerator) / Number(val.values[2]!.value.denominator),
  ] as const);
};

const evalRigNum = (
  context: AssemblyContext,
  state: AssemblyState,
  expr: ProgramExpr,
): number | null => {
  const val = compileAndEvaluateHirExpression(
    expr,
    'unit',
    new Map(),
    new Map(),
    state.path,
    context.issue,
  );
  return val?.kind === 'number'
    ? Number(val.value.numerator) / Number(val.value.denominator)
    : null;
};

export const buildRigChains = (
  context: AssemblyContext,
  state: AssemblyState,
  declaration: AssetRigContractDecl,
  joints: TypedRigContract['joints'],
): Readonly<Record<string, TypedRigChain>> => {
  const chains = nullRecord<TypedRigChain>();
  for (const chain of declaration.chains) {
    if (chains[chain.id] !== undefined) {
      context.issue(
        state.path,
        chain.span,
        'asset.duplicate-chain',
        `Rig chain "${chain.id}" is declared more than once.`,
      );
    }
    const ids: string[] = [];
    for (const ref of chain.joints) {
      const id = ref.segments.length === 1 ? ref.segments[0]! : '';
      if (id === '' || joints[id] === undefined) {
        context.issue(
          state.path,
          ref.span,
          'asset.missing-chain-joint',
          `Chain "${chain.id}" references missing joint "${id}".`,
        );
      } else ids.push(id);
    }
    chains[chain.id] = freeze({ id: chain.id, joints: freeze(ids), span: chain.span });
  }
  return freeze(chains);
};

const buildOneIkLimb = (
  context: AssemblyContext,
  state: AssemblyState,
  ik: AssetRigContractDecl['ikLimbs'][number],
  joints: TypedRigContract['joints'],
): TypedRigIkLimb | null => {
  const upper = ik.chain[0].segments[0] ?? '';
  const lower = ik.chain[1].segments[0] ?? '';
  if (joints[upper] === undefined || joints[lower] === undefined) {
    context.issue(
      state.path,
      ik.span,
      'asset.missing-ik-joint',
      `IK limb "${ik.id}" must reference two local joints.`,
    );
    return null;
  }
  const endEffector = ik.endEffector?.segments[0] ?? null;
  if (endEffector !== null && joints[endEffector] === undefined) {
    context.issue(
      state.path,
      ik.endEffector!.span,
      'asset.missing-ik-joint',
      `IK limb "${ik.id}" end_effector "${endEffector}" missing.`,
    );
  }
  return freeze({
    id: ik.id,
    chain: freeze([upper, lower] as const),
    endEffector,
    pole: ik.pole
      ? (evalRigVec3(context, state, ik.pole, 'vec3<ratio>') ?? [0, 0, -1])
      : ([0, 0, -1] as const),
    ground: ik.ground ? evalRigNum(context, state, ik.ground) : null,
    mirror: ik.mirror?.segments[0] ?? null,
    span: ik.span,
  });
};

export const buildRigIkLimbs = (
  context: AssemblyContext,
  state: AssemblyState,
  declaration: AssetRigContractDecl,
  joints: TypedRigContract['joints'],
): Readonly<Record<string, TypedRigIkLimb>> => {
  const limbs = nullRecord<TypedRigIkLimb>();
  for (const ik of declaration.ikLimbs) {
    if (limbs[ik.id] !== undefined) {
      context.issue(
        state.path,
        ik.span,
        'asset.duplicate-ik-limb',
        `Rig ik_limb "${ik.id}" is declared more than once.`,
      );
    }
    const limb = buildOneIkLimb(context, state, ik, joints);
    if (limb) limbs[ik.id] = limb;
  }
  return freeze(limbs);
};

export const buildRigAnchors = (
  context: AssemblyContext,
  state: AssemblyState,
  declaration: AssetRigContractDecl,
  joints: TypedRigContract['joints'],
): Readonly<Record<string, TypedRigAnchor>> => {
  const anchors = nullRecord<TypedRigAnchor>();
  for (const anchor of declaration.anchors) {
    if (anchors[anchor.id] !== undefined) {
      context.issue(
        state.path,
        anchor.span,
        'asset.duplicate-anchor',
        `Rig anchor "${anchor.id}" is declared more than once.`,
      );
    }
    const joint = anchor.joint.segments[0] ?? '';
    if (joints[joint] === undefined) {
      context.issue(
        state.path,
        anchor.joint.span,
        'asset.missing-anchor-joint',
        `Rig anchor "${anchor.id}" references missing joint "${joint}".`,
      );
      continue;
    }
    const offset = anchor.offset
      ? (evalRigVec3(context, state, anchor.offset, 'vec3<unit>') ?? [0, 0, 0])
      : ([0, 0, 0] as const);
    anchors[anchor.id] = freeze({ id: anchor.id, joint, offset, span: anchor.span });
  }
  return freeze(anchors);
};
