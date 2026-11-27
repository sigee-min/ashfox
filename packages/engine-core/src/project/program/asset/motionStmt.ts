import type { SourceSpan } from '../../source/contract';
import type { ProgramExpr } from '../syntax/contract';
import type {
  AssetCombatOpDecl,
  AssetCueDecl,
  AssetCurveName,
  AssetExpressionEntryDecl,
  AssetExpressionSlotTrackDecl,
  AssetMotionChannel,
  AssetMotionIkDecl,
  AssetPropertyDecl,
  AssetSecondaryDecl,
} from './contract';
import { isOneOf, join, readBraced, readProperty, type AssetReader } from './parserSupport';

export const CURVE_NAMES: readonly AssetCurveName[] = [
  'linear',
  'step',
  'catmullrom',
  'smooth',
  'ease_in',
  'ease_out',
  'ease_in_out',
  'cubic',
  'snap',
  'anticipate',
  'overshoot',
  'bounce',
  'elastic',
];

export const readChannelName = (reader: AssetReader, scope: string): AssetMotionChannel => {
  const token = reader.id(`Expected a ${scope} channel.`);
  if (isOneOf(['position', 'rotation', 'scale'] as const, token.value)) return token.value;
  reader.fail(
    'asset.invalid-motion-property',
    `Unsupported motion channel "${token.value}". Expected position, rotation, or scale.`,
    token,
  );
  return 'rotation';
};

export const readTargetPath = (reader: AssetReader, message: string): string => {
  const parts = [reader.id(message).value];
  while (reader.match('/')) parts.push(reader.id('Expected a target path segment.').value);
  return parts.join('/');
};

export const readMotionIk = (reader: AssetReader): AssetMotionIkDecl => {
  const start = reader.expectWord('ik', 'Expected ik.');
  const limb = reader.id('Expected ik limb name.');
  const footLocks: (readonly [ProgramExpr, ProgramExpr])[] = [];
  const close = readBraced(
    reader,
    'Expected { to begin ik block.',
    'Expected } to close ik block.',
    () => {
      const prop = reader.id('Expected foot_lock or contact in ik block.');
      if (prop.value !== 'foot_lock' && prop.value !== 'contact') {
        reader.fail('asset.invalid-property', `Unknown ik property "${prop.value}".`, prop);
      }
      reader.expect('=', 'Expected = in foot_lock.');
      const startExpr = reader.expression();
      const endExpr = reader.match('..') ? reader.expression() : startExpr;
      reader.finish();
      footLocks.push(Object.freeze([startExpr, endExpr] as const));
    },
  );
  return Object.freeze({
    kind: 'motion-ik',
    limb: limb.value,
    footLocks: Object.freeze(footLocks),
    span: join(start.span, close.span),
  });
};

export const readSecondary = (reader: AssetReader): AssetSecondaryDecl => {
  const start = reader.expectWord('secondary', 'Expected secondary.');
  const kindToken = reader.id('Expected chain or joint.');
  const targetKind: 'chain' | 'joint' = kindToken.value === 'joint' ? 'joint' : 'chain';
  if (kindToken.value !== 'chain' && kindToken.value !== 'joint') {
    reader.fail(
      'asset.invalid-property',
      'Expected secondary chain or secondary joint.',
      kindToken,
    );
  }
  const targetId = reader.id('Expected chain or joint identifier.');
  const properties: AssetPropertyDecl[] = [];
  const close = readBraced(
    reader,
    'Expected { to begin secondary motion.',
    'Expected } to close secondary motion.',
    () => {
      if (reader.assignment()) properties.push(readProperty(reader));
      else reader.scopeError('secondary motion');
    },
  );
  return Object.freeze({
    kind: 'secondary',
    targetKind,
    targetId: targetId.value,
    properties: Object.freeze(properties),
    span: join(start.span, close.span),
  });
};

const readCombatEntry = (
  reader: AssetReader,
  key: string,
  keySpan: SourceSpan,
  properties: AssetPropertyDecl[],
): readonly [ProgramExpr, ProgramExpr] | null => {
  const val = reader.expression();
  if (reader.match('..')) {
    const endVal = reader.expression();
    if (key === 'at' || key === 'range') return Object.freeze([val, endVal] as const);
    reader.failSpan('asset.invalid-property', `Range not allowed for "${key}".`, keySpan);
    return null;
  }
  properties.push(
    Object.freeze({ kind: 'property', name: key, value: val, span: join(keySpan, val.span) }),
  );
  return null;
};

