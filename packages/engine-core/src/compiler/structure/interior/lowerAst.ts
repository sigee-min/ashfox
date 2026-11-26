import type { InteriorRoomOp, InteriorStoryAst } from '../../../project/structure/interiorDef';
import type { StructureOpeningMeta, StructureRoomMeta } from '../contract';
import {
  parseClosedStyleDna,
  type CeilingStyle,
  type InteriorArchitectureSpec,
  type InteriorOpeningSpan,
  type InteriorPropSpec,
  type InteriorRadiosityConfig,
  type InteriorRoomInput,
  type InteriorSunShaftConfig,
  type InteriorVolumeSpec,
  type StyleDna,
  type TrussStyle,
} from './contract';
import {
  convertPropAst,
  expandDraperyForRoom,
  lowerGroupProps,
  lowerStories,
  lowerVolumeAst,
} from './lowerItems';
import { resolveInteriorArchitecture } from './shell';

export interface LoweredInteriorContext {
  readonly roomInput: InteriorRoomInput;
  readonly radiosityConfig: Partial<InteriorRadiosityConfig>;
  readonly sunShaftConfig: Partial<InteriorSunShaftConfig> & { readonly enabled?: boolean };
  readonly customAssetAliases: readonly string[];
}

const DEFAULT_TRUSS_BY_ARCH: Readonly<Record<StyleDna['arch'], TrussStyle>> = {
  rustic: 'a_frame',
  japanese: 'king_post',
  modern: 'steel_web',
  scifi: 'steel_web',
  gothic: 'king_post',
  desert: 'a_frame',
  industrial: 'steel_web',
  nordic: 'a_frame',
};

const toOpeningSpan = (op: StructureOpeningMeta, idx: number): InteriorOpeningSpan => ({
  id: `${op.room}_${op.wall}_${op.kind}_${idx}`,
  kind: op.kind,
  wall: op.wall,
  from: op.from,
  to: op.to,
  ...(op.hinge ? { hinge: op.hinge } : {}),
  ...(op.stainedGlassColor ? { stained_glass_color: op.stainedGlassColor } : {}),
});

const lowerArchitecture = (dna: StyleDna, op: InteriorRoomOp): InteriorArchitectureSpec => {
  const a = op.architecture;
  const stripColor = op.lighting?.color ?? a?.strip_light_color;
  const lightKind = op.lighting?.kind;
  const molding =
    a?.molding ??
    (lightKind === 'strip_light' || lightKind === 'neon_channel' ? lightKind : undefined);
  return resolveInteriorArchitecture(dna, {
    ...(a?.floor_pattern
      ? { floor_pattern: a.floor_pattern as InteriorArchitectureSpec['floor_pattern'] }
      : {}),
    ...(a?.baseboard ? { baseboard: a.baseboard as InteriorArchitectureSpec['baseboard'] } : {}),
    ...(a?.wainscot ? { wainscot: a.wainscot as InteriorArchitectureSpec['wainscot'] } : {}),
    ...(molding ? { molding: molding as InteriorArchitectureSpec['molding'] } : {}),
    ...(a?.ceiling ? { ceiling: a.ceiling as CeilingStyle } : {}),
    ...(a?.trim_tile ? { trim_tile: a.trim_tile } : {}),
    ...(a?.accent_color ? { accent_color: a.accent_color } : {}),
    ...(stripColor ? { strip_light_color: stripColor } : {}),
  });
};

const extractRadConfig = (op: InteriorRoomOp): Partial<InteriorRadiosityConfig> => {
  const l = op.lighting;
  if (!l) return {};
  return {
    ...(l.bounces ? { bounces: l.bounces } : {}),
    ...(l.ambient_floor !== undefined ? { ambient_floor: l.ambient_floor } : {}),
    ...(l.stained_glass_boost !== undefined ? { stained_glass_boost: l.stained_glass_boost } : {}),
    ...(l.contact_ao_strength !== undefined ? { contact_ao_strength: l.contact_ao_strength } : {}),
  };
};

const extractShaftConfig = (op: InteriorRoomOp) => {
  const s = op.sunShaft;
  if (!s) return {};
  return {
    ...(s.enabled !== undefined ? { enabled: s.enabled } : {}),
    ...(s.sun_dir ? { sun_dir: s.sun_dir } : {}),
    ...(s.intensity !== undefined ? { intensity: s.intensity } : {}),
    ...(s.shaft_length_b !== undefined ? { shaft_length_b: s.shaft_length_b } : {}),
  };
};

/** Lowers an ashfox 1 InteriorRoomOp + evaluated room bounds/openings into InteriorRoomInput. */
export const lowerInteriorAstToInput = (
  op: InteriorRoomOp,
  room: StructureRoomMeta,
  roomOpenings: readonly StructureOpeningMeta[],
  seed: number,
): LoweredInteriorContext => {
  const dna = parseClosedStyleDna(op.dna ?? { arch: 'rustic' });
  const architecture = lowerArchitecture(dna, op);
  const openings = roomOpenings.map(toOpeningSpan);
  const volumes: InteriorVolumeSpec[] = [];
  const props: InteriorPropSpec[] = [];
  const storyAsts: InteriorStoryAst[] = [...op.stories];
  for (const v of op.volumes) lowerVolumeAst(v, room, volumes, props, storyAsts);
  for (const g of op.groups) lowerGroupProps(g, room, volumes, props, storyAsts);
  for (const p of op.props) {
    const conv = convertPropAst(p, room, p.on ?? 'center', room.from[1] + 1);
    if (conv) props.push(conv);
  }
  if (architecture.ceiling === 'open_truss' && !volumes.some((v) => v.kind === 'open_truss')) {
    volumes.push({
      kind: 'open_truss',
      id: `${room.name}_truss`,
      style: DEFAULT_TRUSS_BY_ARCH[dna.arch],
      axis: room.to[0] - room.from[0] >= room.to[2] - room.from[2] ? 'x' : 'z',
    });
  }
  return {
    roomInput: {
      room_id: room.name,
      kind: room.kind,
      style_dna: dna,
      architecture,
      bounds_from: room.from,
      bounds_to: room.to,
      openings,
      volumes,
      props,
      stories: lowerStories(storyAsts, props, room),
      draperies: op.draperies.flatMap((d) => expandDraperyForRoom(d, room, openings)),
      seed,
    },
    radiosityConfig: extractRadConfig(op),
    sunShaftConfig: extractShaftConfig(op),
    customAssetAliases: props.flatMap((p) => (p.asset_alias ? [p.asset_alias] : [])),
  };
};
