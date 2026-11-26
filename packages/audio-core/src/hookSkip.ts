import type { SoundCursor } from './sourceBlock';

export const HOOK_DECL_KEYWORDS = new Set([
  'schema',
  'anchor',
  'volume',
  'cue',
  'meta',
  'zone',
  'mc_block',
]);

interface SkipScanState {
  depth: number;
  prevIdent: string;
  sawDot: boolean;
}

const stepHookChar = (
  cursor: SoundCursor,
  state: SkipScanState,
  hookAliases: Set<string>,
): boolean => {
  const ch = cursor.peek();
  if (ch === '') return true;
  if (ch === '"') {
    cursor.stringLiteral();
    state.prevIdent = '';
    state.sawDot = false;
    return false;
  }
  if (ch === '{') {
    cursor.take('{');
    state.depth += 1;
  } else if (ch === '}') {
    cursor.take('}');
    if (state.depth <= 1) return true;
    state.depth -= 1;
  } else if (ch === ';' && state.depth === 0) {
    cursor.take(';');
    return true;
  } else if (ch === '.') {
    cursor.take('.');
    state.sawDot = Boolean(state.prevIdent);
    return false;
  } else if (/^[a-zA-Z_]/.test(ch)) {
    const ident = cursor.name();
    if (state.sawDot && state.prevIdent) hookAliases.add(state.prevIdent);
    else state.prevIdent = ident;
    state.sawDot = false;
    return false;
  } else {
    cursor.offset += 1;
  }
  state.prevIdent = '';
  state.sawDot = false;
  return false;
};

export const skipHookDeclaration = (cursor: SoundCursor, hookAliases: Set<string>): void => {
  const state: SkipScanState = { depth: 0, prevIdent: '', sawDot: false };
  while (!stepHookChar(cursor, state, hookAliases)) {
    // Advance until balanced hook declaration terminator.
  }
};
