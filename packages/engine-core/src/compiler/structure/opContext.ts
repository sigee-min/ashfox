import type {
  ExprVec2,
  ExprVec3,
  IntVec2,
  IntVec3,
  StructureOp,
  StructureScalarExpr,
} from '../../project/structure/contract';
import {
  evaluateExprVec2,
  evaluateExprVec3,
  evaluateScalarInt,
} from '../../project/structure/expr';
import type { EvaluatedStructureResult } from './contract';
import { putUnprotected, putVoxel, resolvePaletteEntry } from './jigsaw';
import { failEval, type EvalState, type FrameTransform } from './weathering';

export interface PaletteResolution {
  readonly state: string;
  readonly assetAlias: string | null;
}

export interface StructureOpContext {
  readonly state: EvalState;
  readonly ownerPath: string;
  readonly frame: FrameTransform;
  readonly depth: number;
  readonly evalScalar: (expr: StructureScalarExpr, targetOwner?: string) => number;
  readonly evalVec2: (vec: ExprVec2, targetOwner?: string) => IntVec2;
  readonly evalVec3: (vec: ExprVec3, targetOwner?: string) => IntVec3;
  readonly resolvePalette: (
    keyOrState: string,
    pos?: IntVec3,
    targetOwner?: string,
  ) => PaletteResolution;
  readonly putVoxel: (
    pos: IntVec3,
    blockState: string,
    assetAlias: string | null,
    protectAir?: boolean,
  ) => void;
  readonly putUnprotected: (pos: IntVec3, blockState: string, assetAlias: string | null) => void;
  readonly fail: (code: string, message: string, targetOwner?: string) => never;
  readonly evalChild: (op: StructureOp, frame?: FrameTransform, targetOwner?: string) => void;
  readonly evalStructure: (rootPath: string) => EvaluatedStructureResult;
}

export type StructureOpHandler = (ctx: StructureOpContext, op: StructureOp) => void;

export const defineOpHandler = <K extends StructureOp['op']>(
  fn: (ctx: StructureOpContext, op: Extract<StructureOp, { op: K }>) => void,
): StructureOpHandler => fn as StructureOpHandler;

const paramsOf = (state: EvalState, ownerPath: string) => state.units.get(ownerPath)?.params ?? {};

export const createOpContext = (
  state: EvalState,
  ownerPath: string,
  frame: FrameTransform,
  depth: number,
  dispatchOp: (ctx: StructureOpContext, op: StructureOp) => void,
  evalStructure: (rootPath: string) => EvaluatedStructureResult,
): StructureOpContext => {
  const ctx: StructureOpContext = {
    state,
    ownerPath,
    frame,
    depth,
    evalScalar: (expr, targetOwner = ownerPath) =>
      evaluateScalarInt(expr, paramsOf(state, targetOwner), targetOwner),
    evalVec2: (vec, targetOwner = ownerPath) =>
      evaluateExprVec2(vec, paramsOf(state, targetOwner), targetOwner),
    evalVec3: (vec, targetOwner = ownerPath) =>
      evaluateExprVec3(vec, paramsOf(state, targetOwner), targetOwner),
    resolvePalette: (keyOrState, pos = [0, 0, 0], targetOwner = ownerPath) =>
      resolvePaletteEntry(state, keyOrState, targetOwner, pos),
    putVoxel: (pos, blockState, assetAlias, protectAir = false) =>
      putVoxel(state, ownerPath, pos, blockState, assetAlias, protectAir),
    putUnprotected: (pos, blockState, assetAlias) =>
      putUnprotected(state, ownerPath, pos, blockState, assetAlias),
    fail: (code, message, targetOwner = ownerPath) => failEval(targetOwner, code, message),
    evalChild: (childOp, nextFrame = frame, nextOwner = ownerPath) => {
      const childCtx = createOpContext(
        state,
        nextOwner,
        nextFrame,
        depth + 1,
        dispatchOp,
        evalStructure,
      );
      dispatchOp(childCtx, childOp);
    },
    evalStructure,
  };
  return Object.freeze(ctx);
};
