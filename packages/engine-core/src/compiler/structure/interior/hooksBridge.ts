import type { CompiledAnchor, HookCompiledValue, HooksDocument } from '../../../hooks/contract';
import { emptyHooksDocument } from '../../../hooks/resolve';
import { facingToNormal, facingToYawDegrees } from '../../../hooks/transform';
import type { Vec3 } from '../../../model/identity';
import type { CardinalFacing } from '../../../project/structure/contract';
import type { StructureGrid } from '../contract';
import type { PlayableInteriorHook } from './contract';

const nextUniqueAnchorId = (seen: Set<string>, rawId: string, roomId: string): string => {
  if (!seen.has(rawId)) {
    seen.add(rawId);
    return rawId;
  }
  const scoped = `${roomId}.${rawId}`;
  if (!seen.has(scoped)) {
    seen.add(scoped);
    return scoped;
  }
  let idx = 2;
  while (seen.has(`${scoped}_${idx}`)) idx += 1;
  const deduped = `${scoped}_${idx}`;
  seen.add(deduped);
  return deduped;
};

const schemaAndPropsForHook = (
  hook: PlayableInteriorHook,
): { readonly schema: string; readonly props: Readonly<Record<string, HookCompiledValue>> } => {
  switch (hook.kind) {
    case 'sit':
      return {
        schema: 'std.sit',
        props: {
          pose: 'chair',
          height_offset: hook.seat_height_16 / 16,
          allow_player: true,
          prop_id: hook.prop_id,
        },
      };
    case 'hinge':
    case 'slide':
      return {
        schema: 'std.door_hinge',
        props: {
          side: 'left',
          swing_deg: hook.travel,
          locked: false,
          mode: hook.kind,
          target_id: hook.target_id,
        },
      };
    case 'toggle_light':
      return {
        schema: 'std.toggle_light',
        props: { color: hook.color, default_on: hook.default_on, light_id: hook.light_id },
      };
    case 'station':
      return { schema: 'std.station', props: { station_kind: hook.station_kind } };
    case 'audio_emitter':
      return {
        schema: 'std.sfx',
        props: {
          sound: hook.sound_id,
          cue_kind: hook.cue_kind,
          radius: hook.radius,
          gain_db: hook.gain_db,
          loop: true,
        },
      };
  }
};

const toInteriorAnchor = (
  hook: PlayableInteriorHook,
  roomId: string,
  id: string,
): CompiledAnchor => {
  const facing: CardinalFacing = 'facing' in hook ? hook.facing : 'south';
  const { schema, props } = schemaAndPropsForHook(hook);
  const position: Vec3 = Object.freeze([hook.position[0], hook.position[1], hook.position[2]]);
  const rotation: Vec3 = Object.freeze([0, facingToYawDegrees(facing), 0]);
  return Object.freeze({
    id,
    schema,
    position,
    normal: facingToNormal(facing),
    rotation,
    space: '3d',
    parent: Object.freeze({ kind: 'room', id: roomId }),
    room: roomId,
    props: Object.freeze(props),
  });
};

/** Merges compiled interior interaction and spatial audio anchors into the structure HooksDocument. */
export const mergeInteriorHooks = (
  grid: StructureGrid,
  baseHooks: HooksDocument | undefined,
): HooksDocument | undefined => {
  const interiors = grid.interiors;
  if (!interiors || interiors.length === 0) return baseHooks;
  const doc = baseHooks ?? emptyHooksDocument(grid.id);
  const seen = new Set(doc.anchors.map((a) => a.id));
  const extraAnchors: CompiledAnchor[] = [];
  for (const room of interiors) {
    for (const hook of room.playable_meta.hooks) {
      const id = nextUniqueAnchorId(seen, hook.id, room.room_id);
      extraAnchors.push(toInteriorAnchor(hook, room.room_id, id));
    }
  }
  if (extraAnchors.length === 0) return baseHooks;
  return Object.freeze({
    ...doc,
    anchors: Object.freeze([...doc.anchors, ...extraAnchors]),
  });
};
