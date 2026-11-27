import { parseSoundUnit } from '@ashfox/audio-core';
import { type RawDeclaredOutput } from './declarations';
import { parseAssetSource } from '../program/asset/parse';
import { lexProgramSource } from '../program/syntax/lex';
import { parseSpriteSource } from '../sprite/source';
import { parseStructureSource } from '../structure';
import { parseVfxSource } from '../vfx/source';
import { assertWellFormedSourceText } from '../workspace/path';

export interface NativeSourceMetadata {
  readonly kind: 'model' | 'sprite' | 'sound' | 'structure' | 'vfx' | 'module';
  readonly id: string;
  readonly imports: readonly string[];
  readonly outputs: readonly RawDeclaredOutput[];
}

const parseAnyModule = (source: string, file: string): NativeSourceMetadata | null => {
  for (const attempt of [
    () => parseSpriteSource(source, file),
    () => parseStructureSource(source, file),
    () => parseSoundUnit(source, file),
    () => parseVfxSource(source, file),
  ]) {
    try {
      const unit = attempt();
      if (unit.kind === 'module') {
        return Object.freeze({
          kind: 'module',
          id: unit.id,
          imports: Object.freeze(unit.imports.map((i) => i.path)),
          outputs: Object.freeze([]),
        });
      }
    } catch {
      // Try next grammar variant for module headers.
    }
  }
  return null;
};

/** Parser-owned source discovery for hosts; never scan import text with regexes. */
export const inspectNativeSource = (source: string, file: string): NativeSourceMetadata => {
  assertWellFormedSourceText(source);
  const kind = lexProgramSource(source).tokens[2]?.value;
  if (kind === 'sound') {
    const sound = parseSoundUnit(source, file);
    if (sound.kind !== 'sound') throw new Error(`${file}: expected sound declaration`);
    return Object.freeze({
      kind: 'sound',
      id: sound.id,
      imports: Object.freeze(sound.imports.map((i) => i.path)),
      outputs: Object.freeze([...sound.outputs]),
    });
  }
  if (kind === 'sprite') {
    const sprite = parseSpriteSource(source, file);
    return Object.freeze({
      kind: 'sprite',
      id: sprite.id,
      imports: Object.freeze(sprite.imports.map((i) => i.path)),
      outputs: Object.freeze([...sprite.outputs]),
    });
  }
  if (kind === 'structure') {
    const structure = parseStructureSource(source, file);
    return Object.freeze({
      kind: 'structure',
      id: structure.id,
      imports: Object.freeze(structure.imports.map((i) => i.path)),
      outputs: Object.freeze([...structure.outputs]),
    });
  }
  if (kind === 'vfx') {
    const vfx = parseVfxSource(source, file);
    return Object.freeze({
      kind: 'vfx',
      id: vfx.id,
      imports: Object.freeze(vfx.imports.map((i) => i.path)),
      outputs: Object.freeze([...vfx.outputs]),
    });
  }
  const model = parseAssetSource(source, file);
  if (model.unit && !model.diagnostics.length) {
    return Object.freeze({
      kind: model.unit.kind === 'asset' ? 'model' : 'module',
      id: model.unit.id,
      imports: Object.freeze(model.unit.imports.map((i) => i.path)),
      outputs: Object.freeze(model.unit.kind === 'asset' ? [...model.unit.outputs] : []),
    });
  }
  if (kind === 'module') {
    const mod = parseAnyModule(source, file);
    if (mod) return mod;
  }
  throw new Error(JSON.stringify(model.diagnostics));
};
