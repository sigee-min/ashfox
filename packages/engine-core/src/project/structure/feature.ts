import type { AshfoxNamedBlock } from '../program/syntax/blockAst';
import { assertClosedChoice } from '../program/syntax/blockLowering';
import type { SourceSpan } from '../source/contract';
import type {
  CardinalFacing,
  FacadeOpeningSpec,
  OpeningPlacement,
  PorchSpec,
  StructureOp,
  WeatheringRule,
} from './contract';
import {
  asInt,
  asNum,
  asOptStr,
  asStr,
  assertAllowedAttrs,
  failAst,
  pickOptStrs,
  readBlockAssigns,
  splitBlockParts,
  type AttrEntry,
} from './grammar';

const OPENING_KINDS = new Set<string>(['door', 'window', 'arch', 'bay_window', 'arcade']);

const OPENING_KEYS = new Set([
  'at',
  'offset',
  'repeat',
  'margin',
  'symmetric',
  'width',
  'height',
  'y_offset',
  'block',
  'glass',
  'frame',
  'recess',
  'sill',
  'shutter',
  'lintel',
  'stained_glass_color',
  'glass_color',
  'hinge',
]);

const parsePorchBlock = (stmt: AshfoxNamedBlock, file: string): PorchSpec => {
  const props = readBlockAssigns(stmt.block, file);
  assertAllowedAttrs(
    file,
    stmt.span,
    props,
    new Set(['depth', 'floor', 'pillars', 'lamps', 'steps']),
  );
  const depth = props.depth ? asInt(file, stmt.span, props.depth, 'depth') : 2;
  if (depth < 1 || depth > 6) failAst(file, stmt.span, 'porch depth 1..6', String(depth));
  return {
    depth,
    floor: asStr(file, stmt.span, props.floor, 'floor'),
    ...pickOptStrs(file, stmt.span, props, [
      ['pillars', 'pillars'],
      ['lamps', 'lamps'],
      ['steps', 'steps'],
    ]),
  };
};

const readOpeningPlacement = (
  file: string,
  span: SourceSpan,
  attrs: Record<string, AttrEntry>,
): OpeningPlacement => {
  if (attrs.at !== undefined) {
    const at = attrs.at.value === 'center' ? 'center' : asInt(file, span, attrs.at, 'at');
    return {
      mode: 'at',
      at,
      ...(attrs.offset !== undefined ? { offset: asInt(file, span, attrs.offset, 'offset') } : {}),
    };
  }
  if (attrs.repeat !== undefined) {
    const count = asInt(file, span, attrs.repeat, 'repeat');
    const margin = attrs.margin === undefined ? 1 : asInt(file, span, attrs.margin, 'margin');
    if (count < 1 || margin < 0) failAst(file, span, 'repeat >= 1 and margin >= 0', String(count));
    return { mode: 'repeat', count, margin };
  }
  if (attrs.symmetric !== undefined) {
    return { mode: 'symmetric', offset: asInt(file, span, attrs.symmetric, 'symmetric') };
  }
  return failAst(file, span, 'at, repeat, or symmetric placement', 'none');
};

const defaultOpeningSize = (kind: FacadeOpeningSpec['kind']): readonly [number, number] => {
  if (kind === 'bay_window') return [3, 2];
  if (kind === 'arch' || kind === 'arcade') return [2, 3];
  return [1, 2];
};

const validateOpeningSize = (
  kind: FacadeOpeningSpec['kind'],
  width: number,
  height: number,
  file: string,
  span: SourceSpan,
): void => {
  const minHeight = kind === 'door' || kind === 'arcade' ? 2 : 1;
  const minWidth = kind === 'bay_window' ? 3 : 1;
  if (width < minWidth || height < minHeight) {
    failAst(file, span, 'valid opening width/height', `${width}x${height}`);
  }
};

const readSinglePorch = (
  blocks: readonly AshfoxNamedBlock[],
  file: string,
): PorchSpec | undefined => {
  let porch: PorchSpec | undefined;
  for (const sub of blocks) {
    if (sub.blockKind !== 'porch' || porch !== undefined) {
      failAst(file, sub.span, 'single porch block', sub.blockKind);
    }
    porch = parsePorchBlock(sub, file);
  }
  return porch;
};

