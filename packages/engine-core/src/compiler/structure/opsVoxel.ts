import type { StructureOp } from '../../project/structure/contract';
import { withBlockFacing } from '../../project/structure/state';
import { defineOpHandler, type StructureOpContext, type StructureOpHandler } from './opContext';
import { applyFrame, emitLayerOp, emitRegionOp, transformBlockState } from './weathering';

type VoxelOpKind = 'set' | 'box' | 'hollow' | 'walls' | 'frame' | 'carve' | 'layer';
type RegionOp = Extract<StructureOp, { op: 'box' | 'hollow' | 'walls' | 'frame' | 'carve' }>;

const handleSetOp = (ctx: StructureOpContext, op: Extract<StructureOp, { op: 'set' }>): void => {
  ctx.state.stats.rawSetCount += 1;
  const pos = applyFrame(ctx.evalVec3(op.at), ctx.frame);
  const res = ctx.resolvePalette(op.block, pos);
  const blockState = op.facing ? withBlockFacing(res.state, op.facing) : res.state;
  ctx.putVoxel(pos, transformBlockState(blockState, ctx.frame), res.assetAlias);
};

const handleLayerOp = (
  ctx: StructureOpContext,
  op: Extract<StructureOp, { op: 'layer' }>,
): void => {
  const [ox, oz] = ctx.evalVec2(op.origin);
  emitLayerOp(
    op,
    ox,
    oz,
    ctx.evalScalar(op.y),
    ctx.frame,
    ctx.ownerPath,
    (k, o, p) => ctx.resolvePalette(k, p, o),
    (p, s, a) => ctx.putVoxel(p, s, a),
    (c, m) => ctx.fail(c, m),
  );
};

const handleRegionOp = (ctx: StructureOpContext, op: RegionOp): void => {
  emitRegionOp(
    op,
    ctx.evalVec3(op.from),
    ctx.evalVec3(op.to),
    ctx.frame,
    ctx.ownerPath,
    (k, o, p) => ctx.resolvePalette(k, p, o),
    (p, s, a) => ctx.putVoxel(p, s, a),
  );
};

export const VOXEL_OP_HANDLERS: Readonly<Record<VoxelOpKind, StructureOpHandler>> = {
  set: defineOpHandler<'set'>(handleSetOp),
  box: defineOpHandler<'box'>(handleRegionOp),
  hollow: defineOpHandler<'hollow'>(handleRegionOp),
  walls: defineOpHandler<'walls'>(handleRegionOp),
  frame: defineOpHandler<'frame'>(handleRegionOp),
  carve: defineOpHandler<'carve'>(handleRegionOp),
  layer: defineOpHandler<'layer'>(handleLayerOp),
};
