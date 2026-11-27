import type { Vec3 } from '../model/identity';
import { docsHint, formatDidYouMean } from '../project/source/suggest';
import type {
  HookAstValue,
  HookEnclosure,
  HookEnclosureKind,
  HookFacing,
  HookParentRef,
  HookPropAssignment,
  HookZoneShape,
} from './contract';
import type { HookToken } from './lex';
import {
  fail,
  peek,
  readAstValue,
  readIdent,
  spanFrom,
  take,
  type ParseState,
} from './parseHelpers';

export interface HookBodyData {
  parent?: HookParentRef;
  atVec?: Vec3;
  fromVec?: Vec3;
  toVec?: Vec3;
  sizeVec?: Vec3;
  normal?: Vec3;
  rotate?: Vec3;
  facing?: HookFacing;
  space: '2d' | '3d';
  mcBlock?: string;
  enclosureKind?: HookEnclosureKind;
  acousticProfile?: string;
  shelterRatio?: number;
  shape?: HookZoneShape;
  clip?: string;
  atNum?: number;
  fromNum?: number;
  toNum?: number;
  frame?: number;
  target?: string;
  readonly props: HookPropAssignment[];
  end: HookToken;
}

const FACING_KINDS = new Set<string>(['north', 'south', 'east', 'west', 'up', 'down']);
const ENCLOSURE_KINDS = new Set<string>(['enclosed', 'semi_open', 'open', 'outdoor']);
const ZONE_SHAPES = new Set<string>(['rect', 'octagon', 'box']);

const toVec3 = (
  val: HookAstValue,
  state: ParseState,
): { readonly vec: Vec3; readonly space: '2d' | '3d' } => {
  if (val.kind === 'vec3') return { vec: val.value, space: '3d' };
  if (val.kind === 'vec2')
    return { vec: Object.freeze([val.value[0], val.value[1], 0]), space: '2d' };
  return fail(state, 'hooks.syntax', 'Expected 2D or 3D vector.', peek(state, -1));
};

const asText = (val: HookAstValue, state: ParseState, label: string): string => {
  if (val.kind === 'string' || val.kind === 'ref') return val.value;
  return fail(state, 'hooks.syntax', `Expected ${label} identifier or string.`, peek(state, -1));
};

const asNumber = (val: HookAstValue, state: ParseState, label: string): number => {
  if (val.kind === 'number') return val.value;
  return fail(state, 'hooks.syntax', `Expected ${label} number.`, peek(state, -1));
};

const FACING_NORMALS: Readonly<Record<string, readonly [number, number, number]>> = {
  north: Object.freeze([0, 0, -1]),
  south: Object.freeze([0, 0, 1]),
  east: Object.freeze([1, 0, 0]),
  west: Object.freeze([-1, 0, 0]),
  up: Object.freeze([0, 1, 0]),
  down: Object.freeze([0, -1, 0]),
};

const toSeconds = (val: Extract<HookAstValue, { kind: 'number' }>): number =>
  val.unit === 'ms' ? val.value / 1000 : val.value;

const BODY_ATTRS: Readonly<
  Record<string, (s: ParseState, b: HookBodyData, v: HookAstValue) => void>