const parseOpening = (stmt: AshfoxNamedBlock, file: string): FacadeOpeningSpec => {
  const kind = stmt.blockKind as FacadeOpeningSpec['kind'];
  const { attrs, blocks } = splitBlockParts(stmt.block, file);
  assertAllowedAttrs(file, stmt.span, attrs, OPENING_KEYS);
  const porch = readSinglePorch(blocks, file);
  const [defW, defH] = defaultOpeningSize(kind);
  const width = attrs.width ? asInt(file, stmt.span, attrs.width, 'width') : defW;
  const height = attrs.height ? asInt(file, stmt.span, attrs.height, 'height') : defH;
  validateOpeningSize(kind, width, height, file, stmt.span);
  const hingeRaw = asOptStr(file, stmt.span, attrs.hinge, 'hinge');
  const hinge =
    hingeRaw === undefined
      ? undefined
      : assertClosedChoice(
          hingeRaw,
          ['left', 'right'] as const,
          file,
          attrs.hinge?.span ?? stmt.span,
          'hinge = left|right',
          failAst,
        );
  return {
    kind,
    placement: readOpeningPlacement(file, stmt.span, attrs),
    width,
    height,
    ...(attrs.y_offset ? { yOffset: asInt(file, stmt.span, attrs.y_offset, 'y_offset') } : {}),
    ...(attrs.recess ? { recess: asInt(file, stmt.span, attrs.recess, 'recess') } : {}),
    ...pickOptStrs(file, stmt.span, attrs, [
      ['block', 'block'],
      ['glass', 'glass'],
      ['frame', 'frame'],
      ['sill', 'sill'],
      ['shutter', 'shutter'],
      ['lintel', 'lintel'],
      ['glass_color', 'stainedGlassColor'],
      ['stained_glass_color', 'stainedGlassColor'],
    ]),
    ...(hinge !== undefined ? { hinge } : {}),
    ...(porch !== undefined ? { porch } : {}),
  };
};

const parseWallRef = (
  raw: string,
  file: string,
  span: SourceSpan,
): { readonly room: string; readonly wall: CardinalFacing } => {
  const parts = raw.split('.');
  if (parts.length !== 2) failAst(file, span, 'room.wall target', raw);
  const [room, wall] = parts as [string, string];
  return {
    room,
    wall: assertClosedChoice(
      wall,
      ['north', 'south', 'east', 'west'] as const,
      file,
      span,
      'north|south|east|west',
      failAst,
    ),
  };
};

export const parseFacadeOp = (stmt: AshfoxNamedBlock, file: string): StructureOp => {
  const { attrs, blocks } = splitBlockParts(stmt.block, file);
  assertAllowedAttrs(file, stmt.span, attrs, new Set(['on']));
  const targets: { readonly room: string; readonly wall: CardinalFacing }[] = [];
  if (stmt.name && stmt.name.includes('.')) {
    targets.push(parseWallRef(stmt.name, file, stmt.span));
  } else if (attrs.on !== undefined) {
    const rawOn = attrs.on.value;
    const list = Array.isArray(rawOn) ? rawOn : [rawOn];
    for (const item of list) {
      if (typeof item !== 'string') failAst(file, attrs.on.span, 'room.wall', String(item));
      targets.push(parseWallRef(item, file, attrs.on.span));
    }
  }
  if (targets.length === 0) failAst(file, stmt.span, 'facade room.wall or on = [...]', 'missing');
  const openings: FacadeOpeningSpec[] = blocks.map((sub) => {
    assertClosedChoice(
      sub.blockKind,
      OPENING_KINDS,
      file,
      sub.span,
      'door, window, arch, bay_window, or arcade',
      failAst,
    );
    return parseOpening(sub, file);
  });
  return { op: 'facade', targets, openings };
};

const parseSpreadWeatherRule = (
  kind: 'ground_moss' | 'eave_shadow',
  attrs: Record<string, AttrEntry>,
  file: string,
  span: SourceSpan,
): WeatheringRule => {
  const keys =
    kind === 'ground_moss' ? ['height', 'target', 'into', 'rate'] : ['target', 'into', 'rate'];
  assertAllowedAttrs(file, span, attrs, new Set(keys));
  const rate = asNum(file, span, attrs.rate, 'rate');
  if (rate < 0 || rate > 1) failAst(file, span, 'rate 0..1', String(rate));
  const target = asStr(file, span, attrs.target, 'target');
  const into = asStr(file, span, attrs.into, 'into');
  if (kind === 'eave_shadow') return { kind, target, into, rate };
  const height = attrs.height ? asInt(file, span, attrs.height, 'height') : 2;
  if (height < 0 || height > 16) failAst(file, span, 'height 0..16', String(height));
  return { kind, height, target, into, rate };
};

const parseBoundedRate = (
  attrs: Record<string, AttrEntry>,
  file: string,
  span: SourceSpan,
  fallback: number,
): number => {
  const rate = attrs.rate ? asNum(file, span, attrs.rate, 'rate') : fallback;
  if (rate < 0 || rate > 1) failAst(file, span, 'rate 0..1', String(rate));
  return rate;
};

