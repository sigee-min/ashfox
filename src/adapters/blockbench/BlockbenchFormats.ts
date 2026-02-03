import { FormatDescriptor, FormatPort } from '../../ports/formats';
import { readBlockbenchGlobals } from '../../types/blockbench';

export class BlockbenchFormats implements FormatPort {
  listFormats(): FormatDescriptor[] {
    const globals = readBlockbenchGlobals();
    const formats = globals.Formats ?? globals.ModelFormat?.formats ?? {};
    if (!formats || typeof formats !== 'object') return [];
    return Object.entries(formats).map(([id, format]) => {
      const singleTexture =
        typeof format?.single_texture === 'boolean' ? format.single_texture : undefined;
      const perTextureUvSize =
        typeof format?.per_texture_uv_size === 'boolean' ? format.per_texture_uv_size : undefined;
      return {
        id,
        name: format?.name ?? id,
        ...(singleTexture !== undefined ? { singleTexture } : {}),
        ...(perTextureUvSize !== undefined ? { perTextureUvSize } : {})
      };
    });
  }

  getActiveFormatId(): string | null {
    const globals = readBlockbenchGlobals();
    const active = globals.Format ?? globals.ModelFormat?.selected ?? null;
    return active?.id ?? null;
  }
}