> = {
  facing: (s, b, v) => {
    if (v.kind !== 'ref' || !FACING_KINDS.has(v.value)) {
      const suggestion = v.kind === 'ref' ? formatDidYouMean(v.value, [...FACING_KINDS]) : '';
      fail(s, 'hooks.syntax', `Invalid facing.${suggestion}`, peek(s, -1), docsHint('hooks'));
    } else b.facing = v.value as HookFacing;
  },
  normal: (s, b, v) => {
    if (v.kind === 'ref' && FACING_NORMALS[v.value]) {
      b.normal = FACING_NORMALS[v.value];
      if (!b.facing) b.facing = v.value as HookFacing;
      return;
    }
    b.normal = toVec3(v, s).vec;
  },
  rotate: (s, b, v) => {
    b.rotate = v.kind === 'vec3' ? v.value : Object.freeze([0, asNumber(v, s, 'rotate'), 0]);
  },
  mc_block: (s, b, v) => {
    if (v.kind !== 'string') fail(s, 'hooks.syntax', 'Expected mc_block string literal.');
    else b.mcBlock = v.value;
  },
  enclosure: (s, b, v) => {
    const text = asText(v, s, 'enclosure');
    if (!ENCLOSURE_KINDS.has(text)) {
      fail(
        s,
        'hooks.syntax',
        `Invalid enclosure kind.${formatDidYouMean(text, [...ENCLOSURE_KINDS])}`,
        peek(s, -1),
        docsHint('hooks'),
      );
    }
    b.enclosureKind = text as HookEnclosureKind;
  },
  acoustic: (s, b, v) => {
    b.acousticProfile = asText(v, s, 'acoustic');
  },
  shelter: (s, b, v) => {
    b.shelterRatio = asNumber(v, s, 'shelter');
  },
  shape: (s, b, v) => {
    if (v.kind !== 'ref' || !ZONE_SHAPES.has(v.value)) {
      const suggestion = v.kind === 'ref' ? formatDidYouMean(v.value, [...ZONE_SHAPES]) : '';
      fail(s, 'hooks.syntax', `Invalid shape.${suggestion}`, peek(s, -1), docsHint('hooks'));
    } else b.shape = v.value as HookZoneShape;
  },
  clip: (s, b, v) => {
    b.clip = asText(v, s, 'clip');
  },
  target: (s, b, v) => {
    b.target = asText(v, s, 'target');
  },
  frame: (s, b, v) => {
    b.frame = asNumber(v, s, 'frame');
  },
  size: (s, b, v) => {
    const vec = toVec3(v, s);
    b.sizeVec = vec.vec;
    b.space = vec.space;
  },
  from: (s, b, v) => {
    if (v.kind === 'number') b.fromNum = toSeconds(v);
    else {
      const vec = toVec3(v, s);
      b.fromVec = vec.vec;
      b.space = vec.space;
    }
  },
  to: (s, b, v) => {
    if (v.kind === 'number') b.toNum = toSeconds(v);
    else {
      const vec = toVec3(v, s);
      b.toVec = vec.vec;
      b.space = vec.space;
    }
  },
};

const readAtAttr = (state: ParseState, body: HookBodyData, val: HookAstValue): void => {
  if (val.kind !== 'number') {
    const vec = toVec3(val, state);
    body.atVec = vec.vec;
    body.space = vec.space;
    return;
  }
  const first = toSeconds(val);
  if (peek(state).value !== '..') {
    body.atNum = first;
    return;
  }
  take(state, '..');
  const endVal = readAstValue(state);
  if (endVal.kind !== 'number') fail(state, 'hooks.syntax', 'Expected upper bound after "..".');
  else {
    body.fromNum = first;
    body.toNum = toSeconds(endVal);
  }
};

export const readHookBody = (
  state: ParseState,
  declKind: 'anchor' | 'volume' | 'cue' | 'meta' | 'zone' | 'mc_block' = 'anchor',
): HookBodyData => {
  const defaultParent = state.parentStack.at(-1);
  const body: HookBodyData = {
    ...(defaultParent ? { parent: defaultParent } : {}),
    space: '3d',
    props: [],
    end: peek(state, -1),
  };
  if (peek(state).value === ';') {
    body.end = take(state, ';');
    return body;
  }
  take(state, '{');
  while (peek(state).value !== '}' && peek(state).kind !== 'eof') {
    const keyTok = readIdent(state, 'property name');
    take(state, '=');
    const val = readAstValue(state);
    if (keyTok.value === 'at') readAtAttr(state, body, val);
    else if (
      keyTok.value === 'bone' ||
      keyTok.value === 'room' ||
      keyTok.value === 'floor' ||
      keyTok.value === 'surface' ||
      keyTok.value === 'compound'
    ) {
      body.parent = Object.freeze({ kind: keyTok.value, id: asText(val, state, keyTok.value) });
    } else if (keyTok.value === 'target' && declKind !== 'meta') {
      const semi = peek(state);
      body.props.push(
        Object.freeze({ name: keyTok.value, value: val, span: spanFrom(keyTok, semi) }),
      );
    } else if (BODY_ATTRS[keyTok.value]) {
      BODY_ATTRS[keyTok.value]!(state, body, val);
    } else {
      const semi = peek(state);
      body.props.push(
        Object.freeze({ name: keyTok.value, value: val, span: spanFrom(keyTok, semi) }),
      );
    }
    take(state, ';');
  }
  body.end = take(state, '}');
  if (body.fromVec && body.sizeVec && !body.toVec) {
    body.toVec = Object.freeze([
      body.fromVec[0] + body.sizeVec[0],
      body.fromVec[1] + body.sizeVec[1],
      body.fromVec[2] + body.sizeVec[2],
    ]);
  }
  return body;
};

export const buildEnclosure = (body: HookBodyData): HookEnclosure | undefined => {
  if (!body.enclosureKind) return undefined;
  return Object.freeze({
    kind: body.enclosureKind,
    enclosed: body.enclosureKind === 'enclosed',
    ...(body.acousticProfile ? { acousticProfile: body.acousticProfile } : {}),
    ...(body.shelterRatio !== undefined ? { shelterRatio: body.shelterRatio } : {}),
  });
};
