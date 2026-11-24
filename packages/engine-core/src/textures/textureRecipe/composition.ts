import type { ProjectDocument, TextureAsset } from '../../model';
import type { TextureComposition } from './types';

/**
 * Materialize the explicit raster already present on the document. There is
 * no inferred atlas, surface authority, or region in this stage.
 */
export const composeTextureRaster = (
  _document: ProjectDocument,
  texture: TextureAsset,
): TextureComposition => {
  const raster = texture.raster;
  if (
    raster === undefined ||
    (raster.backgroundAlpha !== 0 && raster.backgroundAlpha !== 255) ||
    raster.canvasDetails.some((detail) => detail.alpha !== 0 && detail.alpha !== 255)
  ) {
    throw new TypeError('Texture raster alpha must be explicit.');
  }
  return {
    background: raster.background,
    backgroundAlpha: raster.backgroundAlpha,
    // Source order is the paint order. Sorting by generated IDs would make
    // overlapping author operations change meaning.
    canvasDetails: [...raster.canvasDetails],
    alphaMasks: [...(raster.alphaMasks ?? [])],
  };
};
