import { freeze } from '../../../immutable';
import type { ProgramExpr } from '../syntax/contract';
import type { SourceSpan } from '../../source/contract';
import type {
  AssetDesignCheck,
  AssetDesignDecl,
  AssetDesignField,
  AssetValueType,
} from './contract';
import { isSnakeCase, join, type AssetReader, type Token } from './parserSupport';
import { docsHint, formatDidYouMean, toSnakeCaseTrap } from '../../source/suggest';

export interface AssetValueTypeReader {
  readonly id: (message?: string) => Token;
  readonly match: (token: string) => boolean;
  readonly expect: (token: string, message: string) => Token;
  readonly fail: (code: string, message: string, token: Token, hint?: string) => void;
}

export const parseAssetValueType = (reader: AssetValueTypeReader): AssetValueType => {
  const first = reader.id('Expected a closed value type.');
  let value = first.value;
  if (reader.match('<')) {
    const inner = reader.id('Expected a type argument.');
    reader.expect('>', 'Expected > after a type argument.');
    value += '<' + inner.value + '>';
  }
  const allowed: readonly string[] = [
    'unit',
    'texel',
    'degree',
    'second',
    'ratio',
    'bool',
    'color',
    'integer',
    'vec2<unit>',
    'vec2<ratio>',
    'vec3<unit>',
    'vec3<degree>',
    'vec3<ratio>',
    'vec2<texel>',
    'texel_rect',
  ];
  if (!allowed.includes(value))
    reader.fail(
      'asset.invalid-slot-type',
      `Unsupported closed value type "${value}".${formatDidYouMean(value, allowed)}`,
      first,
      docsHint('model'),
    );
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
  readonly fail: (code: string, message: string, token?: Token, hint?: string) => void;
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
    if (!isSnakeCase(name.value)) {
      const snake = toSnakeCaseTrap(name.value);
      reader.fail(
        'asset.invalid-key',
        `Design field "${name.value}" must be snake_case.${snake !== null ? ` Did you mean "${snake}"?` : ''}`,
        name,
        docsHint('model'),
      );
    }
    if (!check) reader.expect(':', 'Design fields require an explicit closed type.');
    const type = check ? 'bool' : reader.valueType();
    reader.expect('=', 'Design fields and checks require an expression.');
    const value = reader.expression();
    reader.finish();
    const span = join(name.span, value.span);
    if (check) checks.push(freeze({ id: name.value, value, span }));
    else fields.push(freeze({ id: name.value, type, value, span }));
  });
  return freeze({
    kind: 'design',
    exported,
    id: id.value,
    fields: freeze(fields),
    checks: freeze(checks),
    span: join(start.span, reader.blockEnd()),
  });
};

export const readAssetDesignDecl = (
  reader: AssetReader,
  exported: boolean,
  count: () => void,
  matchWord: (word: string) => boolean,
): AssetDesignDecl =>
  parseAssetDesign(
    {
      take: reader.take,
      id: reader.id,
      count,
      matchWord,
      expect: reader.expect,
      valueType: reader.valueType,
      expression: reader.expression,
      finish: reader.finish,
      block: (read) => {
        reader.block(read);
      },
      blockEnd: reader.blockEnd,
      fail: reader.fail,
    },
    exported,
  );
