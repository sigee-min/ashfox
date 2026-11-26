import type { BlockRotation, CardinalFacing, MirrorAxis } from './contract';

export interface ParsedBlockState {
  readonly name: string;
  readonly properties: Readonly<Record<string, string>>;
}

const VALID_ID = /^[a-z0-9_.-]+:[a-z0-9_./-]+$/u;
const VALID_PROP_KEY = /^[a-z0-9_]+$/u;
const VALID_PROP_VAL = /^[a-z0-9_-]+$/u;

const CLOCKWISE_FACING: readonly CardinalFacing[] = ['north', 'east', 'south', 'west'];

export const isValidMinecraftState = (state: string): boolean => {
  const bracket = state.indexOf('[');
  const name = bracket === -1 ? state : state.slice(0, bracket);
  if (!VALID_ID.test(name)) return false;
  if (bracket === -1) return true;
  if (!state.endsWith(']')) return false;
  const inner = state.slice(bracket + 1, -1).trim();
  if (!inner) return true;
  for (const part of inner.split(',')) {
    const eq = part.indexOf('=');
    if (eq <= 0 || eq === part.length - 1) return false;
    const key = part.slice(0, eq).trim();
    const val = part.slice(eq + 1).trim();
    if (!VALID_PROP_KEY.test(key) || !VALID_PROP_VAL.test(val)) return false;
  }
  return true;
};

export const parseBlockState = (state: string): ParsedBlockState => {
  const bracket = state.indexOf('[');
  if (bracket === -1) return { name: state, properties: {} };
  const name = state.slice(0, bracket);
  const inner = state.slice(bracket + 1, -1).trim();
  const props: Record<string, string> = {};
  if (inner) {
    for (const part of inner.split(',')) {
      const eq = part.indexOf('=');
      if (eq > 0) props[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
    }
  }
  return { name, properties: props };
};

export const formatBlockState = (parsed: ParsedBlockState): string => {
  const keys = Object.keys(parsed.properties).sort();
  if (keys.length === 0) return parsed.name;
  const pairs = keys.map((k) => `${k}=${parsed.properties[k]!}`).join(',');
  return `${parsed.name}[${pairs}]`;
};

const rotateCardinal = (dir: string, quarterTurns: BlockRotation): string => {
  const index = CLOCKWISE_FACING.indexOf(dir as CardinalFacing);
  if (index === -1) return dir;
  const steps = (quarterTurns / 90) % 4;
  return CLOCKWISE_FACING[(index + steps) % 4]!;
};

const mirrorCardinal = (dir: string, axis: MirrorAxis): string => {
  if (axis === 'x') {
    if (dir === 'east') return 'west';
    if (dir === 'west') return 'east';
    return dir;
  }
  if (dir === 'north') return 'south';
  if (dir === 'south') return 'north';
  return dir;
};

const rotateConnections = (props: Record<string, string>, quarterTurns: BlockRotation): void => {
  const hasAny = CLOCKWISE_FACING.some((d) => d in props);
  if (!hasAny) return;
  const snapshot: Partial<Record<CardinalFacing, string>> = {};
  for (const d of CLOCKWISE_FACING) {
    if (d in props) {
      snapshot[d] = props[d]!;
      delete props[d];
    }
  }
  for (const d of CLOCKWISE_FACING) {
    if (snapshot[d] !== undefined) props[rotateCardinal(d, quarterTurns)] = snapshot[d]!;
  }
};

export const rotateBlockState = (state: string, quarterTurns: BlockRotation): string => {
  if (quarterTurns === 0) return formatBlockState(parseBlockState(state));
  const parsed = parseBlockState(state);
  const next: Record<string, string> = { ...parsed.properties };
  if ('facing' in next) next.facing = rotateCardinal(next.facing!, quarterTurns);
  if ('axis' in next && (quarterTurns === 90 || quarterTurns === 270)) {
    if (next.axis === 'x') next.axis = 'z';
    else if (next.axis === 'z') next.axis = 'x';
  }
  rotateConnections(next, quarterTurns);
  return formatBlockState({ name: parsed.name, properties: next });
};

export const mirrorBlockState = (state: string, axis: MirrorAxis): string => {
  const parsed = parseBlockState(state);
  const next: Record<string, string> = { ...parsed.properties };
  if ('facing' in next) next.facing = mirrorCardinal(next.facing!, axis);
  if ('hinge' in next) next.hinge = next.hinge === 'left' ? 'right' : 'left';
  const [first, second] = axis === 'x' ? ['east', 'west'] : ['north', 'south'];
  const firstVal = next[first!];
  const secondVal = next[second!];
  if (firstVal !== undefined || secondVal !== undefined) {
    delete next[first!];
    delete next[second!];
    if (secondVal !== undefined) next[first!] = secondVal;
    if (firstVal !== undefined) next[second!] = firstVal;
  }
  return formatBlockState({ name: parsed.name, properties: next });
};

export const withBlockFacing = (state: string, facing: CardinalFacing): string => {
  const parsed = parseBlockState(state);
  return formatBlockState({ name: parsed.name, properties: { ...parsed.properties, facing } });
};

export const withBlockProperties = (
  state: string,
  patch: Readonly<Record<string, string>>,
): string => {
  const parsed = parseBlockState(state);
  return formatBlockState({ name: parsed.name, properties: { ...parsed.properties, ...patch } });
};
