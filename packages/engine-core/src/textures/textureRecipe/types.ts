import type { TextureAlphaMask, TextureCanvasDetail } from '../../model';

/** Deterministic composition of one source-owned explicit raster. */
export interface TextureComposition {
  background: string;
  backgroundAlpha: number;
  alphaMode?: 'binary' | 'soft';
  canvasDetails: readonly TextureCanvasDetail[];
  alphaMasks: readonly TextureAlphaMask[];
}
