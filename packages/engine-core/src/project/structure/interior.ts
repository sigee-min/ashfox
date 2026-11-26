import type { AshfoxNamedBlock, AshfoxStatement } from '../program/syntax/blockAst';
import type { SourceSpan } from '../source/contract';
import {
  asInt,
  asNum,
  asStr,
  assertAllowedAttrs,
  failAst,
  pickOptStrs,
  readAssignEntry,
  readBlockAssigns,
} from './grammar';
import type {
  InteriorArchAst,
  InteriorArchKind,
  InteriorDnaAst,
  InteriorDraperyAst,
  InteriorGroupAst,
  InteriorLightingAst,
  InteriorMoodKind,
  InteriorPropAst,
  InteriorRoomOp,
  InteriorStoryAst,
  InteriorSunShaftAst,
  InteriorVolumeAst,
} from './interiorDef';
import {
  parseAlcove,
  parseDrapery,
  parseGroupBlock,
  parseMezzanine,
  parseOpenTruss,
  parsePartition,
  parsePlatformOrSunken,
  parseStory,
} from './interiorItems';
import { ARCHES, MOODS, PROP_KINDS, asBool, asNumVec3, parsePropFromParts } from './interiorProps';

interface InteriorDraft {
  readonly file: string;
  readonly seq: { count: number };
  room?: string;
  dna?: InteriorDnaAst;
  architecture?: InteriorArchAst;
  readonly volumes: InteriorVolumeAst[];
  readonly groups: InteriorGroupAst[];
  readonly props: InteriorPropAst[];
  readonly draperies: InteriorDraperyAst[];
  readonly stories: InteriorStoryAst[];
  lighting?: InteriorLightingAst;
  sunShaft?: InteriorSunShaftAst;
}

const readOptEnum = (
  v: unknown,
  allowed: ReadonlySet<string>,
  file: string,
  span: SourceSpan,
  label: string,
) => {
  if (v === undefined) return undefined;
  if (typeof v === 'string' && allowed.has(v)) return v;
  return failAst(file, span, label, String(v));
};

const parseDnaRecord = (
  raw: Record<string, unknown>,
  file: string,
  span: SourceSpan,
): InteriorDnaAst => {
  for (const key of Object.keys(raw)) {
    if (key !== 'arch' && key !== 'furn' && key !== 'mood' && key !== 'organic') {
      failAst(file, span, 'dna attribute', key);
    }
  }
  const arch = readOptEnum(raw.arch, ARCHES, file, span, 'dna.arch') as
    InteriorArchKind | undefined;
  if (!arch) failAst(file, span, 'dna.arch', String(raw.arch));
  const furn = readOptEnum(raw.furn, ARCHES, file, span, 'dna.furn') as
    InteriorArchKind | undefined;
  const mood = readOptEnum(raw.mood, MOODS, file, span, 'dna.mood') as InteriorMoodKind | undefined;
  const oRaw = raw.organic;
  const organic =
    oRaw === undefined
      ? undefined
      : typeof oRaw === 'number' && oRaw >= 0 && oRaw <= 1
        ? oRaw
        : failAst(file, span, 'dna.organic in 0..1', String(oRaw));
  return {
    arch: arch!,
    ...(furn ? { furn } : {}),
    ...(mood ? { mood } : {}),
    ...(organic !== undefined ? { organic } : {}),
  };
};

const parseDnaBlock = (stmt: AshfoxNamedBlock, file: string): InteriorDnaAst => {
  const raw: Record<string, unknown> = {};
  for (const [k, entry] of Object.entries(readBlockAssigns(stmt.block, file))) raw[k] = entry.value;
  return parseDnaRecord(raw, file, stmt.span);
};

const parseArchBlock = (stmt: AshfoxNamedBlock, file: string): InteriorArchAst => {
  const attrs = readBlockAssigns(stmt.block, file);
  const keys = [
    'floor_pattern',
    'baseboard',
    'wainscot',
    'molding',
    'ceiling',
    'trim_tile',
    'accent_color',
    'strip_light_color',
  ];
  assertAllowedAttrs(file, stmt.span, attrs, new Set(keys));
  return pickOptStrs(
    file,
    stmt.span,
    attrs,
    keys.map((k) => [k, k]),
  );
};

const parseLighting = (stmt: AshfoxNamedBlock, file: string): InteriorLightingAst => {
  const attrs = readBlockAssigns(stmt.block, file);
  assertAllowedAttrs(
    file,
    stmt.span,
    attrs,
    new Set([
      'kind',
      'along',
      'color',
      'bounces',
      'ambient_floor',
      'stained_glass_boost',
      'contact_ao_strength',
    ]),
  );
  const bounces = attrs.bounces ? asInt(file, stmt.span, attrs.bounces, 'bounces') : undefined;
  if (bounces !== undefined && bounces !== 1 && bounces !== 2)
    failAst(file, stmt.span, 'bounces = 1|2', String(bounces));
  return {
    ...pickOptStrs(file, stmt.span, attrs, [
      ['kind', 'kind'],
      ['along', 'along'],
      ['color', 'color'],
    ]),
    ...(bounces !== undefined ? { bounces: bounces as 1 | 2 } : {}),
    ...(attrs.ambient_floor
      ? { ambient_floor: asNum(file, stmt.span, attrs.ambient_floor, 'ambient_floor') }
      : {}),
    ...(attrs.stained_glass_boost
      ? {
          stained_glass_boost: asNum(
            file,
            stmt.span,
            attrs.stained_glass_boost,
            'stained_glass_boost',
          ),
        }
      : {}),
    ...(attrs.contact_ao_strength
      ? {
          contact_ao_strength: asNum(
            file,
            stmt.span,
            attrs.contact_ao_strength,
            'contact_ao_strength',
          ),
        }
      : {}),
  };
};

