/** Single authority for explicit texture allocation bounds. */
export const TEXTURE_MAX_RESOLUTION = 4_096;

/**
 * A preserve-mode raster may be sparse (Minecraft planes and clustered
 * high-density faces). Keep an explicit bounded detail budget instead of
 * silently truncating or downsampling the raster.
 */
export const PRESERVE_RASTER_MAX_DETAILS = 131_072;
export const PRESERVE_RASTER_MAX_TOTAL_DETAILS = 524_288;

export const isTextureDimension = (value: unknown): value is number =>
  Number.isSafeInteger(value) &&
  (value as number) >= 1 &&
  (value as number) <= TEXTURE_MAX_RESOLUTION;

export const assertTextureDimensions = (
  width: unknown,
  height: unknown,
  label = 'Texture',
): readonly [number, number] => {
  if (!isTextureDimension(width) || !isTextureDimension(height)) {
    throw new RangeError(
      `${label} dimensions must be safe integers from 1 to ` + `${TEXTURE_MAX_RESOLUTION}.`,
    );
  }
  return [width, height];
};

/** Preserve-mode detail budgets scale with the persisted density multiplier.
 * The scene geometry is unchanged; only the number of raster runs grows with
 * the selected canonical texture scale. */
export const preserveRasterDetailLimit = (density: number): number =>
  PRESERVE_RASTER_MAX_DETAILS * density;

export const preserveRasterTotalDetailLimit = (density: number): number =>
  PRESERVE_RASTER_MAX_TOTAL_DETAILS * density;
