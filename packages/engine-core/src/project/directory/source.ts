import { parseSoundSource } from '@ashfox/audio-core';
import { parseAssetSource } from '../program/asset/parse';
import { lexProgramSource } from '../program/syntax/lex';
import { parseSpriteSource } from '../sprite/source';
import { parseStructureSource } from '../structure';
import { assertWellFormedSourceText } from '../workspace/path';

/** Parser-owned source discovery for hosts; never scan import text with regexes. */
export const inspectNativeSource = (
  source: string,
  file: string,
): {
  readonly kind: 'model' | 'sprite' | 'sound' | 'structure' | 'module';
  readonly id: string;
  readonly imports: readonly string[];
} => {
  assertWellFormedSourceText(source);
  const kind = lexProgramSource(source).tokens[2]?.value;
  if (kind === 'sound') {
    const sound = parseSoundSource(source, file);
    return Object.freeze({ kind: 'sound', id: sound.id, imports: Object.freeze([]) });
  }
  if (kind === 'sprite') {
    const sprite = parseSpriteSource(source, file);
    return Object.freeze({
      kind: 'sprite',
      id: sprite.id,
      imports: Object.freeze(sprite.imports.map((i) => i.path)),
    });
  }
  if (kind === 'structure') {
    const structure = parseStructureSource(source, file);
    return Object.freeze({
      kind: 'structure',
      id: structure.id,
      imports: Object.freeze(structure.imports.map((i) => i.path)),
    });
  }
  const model = parseAssetSource(source, file);
  if (model.unit && !model.diagnostics.length) {
    return Object.freeze({
      kind: model.unit.kind === 'asset' ? 'model' : 'module',
      id: model.unit.id,
      imports: Object.freeze(model.unit.imports.map((i) => i.path)),
    });
  }
  if (kind === 'module') {
    try {
      const spriteMod = parseSpriteSource(source, file);
      return Object.freeze({
        kind: 'module',
        id: spriteMod.id,
        imports: Object.freeze(spriteMod.imports.map((i) => i.path)),
      });
    } catch {
      const structMod = parseStructureSource(source, file);
      return Object.freeze({
        kind: 'module',
        id: structMod.id,
        imports: Object.freeze(structMod.imports.map((i) => i.path)),
      });
    }
  }
  throw new Error(JSON.stringify(model.diagnostics));
};
