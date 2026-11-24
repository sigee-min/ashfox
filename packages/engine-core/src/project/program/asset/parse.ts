import { freeze } from '../../../immutable';
import { lexProgramSource } from '../syntax/lex';
import { sourceSpan } from '../../source/lexer';
import { ASHFOX_ASSET_GRAMMAR, type AssetSourceParseResult } from './contract';
import { Parser } from './parser';

export const parseAssetSource = (source: string, path = 'main.ashfox'): AssetSourceParseResult => {
  const lexical = lexProgramSource(source);
  if (lexical.diagnostics.length > 0)
    return freeze({
      path,
      source,
      grammar: ASHFOX_ASSET_GRAMMAR,
      unit: null,
      diagnostics: freeze(
        lexical.diagnostics.map((entry) =>
          freeze({ ...entry, code: entry.code.replace(/^(?:model|program)\./, 'asset.'), path }),
        ),
      ),
    });
  if (lexical.tokens.length > 12000)
    return freeze({
      path,
      source,
      grammar: ASHFOX_ASSET_GRAMMAR,
      unit: null,
      diagnostics: freeze([
        freeze({
          severity: 'error' as const,
          code: 'asset.token-limit',
          message: 'Asset source contains too many tokens.',
          path,
          span: sourceSpan(source, 0, source.length),
        }),
      ]),
    });
  return new Parser(lexical.tokens, source, path).result();
};