const parseBoundedInt = (
  entry: AttrEntry | undefined,
  name: string,
  min: number,
  max: number,
  fallback: number,
  file: string,
  span: SourceSpan,
): number => {
  const val = entry ? asInt(file, span, entry, name) : fallback;
  if (val < min || val > max) failAst(file, span, `${name} ${min}..${max}`, String(val));
  return val;
};

const parseTargetIntoRule = (
  kind: 'rust_streak' | 'vine_overgrowth',
  attrs: Record<string, AttrEntry>,
  file: string,
  span: SourceSpan,
): WeatheringRule => {
  const lenKey = kind === 'rust_streak' ? 'length' : 'height';
  assertAllowedAttrs(file, span, attrs, new Set(['target', 'into', 'rate', lenKey]));
  const rate = parseBoundedRate(attrs, file, span, kind === 'rust_streak' ? 0.35 : 0.3);
  const opt = pickOptStrs(file, span, attrs, [
    ['target', 'target'],
    ['into', 'into'],
  ]);
  if (kind === 'rust_streak') {
    return {
      kind,
      rate,
      length: parseBoundedInt(attrs.length, 'length', 1, 16, 4, file, span),
      ...opt,
    };
  }
  return {
    kind,
    rate,
    height: parseBoundedInt(attrs.height, 'height', 1, 24, 6, file, span),
    ...opt,
  };
};

const parseGenreWeatherRule = (
  kind: string,
  attrs: Record<string, AttrEntry>,
  file: string,
  span: SourceSpan,
): WeatheringRule | null => {
  if (kind === 'rust_streak' || kind === 'vine_overgrowth') {
    return parseTargetIntoRule(kind, attrs, file, span);
  }
  if (kind === 'wall_breach') {
    assertAllowedAttrs(
      file,
      span,
      attrs,
      new Set(['target', 'rubble', 'rate', 'max_width', 'height']),
    );
    return {
      kind,
      rate: parseBoundedRate(attrs, file, span, 0.25),
      maxWidth: parseBoundedInt(attrs.max_width, 'max_width', 1, 4, 2, file, span),
      height: parseBoundedInt(attrs.height, 'height', 1, 3, 2, file, span),
      ...pickOptStrs(file, span, attrs, [
        ['target', 'target'],
        ['rubble', 'rubble'],
      ]),
    };
  }
  if (kind === 'shattered_glass') {
    assertAllowedAttrs(file, span, attrs, new Set(['target', 'shard', 'rate']));
    return {
      kind,
      rate: parseBoundedRate(attrs, file, span, 0.4),
      ...pickOptStrs(file, span, attrs, [
        ['target', 'target'],
        ['shard', 'shard'],
      ]),
    };
  }
  return null;
};

const parseWeatheringRule = (sub: AshfoxNamedBlock, file: string): WeatheringRule => {
  const attrs = readBlockAssigns(sub.block, file);
  const kind = sub.blockKind;
  if (kind === 'ground_moss' || kind === 'eave_shadow') {
    return parseSpreadWeatherRule(kind, attrs, file, sub.span);
  }
  if (kind === 'corner_quoin') {
    assertAllowedAttrs(file, sub.span, attrs, new Set(['target', 'corners']));
    return {
      kind,
      target: asStr(file, sub.span, attrs.target, 'target'),
      corners: asStr(file, sub.span, attrs.corners, 'corners'),
    };
  }
  if (kind === 'chimney_soot') {
    assertAllowedAttrs(file, sub.span, attrs, new Set(['radius', 'rate']));
    const radius = attrs.radius ? asInt(file, sub.span, attrs.radius, 'radius') : 2;
    const rate = asNum(file, sub.span, attrs.rate, 'rate');
    if (radius < 1 || radius > 8 || rate < 0 || rate > 1) {
      failAst(file, sub.span, 'radius 1..8, rate 0..1', `${radius}/${rate}`);
    }
    return { kind, radius, rate };
  }
  const extra = parseGenreWeatherRule(kind, attrs, file, sub.span);
  if (extra) return extra;
  return failAst(file, sub.span, 'weathering rule', kind);
};

export const parseWeatheringOp = (stmt: AshfoxNamedBlock, file: string): StructureOp => {
  const rules = stmt.block.statements.map((sub) => {
    if (sub.kind !== 'named-block') {
      return failAst(file, sub.span, 'weathering rule block', sub.kind);
    }
    return parseWeatheringRule(sub, file);
  });
  return { op: 'weathering', rules };
};
