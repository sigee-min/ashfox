import type { BlockRotation, CardinalFacing, IntVec3 } from '../../../project/structure/contract';
import { rotateBlockState } from '../../../project/structure/state';
import {
  SUBVOXEL_UNITS_PER_BLOCK,
  type InteriorOpeningSpan,
  type InteriorRadiosityField,
  type PlayableInteriorHook,
  type SubVoxelBoxIR,
} from './contract';
import type { CompiledInteriorRoom, CustomPropMount, TranslucentWindowPane } from './types';

const CLOCKWISE: readonly CardinalFacing[] = ['north', 'east', 'south', 'west'];

const rotateFacing = (facing: CardinalFacing, rotate: BlockRotation): CardinalFacing =>
  CLOCKWISE[(CLOCKWISE.indexOf(facing) + rotate / 90) % 4]!;

const xformPoint = (
  [x, y, z]: IntVec3,
  [cw, _ch, cd]: IntVec3,
  [ox, oy, oz]: IntVec3,
  rotate: BlockRotation,
): IntVec3 => {
  if (rotate === 90) return [ox + (cd - 1 - z), oy + y, oz + x];
  if (rotate === 180) return [ox + (cw - 1 - x), oy + y, oz + (cd - 1 - z)];
  if (rotate === 270) return [ox + z, oy + y, oz + (cw - 1 - x)];
  return [ox + x, oy + y, oz + z];
};

const xformVec3 = (
  [x, y, z]: readonly [number, number, number],
  childSize: IntVec3,
  origin: IntVec3,
  rotate: BlockRotation,
  scale = 1,
): readonly [number, number, number] => {
  const [cw, _ch, cd] = [childSize[0] * scale, childSize[1] * scale, childSize[2] * scale];
  const [ox, oy, oz] = [origin[0] * scale, origin[1] * scale, origin[2] * scale];
  if (rotate === 90) return [ox + cd - z, oy + y, oz + x];
  if (rotate === 180) return [ox + cw - x, oy + y, oz + cd - z];
  if (rotate === 270) return [ox + z, oy + y, oz + cw - x];
  return [ox + x, oy + y, oz + z];
};

const xformBounds = (
  from: IntVec3,
  to: IntVec3,
  childSize: IntVec3,
  origin: IntVec3,
  rotate: BlockRotation,
): readonly [IntVec3, IntVec3] => {
  const a = xformPoint(from, childSize, origin, rotate);
  const b = xformPoint(to, childSize, origin, rotate);
  return [
    [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.min(a[2], b[2])],
    [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.max(a[2], b[2])],
  ];
};

const xformBox16 = (
  box: SubVoxelBoxIR,
  childSize: IntVec3,
  origin: IntVec3,
  rotate: BlockRotation,
): SubVoxelBoxIR => {
  const u = SUBVOXEL_UNITS_PER_BLOCK;
  const a = xformVec3(box.from_16, childSize, origin, rotate, u);
  const b = xformVec3(box.to_16, childSize, origin, rotate, u);
  const pivot = box.pivot_16 ? xformVec3(box.pivot_16, childSize, origin, rotate, u) : undefined;
  return {
    ...box,
    from_16: [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.min(a[2], b[2])],
    to_16: [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.max(a[2], b[2])],
    ...(pivot ? { pivot_16: pivot } : {}),
    ...(box.rotation_y_deg !== undefined
      ? { rotation_y_deg: (box.rotation_y_deg + rotate) % 360 }
      : {}),
  };
};

const xformOpening = (
  op: InteriorOpeningSpan,
  childSize: IntVec3,
  origin: IntVec3,
  rotate: BlockRotation,
): InteriorOpeningSpan => {
  const [from, to] = xformBounds(op.from, op.to, childSize, origin, rotate);
  return { ...op, wall: rotateFacing(op.wall, rotate), from, to };
};

const copyRotatedChannel = (
  src: Uint8Array,
  rw: number,
  rh: number,
  rd: number,
  newRw: number,
  newRd: number,
  rotate: BlockRotation,
): Uint8Array => {
  const dst = new Uint8Array(newRw * rh * newRd);
  for (let y = 0; y < rh; y += 1) {
    for (let z = 0; z < rd; z += 1) {
      for (let x = 0; x < rw; x += 1) {
        const [nx, ny, nz] = xformPoint([x, y, z], [rw, rh, rd], [0, 0, 0], rotate);
        dst[(ny * newRd + nz) * newRw + nx] = src[(y * rd + z) * rw + x]!;
      }
    }
  }
  return dst;
};

const xformRadiosity = (
  rad: InteriorRadiosityField,
  rotate: BlockRotation,
): InteriorRadiosityField => {
  if (rotate === 0) return rad;
  const [rw, rh, rd] = rad.size;
  const newRw = rotate === 180 ? rw : rd;
  const newRd = rotate === 180 ? rd : rw;
  const copy = (ch: Uint8Array) => copyRotatedChannel(ch, rw, rh, rd, newRw, newRd, rotate);
  return {
    ...rad,
    size: [newRw, rh, newRd],
    bounce_r: copy(rad.bounce_r),
    bounce_g: copy(rad.bounce_g),
    bounce_b: copy(rad.bounce_b),
    sun_patch_r: copy(rad.sun_patch_r),
    sun_patch_g: copy(rad.sun_patch_g),
    sun_patch_b: copy(rad.sun_patch_b),
    contact_ao: copy(rad.contact_ao),
  };
};