const parseSunShaft = (stmt: AshfoxNamedBlock, file: string): InteriorSunShaftAst => {
  const attrs = readBlockAssigns(stmt.block, file);
  assertAllowedAttrs(
    file,
    stmt.span,
    attrs,
    new Set(['enabled', 'sun_dir', 'intensity', 'shaft_length']),
  );
  return {
    ...(attrs.enabled ? { enabled: asBool(file, stmt.span, attrs.enabled, 'enabled') } : {}),
    ...(attrs.sun_dir ? { sun_dir: asNumVec3(file, stmt.span, attrs.sun_dir, 'sun_dir') } : {}),
    ...(attrs.intensity ? { intensity: asNum(file, stmt.span, attrs.intensity, 'intensity') } : {}),
    ...(attrs.shaft_length
      ? { shaft_length_b: asNum(file, stmt.span, attrs.shaft_length, 'shaft_length') }
      : {}),
  };
};

const BLOCK_DISPATCH: Readonly<Record<string, (stmt: AshfoxNamedBlock, d: InteriorDraft) => void>> =
  {
    dna: (s, d) => {
      d.dna = parseDnaBlock(s, d.file);
    },
    architecture: (s, d) => {
      d.architecture = parseArchBlock(s, d.file);
    },
    platform: (s, d) => d.volumes.push(parsePlatformOrSunken(s, d.file, d.seq)),
    sunken: (s, d) => d.volumes.push(parsePlatformOrSunken(s, d.file, d.seq)),
    mezzanine: (s, d) => d.volumes.push(parseMezzanine(s, d.file, d.seq)),
    open_truss: (s, d) => d.volumes.push(parseOpenTruss(s, d.file, d.seq)),
    alcove: (s, d) => d.volumes.push(parseAlcove(s, d.file, d.seq)),
    partition: (s, d) => d.volumes.push(parsePartition(s, d.file, d.seq)),
    wall_line: (s, d) => d.groups.push(parseGroupBlock(s, d.file, d.seq)),
    centerpiece: (s, d) => d.groups.push(parseGroupBlock(s, d.file, d.seq)),
    corner: (s, d) => d.groups.push(parseGroupBlock(s, d.file, d.seq)),
    drapery: (s, d) => d.draperies.push(parseDrapery(s, d.file, d.seq)),
    story: (s, d) => d.stories.push(parseStory(s, d.file, d.seq)),
    lighting: (s, d) => {
      d.lighting = parseLighting(s, d.file);
    },
    sun_shaft: (s, d) => {
      d.sunShaft = parseSunShaft(s, d.file);
    },
  };

const consumeInteriorBlock = (stmt: AshfoxNamedBlock, d: InteriorDraft): void => {
  const fn = BLOCK_DISPATCH[stmt.blockKind];
  if (fn) return fn(stmt, d);
  if (stmt.blockKind === 'prop' || PROP_KINDS.has(stmt.blockKind)) {
    d.props.push(
      parsePropFromParts(
        stmt.blockKind,
        stmt.name,
        readBlockAssigns(stmt.block, d.file),
        d.file,
        stmt.span,
        d.seq,
      ),
    );
    return;
  }
  failAst(d.file, stmt.span, 'interior directive', stmt.blockKind);
};

const consumeInteriorStmt = (stmt: AshfoxStatement, d: InteriorDraft): void => {
  if (stmt.kind === 'assign') {
    if (stmt.path === 'room') {
      d.room = asStr(d.file, stmt.span, readAssignEntry(stmt, d.file), 'room');
      return;
    }
    if (stmt.path === 'dna') {
      const val = readAssignEntry(stmt, d.file).value;
      if (!val || typeof val !== 'object' || Array.isArray(val))
        failAst(d.file, stmt.span, 'dna = { arch = ...; }', String(val));
      d.dna = parseDnaRecord(val as Record<string, unknown>, d.file, stmt.span);
      return;
    }
    failAst(d.file, stmt.span, 'room or dna assignment', stmt.path);
  }
  if (stmt.kind === 'named-block') return consumeInteriorBlock(stmt, d);
  failAst(d.file, stmt.span, 'interior block', stmt.kind);
};

/** Parses an ashfox 1 interior block into closed AST data. */
export const parseInteriorOp = (
  stmt: AshfoxNamedBlock,
  file: string,
  defaultRoom?: string,
): InteriorRoomOp => {
  const draft: InteriorDraft = {
    file,
    seq: { count: 0 },
    room: stmt.name ?? defaultRoom,
    volumes: [],
    groups: [],
    props: [],
    draperies: [],
    stories: [],
  };
  for (const child of stmt.block.statements) consumeInteriorStmt(child, draft);
  return {
    op: 'interior',
    ...(draft.room ? { room: draft.room } : {}),
    ...(draft.dna ? { dna: draft.dna } : {}),
    ...(draft.architecture ? { architecture: draft.architecture } : {}),
    volumes: draft.volumes,
    groups: draft.groups,
    props: draft.props,
    draperies: draft.draperies,
    stories: draft.stories,
    ...(draft.lighting ? { lighting: draft.lighting } : {}),
    ...(draft.sunShaft ? { sunShaft: draft.sunShaft } : {}),
  };
};
