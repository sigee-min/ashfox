import type { ProjectDocument, TextureAsset } from '../../model';
import type { TextureComposition } from './types';

/**
 * Materialize the explicit raster already present on the document. There is
 * no inferred atlas, surface authority, or region in this stage.
 */
const isValidAlpha = (alpha: number, soft: boolean): boolean =>
  soft ? Number.isSafeInteger(alpha) && alpha >= 0 && alpha <= 255 : alpha === 0 || alpha === 255;

export const composeTextureRaster = (
  _document: ProjectDocument,
  texture: TextureAsset,
): TextureComposition => {
  const raster = texture.raster;
  const soft = raster?.alphaMode === 'soft';
  if (
    raster === undefined ||
    !isValidAlpha(raster.backgroundAlpha, soft) ||
    raster.canvasDetails.some((detail) => !isValidAlpha(detail.alpha, soft))
  ) {
    throw new TypeError('Texture raster alpha must be explicit.');
  }
  return {
    background: raster.background,
    backgroundAlpha: raster.backgroundAlpha,
    ...(raster.alphaMode !== undefined ? { alphaMode: raster.alphaMode } : {}),
    // Source order is the paint order. Sorting by generated IDs would make
    // overlapping author operations change meaning.
    canvasDetails: [...raster.canvasDetails],
    alphaMasks: [...(raster.alphaMasks ?? [])],
  };
};
