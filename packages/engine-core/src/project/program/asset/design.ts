import type { ProgramExpr } from '../syntax/contract';
import type { SourceSpan } from '../../source/contract';
import type { AssetDesignCheck, AssetDesignDecl, AssetDesignField, AssetValueType } from './contract';
import { freeze, join, type Token } from './parserSupport';

export interface AssetValueTypeReader {
  readonly id: (message?: string) => Token;
  readonly match: (token: string) => boolean;
  readonly expect: (token: string, message: string) => Token;
  readonly fail: (code: string, message: string, token: Token) => void;
}

export const parseAssetValueType = (reader: AssetValueTypeReader): AssetValueType => {
  const first = reader.id('Expected a closed value type.');
  let value = first.value;
  if (reader.match('-')) value += '-' + reader.id('Expected the remainder of a closed type.').value;
  if (reader.match('<')) {
    const inner = reader.id('Expected a type argument.');
    reader.expect('>', 'Expected > after a type argument.');
    value += '<' + inner.value + '>';
  }
  const allowed: readonly string[] = ['unit', 'texel', 'degree', 'second', 'ratio', 'bool', 'color',
    'integer', 'vec2<unit>', 'vec3<unit>', 'vec3<degree>', 'vec3<ratio>', 'vec2<texel>', 'texel-rect'];
  if (!allowed.includes(value)) reader.fail('asset.invalid-slot-type',
    'Unsupported closed value type "' + value + '".', first);
  return (allowed.includes(value) ? value : 'unit') as AssetValueType;
};

export interface AssetDesignReader {
  readonly take: () => Token;
  readonly id: (message: string) => Token;
  readonly count: () => void;
  readonly matchWord: (word: string) => boolean;
  readonly expect: (token: string, message: string) => Token;
  readonly valueType: () => AssetValueType;
  readonly expression: () => ProgramExpr;
  readonly finish: () => void;
  readonly block: (read: () => void) => void;
  readonly blockEnd: () => SourceSpan;
}

export const parseAssetDesign = (reader: AssetDesignReader, exported: boolean): AssetDesignDecl => {
  const start = reader.take();
  const id = reader.id('Expected a design name.');
  const fields: AssetDesignField[] = [];
  const checks: AssetDesignCheck[] = [];
  reader.block(() => {
    reader.count();
    const check = reader.matchWord('check');
    const name = reader.id('Expected a design field or check name.');
    if (!check) reader.expect(':', 'Design fields require an explicit closed type.');
    const type = check ? 'bool' : reader.valueType();
    reader.expect('=', 'Design fields and checks require an expression.');
    const value = reader.expression();
    reader.finish();
    const span = join(name.span, value.span);
    if (check) checks.push(freeze({ id: name.value, value, span }));
    else fields.push(freeze({ id: name.value, type, value, span }));
  });
  return freeze({ kind: 'design', exported, id: id.value,
    fields: freeze(fields), checks: freeze(checks), span: join(start.span, reader.blockEnd()) });
};
