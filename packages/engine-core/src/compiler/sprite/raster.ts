import type {
  CanonicalRgbaBytes,
  CanonicalTextureRaster,
} from '../../textures/textureRecipe/raster';

const immutableRgba = (rgba: Uint8Array): CanonicalRgbaBytes => {
  const bytes = rgba;
  const view: CanonicalRgbaBytes = {
    get length(): number {
      return bytes.length;
    },
    at(index: number): number | undefined {
      return Number.isSafeInteger(index) && index >= 0 && index < bytes.length
        ? bytes[index]
        : undefined;
    },
    copy(): Uint8Array {
      return new Uint8Array(bytes);
    },
    *[Symbol.iterator](): Iterator<number> {
      for (let index = 0; index < bytes.length; index += 1) {
        yield bytes[index]!;
      }
    },
  };
  Object.freeze(view);
  return view;
};

/** Wrap freshly allocated RGBA bytes in a frozen canonical texture raster view. */
export const createCanonicalRaster = (
  width: number,
  height: number,
  rgba: Uint8Array,
): CanonicalTextureRaster => Object.freeze({ width, height, rgba: immutableRgba(rgba) });
