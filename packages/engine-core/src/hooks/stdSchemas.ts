import type { SourcePosition } from '../project/source/contract';
import type {
  HookFieldType,
  HookSchemaDecl,
  HookSchemaField,
  HookSourceSpan,
  HookTargetKind,
} from './contract';

const STD_POS: SourcePosition = Object.freeze({ offset: 0, line: 1, column: 1 });
const STD_SPAN: HookSourceSpan = Object.freeze({
  file: 'std:hooks',
  start: STD_POS,
  end: STD_POS,
});

const field = (
  name: string,
  type: HookFieldType,
  optional: boolean,
  defaultValue?: HookSchemaField['defaultValue'],
): HookSchemaField =>
  Object.freeze({
    name,
    type,
    optional,
    ...(defaultValue !== undefined ? { defaultValue } : {}),
    span: STD_SPAN,
  });

const strVal = (value: string) => Object.freeze({ kind: 'string' as const, value, span: STD_SPAN });
const enumVal = (value: string) => Object.freeze({ kind: 'ref' as const, value, span: STD_SPAN });
const numVal = (value: number) =>
  Object.freeze({ kind: 'number' as const, value, unit: 'plain' as const, span: STD_SPAN });
const boolVal = (value: boolean) => Object.freeze({ kind: 'bool' as const, value, span: STD_SPAN });

const stdSchema = (
  name: string,
  targets: readonly HookTargetKind[],
  fields: readonly HookSchemaField[],
): HookSchemaDecl =>
  Object.freeze({
    id: `std.${name}`,
    namespace: 'std',
    name,
    exported: true,
    inline: false,
    targets: Object.freeze([...targets]),
    fields: Object.freeze([...fields]),
    span: STD_SPAN,
  });

const FACING_TYPE: HookFieldType = Object.freeze({
  kind: 'union',
  values: Object.freeze(['north', 'south', 'east', 'west']),
});

export const STD_ENTRY_SCHEMA = stdSchema(
  'entry',
  ['anchor'],
  [
    field('pool', { kind: 'string' }, true),
    field('target', { kind: 'string' }, true),
    field('facing', FACING_TYPE, true),
    field('width', { kind: 'int', min: 1, max: 16 }, true, numVal(1)),
    field('mc_block', { kind: 'string' }, true),
  ],
);

export const STD_ROAD_SCHEMA = stdSchema(
  'road',
  ['anchor'],
  [
    field('pool', { kind: 'string' }, true),
    field('target', { kind: 'string' }, true),
    field('width', { kind: 'int', min: 1, max: 16 }, true, numVal(3)),
    field('surface', { kind: 'string' }, true, strVal('cobblestone')),
    field('mc_block', { kind: 'string' }, true),
  ],
);

export const STD_WALL_JOIN_SCHEMA = stdSchema(
  'wall_join',
  ['anchor'],
  [
    field('pool', { kind: 'string' }, true),
    field('target', { kind: 'string' }, true),
    field('flush', { kind: 'bool' }, true, boolVal(true)),
    field('mc_block', { kind: 'string' }, true),
  ],
);

export const STD_COURTYARD_SCHEMA = stdSchema(
  'courtyard',
  ['anchor', 'volume'],
  [
    field('pool', { kind: 'string' }, true),
    field(
      'enclosure',
      Object.freeze({ kind: 'union', values: Object.freeze(['open', 'semi_open']) }),
      true,
      enumVal('open'),
    ),
    field('surface', { kind: 'string' }, true, strVal('stone')),
    field('mc_block', { kind: 'string' }, true),
  ],
);

export const STD_SIT_SCHEMA = stdSchema(
  'sit',
  ['anchor'],
  [
    field(
      'pose',
      Object.freeze({
        kind: 'union',
        values: Object.freeze(['chair', 'bench', 'stool', 'throne', 'mount']),
      }),
      true,
      enumVal('chair'),
    ),
    field('height_offset', { kind: 'float', min: -2, max: 4 }, true, numVal(0.5)),
    field('allow_player', { kind: 'bool' }, true, boolVal(true)),
    field('mc_block', { kind: 'string' }, true),
  ],
);

export const STD_DOOR_HINGE_SCHEMA = stdSchema(
  'door_hinge',
  ['anchor'],
  [
    field(
      'side',
      Object.freeze({ kind: 'union', values: Object.freeze(['left', 'right']) }),
      true,
      enumVal('left'),
    ),
    field('swing_deg', { kind: 'float', min: 15, max: 180 }, true, numVal(90)),
    field('connects_a', { kind: 'string' }, true),
    field('connects_b', { kind: 'string' }, true),
    field('locked', { kind: 'bool' }, true, boolVal(false)),
    field('mc_block', { kind: 'string' }, true),
  ],
);

export const STD_HITBOX_SCHEMA = stdSchema(
  'hitbox',
  ['volume'],
  [
    field(
      'role',
      Object.freeze({
        kind: 'union',
        values: Object.freeze(['solid', 'hurtbox', 'hitbox', 'trigger', 'weakpoint']),
      }),
      true,
      enumVal('solid'),
    ),
    field(
      'material',
      Object.freeze({
        kind: 'union',
        values: Object.freeze(['stone', 'wood', 'metal', 'glass', 'foliage', 'flesh', 'generic']),
      }),
      true,
      enumVal('generic'),
    ),
    field('damage_mult', { kind: 'float', min: 0, max: 100 }, true, numVal(1)),
    field('passable', { kind: 'bool' }, true, boolVal(false)),
  ],
);

export const STD_SFX_SCHEMA = stdSchema(
  'sfx',
  ['cue', 'meta'],
  [
    field('sound', { kind: 'string' }, false),
    field('volume', { kind: 'float', min: 0, max: 2 }, true, numVal(1)),
    field('pitch', { kind: 'float', min: 0.25, max: 4 }, true, numVal(1)),
    field('radius', { kind: 'float', min: 0, max: 256 }, true, numVal(16)),
    field('loop', { kind: 'bool' }, true, boolVal(false)),
  ],
);

export const STD_SCHEMAS: readonly HookSchemaDecl[] = Object.freeze([
  STD_ENTRY_SCHEMA,
  STD_ROAD_SCHEMA,
  STD_WALL_JOIN_SCHEMA,
  STD_COURTYARD_SCHEMA,
  STD_SIT_SCHEMA,
  STD_DOOR_HINGE_SCHEMA,
  STD_HITBOX_SCHEMA,
  STD_SFX_SCHEMA,
]);

export const STD_SCHEMA_MAP: ReadonlyMap<string, HookSchemaDecl> = new Map(
  STD_SCHEMAS.map((schema) => [schema.id, schema]),
);

/** Look up a built-in `std.*` schema by canonical id. */
export const getStdSchema = (id: string): HookSchemaDecl | undefined => STD_SCHEMA_MAP.get(id);