const xformHook = (
  hook: PlayableInteriorHook,
  alias: string,
  childSize: IntVec3,
  origin: IntVec3,
  rotate: BlockRotation,
): PlayableInteriorHook => {
  const id = `${alias}.${hook.id}`;
  const position = xformVec3(hook.position, childSize, origin, rotate, 1);
  if (hook.kind === 'sit') {
    return {
      ...hook,
      id,
      position,
      facing: rotateFacing(hook.facing, rotate),
      prop_id: `${alias}.${hook.prop_id}`,
    };
  }
  if (hook.kind === 'hinge' || hook.kind === 'slide') {
    return {
      ...hook,
      id,
      position,
      facing: rotateFacing(hook.facing, rotate),
      pivot: xformVec3(hook.pivot, childSize, origin, rotate, 1),
      target_id: `${alias}.${hook.target_id}`,
    };
  }
  if (hook.kind === 'station') {
    return { ...hook, id, position, facing: rotateFacing(hook.facing, rotate) };
  }
  if (hook.kind === 'toggle_light') {
    return { ...hook, id, position, light_id: `${alias}.${hook.light_id}` };
  }
  return { ...hook, id, position };
};

const xformMount = (
  m: CustomPropMount,
  alias: string,
  childSize: IntVec3,
  origin: IntVec3,
  rotate: BlockRotation,
): CustomPropMount => ({
  ...m,
  id: `${alias}.${m.id}`,
  at_16: xformVec3(m.at_16, childSize, origin, rotate, SUBVOXEL_UNITS_PER_BLOCK),
  facing: rotateFacing(m.facing, rotate),
  rotation_y_deg: (m.rotation_y_deg + rotate) % 360,
});

const xformNbtLowering = (
  nbt: CompiledInteriorRoom['nbt_lowering'],
  rotate: BlockRotation,
): CompiledInteriorRoom['nbt_lowering'] => {
  if (rotate === 0) return nbt;
  const [rw, rh, rd] = nbt.size;
  const newSize: IntVec3 = [rotate === 180 ? rw : rd, rh, rotate === 180 ? rd : rw];
  const stateMap = new Map<string, string>();
  const rotateState = (s: string): string => {
    let hit = stateMap.get(s);
    if (!hit) {
      hit = rotateBlockState(s, rotate);
      stateMap.set(s, hit);
    }
    return hit;
  };
  return {
    ...nbt,
    size: newSize,
    palette: nbt.palette.map(rotateState),
    blocks: nbt.blocks.map((cell) => ({
      pos: xformPoint(cell.pos, nbt.size, [0, 0, 0], rotate),
      state: rotateState(cell.state),
    })),
  };
};

const xformShaft = (
  s: CompiledInteriorRoom['sun_shafts'][number],
  alias: string,
  childSize: IntVec3,
  origin: IntVec3,
  rotate: BlockRotation,
): CompiledInteriorRoom['sun_shafts'][number] => ({
  ...s,
  id: `${alias}.${s.id}`,
  corners: [
    xformVec3(s.corners[0], childSize, origin, rotate, 1),
    xformVec3(s.corners[1], childSize, origin, rotate, 1),
    xformVec3(s.corners[2], childSize, origin, rotate, 1),
    xformVec3(s.corners[3], childSize, origin, rotate, 1),
  ],
  floor_patch_center: xformVec3(s.floor_patch_center, childSize, origin, rotate, 1),
});

/** Transforms a child CompiledInteriorRoom into a parent compound grid coordinate frame. */
export const transformChildInterior = (
  room: CompiledInteriorRoom,
  alias: string,
  childSize: IntVec3,
  origin: IntVec3,
  rotate: BlockRotation,
): CompiledInteriorRoom => {
  const room_id = `${alias}.${room.room_id}`;
  const [bounds_from, bounds_to] = xformBounds(
    room.input.bounds_from,
    room.input.bounds_to,
    childSize,
    origin,
    rotate,
  );
  const panes: TranslucentWindowPane[] = room.window_panes.map((p) => ({
    ...p,
    id: `${alias}.${p.id}`,
    box: xformBox16(p.box, childSize, origin, rotate),
  }));
  const xPoint = (c: IntVec3) => xformPoint(c, childSize, origin, rotate);
  return {
    ...room,
    room_id,
    input: {
      ...room.input,
      room_id,
      bounds_from,
      bounds_to,
      openings: room.input.openings.map((o) => xformOpening(o, childSize, origin, rotate)),
    },
    ir: {
      ...room.ir,
      room_id,
      boxes: room.ir.boxes.map((b) => xformBox16(b, childSize, origin, rotate)),
      clear_path_cells: room.ir.clear_path_cells.map(xPoint),
      corbel_blocked_cells: room.ir.corbel_blocked_cells.map(xPoint),
    },
    radiosity: xformRadiosity(room.radiosity, rotate),
    sun_shafts: room.sun_shafts.map((s) => xformShaft(s, alias, childSize, origin, rotate)),
    window_panes: panes,
    nbt_lowering: xformNbtLowering(room.nbt_lowering, rotate),
    playable_meta: {
      ...room.playable_meta,
      room_id,
      clear_path_cells: room.playable_meta.clear_path_cells.map(xPoint),
      hooks: room.playable_meta.hooks.map((h) => xformHook(h, alias, childSize, origin, rotate)),
    },
    custom_mounts: room.custom_mounts.map((m) => xformMount(m, alias, childSize, origin, rotate)),
  };
};
