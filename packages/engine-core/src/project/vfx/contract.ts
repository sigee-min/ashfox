import type { RawDeclaredOutput, RawDeclaredPreview } from '../directory/declarations';
import type { VfxPalette, VfxRecipe } from '../../vfx/contract';

export interface VfxInputDiagnostic {
  readonly code: string;
  readonly file: string;
  readonly pointer: string;
  readonly expected: string;
  readonly actual: string;
}

export class VfxInputError extends Error {
  constructor(readonly diagnostic: VfxInputDiagnostic) {
    super(
      `${diagnostic.file}:${diagnostic.pointer}: expected ${diagnostic.expected}, got ${diagnostic.actual}`,
    );
    this.name = 'VfxInputError';
  }
}

export interface VfxSourceUnit {
  readonly kind: 'vfx' | 'module';
  readonly id: string;
  readonly imports: readonly { readonly path: string; readonly alias: string }[];
  readonly outputs: readonly RawDeclaredOutput[];
  readonly previews: readonly RawDeclaredPreview[];
  readonly palettes: Readonly<Record<string, VfxPalette>>;
  readonly paletteRef: string | null;
  readonly recipe: VfxRecipe | null;
}
