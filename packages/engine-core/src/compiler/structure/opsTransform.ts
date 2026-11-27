import type { StructureOp } from '../../project/structure/contract';
import { resolveStructurePrefab } from './compound';
import {
  composeRotation,
  runCompoundMerge,
  runWeatherAndSocketOp,
  transformAnchor,
} from './frameOps';
import { runHangItem } from './jigsaw';
import { defineOpHandler, type StructureOpContext, type StructureOpHandler } from './opContext';
import { collectPrefabLocalBounds, computeAnchoredOffset } from './staircase';
import {
  applyFrame,
  composeFrames,
  failEval,
  mirrorFrame,
  stepOffset,
  type FrameTransform,
} from './weathering';

type TransformOpKind =
  'repeat' | 'mirror' | 'place' | 'furnish' | 'anchor' | 'hook_decl' | 'compound_place';

const handleRepeatOp = (
  ctx: StructureOpContext,
  op: Extract<StructureOp, { op: 'repeat' }>,
): void => {
  for (let i = 0; i < op.count; i += 1) {
    const sub = composeFrames(ctx.frame, {
      offset: stepOffset(op.axis, i * op.step),
      rotate: 0,
      mirrorX: false,
    });
    for (const child of op.ops) ctx.evalChild(child, sub);
  }
};

const handleMirrorOp = (
  ctx: StructureOpContext,
  op: Extract<StructureOp, { op: 'mirror' }>,
): void => {
  for (const child of op.ops) ctx.evalChild(child);
  const mirrored = composeFrames(ctx.frame, mirrorFrame(op.axis, op.center));
  for (const child of op.ops) ctx.evalChild(child, mirrored);
};

const handlePlaceOp = (
  ctx: StructureOpContext,
  op: Extract<StructureOp, { op: 'place' }>,
): void => {
  const { state, ownerPath, frame } = ctx;
  state.prefabUses += 1;
  const target = resolveStructurePrefab(
    state.units,
    state.relative,
    ownerPath,
    op.prefab,
    state.usedImports,
    state.usedPrefabs,
    failEval,
  );
  const sub = composeFrames(frame, {
    offset: ctx.evalVec3(op.at),
    rotate: op.rotate,
    mirrorX: false,
  });
  for (const child of target.ops) ctx.evalChild(child, sub, target.targetPath);
};

const handleFurnishOp = (
  ctx: StructureOpContext,
  op: Extract<StructureOp, { op: 'furnish' }>,
): void => {
  const { state, ownerPath, frame } = ctx;
  const room = state.rooms.get(op.room);
  if (!room) return ctx.fail('structure.unknown-room', `Unknown room "${op.room}" in furnish`);
  for (const item of op.items) {
    if (item.kind === 'hang') {
      runHangItem(
        ownerPath,
        room,
        item.block,
        item.at,
        item.drop,
        (p, s, a) => ctx.putVoxel(p, s, a),
        (k, o, p) => ctx.resolvePalette(k, p, o),
      );
      continue;
    }
    state.prefabUses += 1;
    const target = resolveStructurePrefab(
      state.units,
      state.relative,
      ownerPath,
      item.prefab,
      state.usedImports,
      state.usedPrefabs,
      failEval,
    );
    const rot = composeRotation(item.rotate ?? 0, frame);
    const pts = collectPrefabLocalBounds(
      target.ops,
      rot,
      (v) => ctx.evalVec2(v, target.targetPath),
      (v) => ctx.evalVec3(v, target.targetPath),
      (s) => ctx.evalScalar(s, target.targetPath),
    );
    const sub: FrameTransform = {
      offset: computeAnchoredOffset(
        room,
        pts,
        transformAnchor(item.on, frame),
        item.offset ?? [0, 0],
      ),
      rotate: rot,
      mirrorX: frame.mirrorX,
    };
    for (const child of target.ops) ctx.evalChild(child, sub, target.targetPath);
  }
  state.stats.furnishCount += 1;
};

const handleCompoundPlaceOp = (
  ctx: StructureOpContext,
  op: Extract<StructureOp, { op: 'compound_place' }>,
): void => {
  const { state, ownerPath, frame } = ctx;
  const imp = state.units.get(ownerPath)?.imports.find((i) => i.alias === op.alias);
  if (!imp) return ctx.fail('structure.unknown-import', `Unknown import "${op.alias}"`);
  state.usedImports.get(ownerPath)?.add(op.alias);
  const childPath = state.relative(ownerPath, imp.path);
  const childUnit = state.units.get(childPath);
  if (!childUnit || childUnit.kind !== 'structure') {
    return ctx.fail(
      'structure.invalid-compound',
      `compound_place "${op.alias}" must target structure`,
    );
  }
  const child = ctx.evalStructure(childPath);
  const placed = applyFrame(ctx.evalVec3(op.at), frame);
  runCompoundMerge(state, ownerPath, op.alias, childPath, child, placed, op.rotate);
};

const handleSocketOrHookOp = (
  ctx: StructureOpContext,
  op: Extract<StructureOp, { op: 'anchor' | 'hook_decl' }>,
): void => {
  runWeatherAndSocketOp(ctx.state, ctx.ownerPath, op, ctx.frame, (v) => ctx.evalVec3(v));
};

export const TRANSFORM_OP_HANDLERS: Readonly<Record<TransformOpKind, StructureOpHandler>> = {
  repeat: defineOpHandler<'repeat'>(handleRepeatOp),
  mirror: defineOpHandler<'mirror'>(handleMirrorOp),
  place: defineOpHandler<'place'>(handlePlaceOp),
  furnish: defineOpHandler<'furnish'>(handleFurnishOp),
  anchor: defineOpHandler<'anchor'>(handleSocketOrHookOp),
  hook_decl: defineOpHandler<'hook_decl'>(handleSocketOrHookOp),
  compound_place: defineOpHandler<'compound_place'>(handleCompoundPlaceOp),
};
