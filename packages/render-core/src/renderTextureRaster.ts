import {
  rasterizeTexture,
  type ProjectDocument,
  type TextureAsset
} from '@ashfox/engine-core';

export const renderTextureRaster = (
  document: ProjectDocument,
  texture: TextureAsset
): HTMLCanvasElement => {
  const canvas = window.document.createElement('canvas');
  canvas.width = texture.width;
  canvas.height = texture.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Texture canvas is unavailable.');
  const raster = rasterizeTexture(document, texture);
  const image = context.createImageData(raster.width, raster.height);
  // ImageData owns the mutable renderer buffer; canonical raster bytes stay
  // immutable at the engine boundary.
  image.data.set(raster.rgba.copy());
  context.putImageData(image, 0, 0);
  return canvas;
};