const readCombatParenArgs = (
  reader: AssetReader,
  properties: AssetPropertyDecl[],
  onRange: (range: readonly [ProgramExpr, ProgramExpr]) => void,
): SourceSpan => {
  if (!reader.check(')')) {
    do {
      const key = reader.id('Expected parameter name.');
      reader.expect('=', 'Expected =.');
      const range = readCombatEntry(reader, key.value, key.span, properties);
      if (range) onRange(range);
    } while (reader.match(','));
  }
  const endSpan = reader.expect(')', 'Expected ).').span;
  reader.finish();
  return endSpan;
};

export const readCombatOp = (
  reader: AssetReader,
  kind: AssetCombatOpDecl['kind'],
): AssetCombatOpDecl => {
  const start = reader.expectWord(kind, `Expected ${kind}.`);
  const target =
    !reader.check('{') && !reader.check('(') ? readTargetPath(reader, 'Expected target.') : null;
  const properties: AssetPropertyDecl[] = [];
  let timeRange: readonly [ProgramExpr, ProgramExpr] | null = null;
  const endSpan = reader.match('(')
    ? readCombatParenArgs(reader, properties, (r) => {
        timeRange = r;
      })
    : readBraced(reader, `Expected { to begin ${kind}.`, `Expected } to close ${kind}.`, () => {
        const key = reader.id('Expected property name.');
        reader.expect('=', 'Expected =.');
        const range = readCombatEntry(reader, key.value, key.span, properties);
        if (range) timeRange = range;
        reader.finish();
      }).span;
  return Object.freeze({
    kind,
    target,
    properties: Object.freeze(properties),
    timeRange,
    span: join(start.span, endSpan),
  });
};

export const readCue = (reader: AssetReader): AssetCueDecl => {
  const start = reader.expectWord('cue', 'Expected cue.');
  const time = reader.expression();
  const endTime = reader.match('..') ? reader.expression() : null;
  const kindTok = reader.id('Expected cue kind (sound, vfx, or event).');
  const cueKind = isOneOf(['sound', 'vfx', 'event'] as const, kindTok.value)
    ? kindTok.value
    : 'event';
  if (!isOneOf(['sound', 'vfx', 'event'] as const, kindTok.value)) {
    reader.fail('asset.invalid-property', `Unknown cue kind "${kindTok.value}".`, kindTok);
  }
  const nameTok = reader.current();
  if (nameTok.kind !== 'string')
    reader.fail('asset.invalid-cue-name', 'Cue name must be a quoted string.', nameTok);
  else reader.take();
  let anchor: string | null = null;
  if (reader.checkWord('at')) {
    reader.take();
    anchor = reader.id('Expected anchor name after at.').value;
  }
  const payload: AssetPropertyDecl[] = [];
  const endSpan = reader.check('{')
    ? readBraced(reader, 'Expected {.', 'Expected }.', () => {
        if (reader.assignment()) payload.push(readProperty(reader));
        else reader.scopeError('cue');
      }).span
    : nameTok.span;
  if (endSpan === nameTok.span) reader.finish();
  else reader.match(';');
  return Object.freeze({
    kind: 'cue',
    cueKind,
    time,
    endTime,
    name: nameTok.value,
    anchor,
    payload: Object.freeze(payload),
    span: join(start.span, endSpan),
  });
};

const readExpressionEntry = (reader: AssetReader): AssetExpressionEntryDecl => {
  const start = reader.expectWord('at', 'Expression blocks contain at declarations.');
  const startTime = reader.expression();
  const endTime = reader.match('..') ? reader.expression() : null;
  reader.expect('=', 'Expected = after expression time.');
  const variant = reader.id('Expected expression variant identifier.');
  reader.finish();
  return Object.freeze({
    kind: 'expression-entry',
    startTime,
    endTime,
    variant: variant.value,
    span: join(start.span, variant.span),
  });
};

export const readExpressionTrack = (reader: AssetReader): AssetExpressionSlotTrackDecl => {
  const start = reader.expectWord('expression', 'Expected expression.');
  const slot = reader.id('Expected expression slot name.').value;
  const entries: AssetExpressionEntryDecl[] = [];
  const close = readBraced(
    reader,
    'Expected { to begin an expression schedule.',
    'Expected } to close an expression schedule.',
    () => {
      entries.push(readExpressionEntry(reader));
    },
  );
  return Object.freeze({
    kind: 'expression-track',
    slot,
    entries: Object.freeze(entries),
    span: join(start.span, close.span),
  });
};
