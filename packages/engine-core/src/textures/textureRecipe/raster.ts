import type {
  ProjectDocument,
  TextureAsset
} from '../../model';
import type { TextureComposition } from './types';
import { parseSurfaceColor, type RgbColor } from '../color';
import {
  assertTextureDimensions,
  PRESERVE_RASTER_MAX_DETAILS,
  PRESERVE_RASTER_MAX_TOTAL_DETAILS
} from '../limits';
import { composeTextureRaster } from './composition';

/**
 * Read-only canonical RGBA bytes.
 *
 * The backing byte buffer is kept in a closure. Consumers can inspect a byte,
 * iterate the bytes, or explicitly request a mutable copy at an I/O boundary,
 * but cannot obtain a typed-array view or mutate raster authority in place.
 */
export interface CanonicalRgbaBytes extends Iterable<number> {
  readonly length: number;
  at(index: number): number | undefined;
  copy(): Uint8Array;
}

export interface CanonicalTextureRaster {
  readonly width: number;
  readonly height: number;
  readonly rgba: CanonicalRgbaBytes;
}

const writePixel = (
  rgba: Uint8Array,
  width: number,
  x: number,
  y: number,
  color: RgbColor,
  alpha: 0 | 255
): void => {
  const offset = (y * width + x) * 4;
  rgba[offset] = color.r;
  rgba[offset + 1] = color.g;
  rgba[offset + 2] = color.b;
  rgba[offset + 3] = alpha;
};

const fill = (
  rgba: Uint8Array,
  width: number,
  x: number,
  y: number,
  fillWidth: number,
  fillHeight: number,
  color: RgbColor,
  alpha: 0 | 255
): void => {
  for (let targetY = y; targetY < y + fillHeight; targetY += 1) {
    for (let targetX = x; targetX < x + fillWidth; targetX += 1) {
      writePixel(rgba, width, targetX, targetY, color, alpha);
    }
  }
};

const assertTextureRect = (
  x: unknown,
  y: unknown,
  width: unknown,
  height: unknown,
  textureWidth: number,
  textureHeight: number,
  label: string
): void => {
  if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y) ||
    !Number.isSafeInteger(width) || !Number.isSafeInteger(height) ||
    (x as number) < 0 || (y as number) < 0 ||
    (width as number) <= 0 || (height as number) <= 0 ||
    (x as number) + (width as number) > textureWidth ||
    (y as number) + (height as number) > textureHeight) {
    throw new RangeError(
      `${label} must be a positive integer rectangle inside the texture atlas.`
    );
  }
};

const assertTextureComposition = (
  width: number,
  height: number,
  composition: TextureComposition
): void => {
  if (composition === null || typeof composition !== 'object') {
    throw new TypeError('Texture composition must be an object.');
  }
  parseSurfaceColor(composition.background);
  if (composition.backgroundAlpha !== 0 && composition.backgroundAlpha !== 255) {
    throw new RangeError('Texture background alpha must be exactly 0 or 255.');
  }
  if (!Array.isArray(composition.canvasDetails) ||
    !Array.isArray(composition.alphaMasks)) {
    throw new TypeError('Texture composition details and masks must be arrays.');
  }
  if (composition.canvasDetails.length > PRESERVE_RASTER_MAX_DETAILS ||
    composition.alphaMasks.length > PRESERVE_RASTER_MAX_DETAILS ||
    composition.canvasDetails.length + composition.alphaMasks.length >
      PRESERVE_RASTER_MAX_TOTAL_DETAILS) {
    throw new RangeError('Texture raster details exceed the bounded asset budget.');
  }
  for (const [index, detail] of composition.canvasDetails.entries()) {
    if (detail === null || typeof detail !== 'object') {
      throw new TypeError(`Texture raster detail ${index} must be an object.`);
    }
    parseSurfaceColor(detail.color);
    if (detail.alpha !== 0 && detail.alpha !== 255) {
      throw new RangeError(`Texture raster detail ${index} alpha must be 0 or 255.`);
    }
    assertTextureRect(
      detail.x,
      detail.y,
      detail.width,
      detail.height,
      width,
      height,
      `Texture raster detail ${index}`
    );
  }
  for (const [index, mask] of composition.alphaMasks.entries()) {
    if (mask === null || typeof mask !== 'object') {
      throw new TypeError(`Texture alpha mask ${index} must be an object.`);
    }
    assertTextureRect(
      mask.x,
      mask.y,
      mask.width,
      mask.height,
      width,
      height,
      `Texture alpha mask ${index}`
    );
    if (typeof mask.bits !== 'string' || !/^[01]+$/u.test(mask.bits) ||
      mask.bits.length !== mask.width * mask.height) {
      throw new RangeError(
        `Texture alpha mask ${index} must exactly fill its binary rectangle.`
      );
    }
  }
};

const canonicalByteViews = new WeakSet<CanonicalRgbaBytes>();

const immutableRgba = (rgba: Uint8Array): CanonicalRgbaBytes => {
  // The caller transfers this freshly allocated buffer and never retains it.
  // Keeping it in the closure avoids a second full-size allocation at peak.
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
    }
  };
  Object.freeze(view);
  canonicalByteViews.add(view);
  return view;
};

export const assertCanonicalTextureRaster = (value: unknown): void => {
  if (value === null || typeof value !== 'object') {
    throw new TypeError('Canonical texture raster must be an object.');
  }
  const raster = value as Partial<CanonicalTextureRaster>;
  const [width, height] = assertTextureDimensions(
    raster.width,
    raster.height,
    'Canonical texture'
  );
  const expectedLength = width * height * 4;
  const bytes = raster.rgba;
  if (bytes === undefined || bytes === null || typeof bytes !== 'object' ||
    !Object.isFrozen(bytes) || !Number.isSafeInteger(bytes.length) ||
    bytes.length !== expectedLength || typeof bytes.at !== 'function' ||
    typeof bytes.copy !== 'function' ||
    typeof bytes[Symbol.iterator] !== 'function') {
    throw new RangeError(
      'Canonical texture RGBA bytes must contain exactly four bytes per texel.'
    );
  }
  // These exact views own private Uint8Array storage and expose copies only.
  // Their constructor already guarantees immutable dense bytes; foreign views
  // must still pass the full scan even when they are frozen.
  if (canonicalByteViews.has(bytes)) return;
  let index = 0;
  for (const byte of bytes) {
    if (index >= expectedLength || !Number.isInteger(byte) || byte < 0 ||
      byte > 255 || bytes.at(index) !== byte) {
      throw new RangeError(
        'Canonical texture RGBA bytes must contain exactly four bytes per texel.'
      );
    }
    index += 1;
  }
  if (index !== expectedLength) {
    throw new RangeError(
      'Canonical texture RGBA bytes must contain exactly four bytes per texel.'
    );
  }
};

const applyAlphaMasks = (
  rgba: Uint8Array,
  width: number,
  masks: readonly TextureComposition['alphaMasks'][number][]
): void => {
  for (const mask of masks) {
    for (let row = 0; row < mask.height; row += 1) {
      for (let column = 0; column < mask.width; column += 1) {
        const offset = ((mask.y + row) * width + mask.x + column) * 4;
        // Alpha is intentionally the final raster operation. Color paint
        // cannot overwrite a source-owned coverage decision.
        rgba[offset + 3] = mask.bits[row * mask.width + column] === '1' ? 255 : 0;
      }
    }
  }
};

/** Materialize a validated explicit composition without a ProjectDocument. */
export const rasterizeCanonicalTexture = (
  width: number,
  height: number,
  composition: TextureComposition
): CanonicalTextureRaster => {
  assertTextureDimensions(width, height, 'Canonical texture');
  assertTextureComposition(width, height, composition);
  const rgba = new Uint8Array(width * height * 4);
  fill(
    rgba,
    width,
    0,
    0,
    width,
    height,
    parseSurfaceColor(composition.background),
    composition.backgroundAlpha
  );
  for (const detail of composition.canvasDetails) {
    fill(
      rgba,
      width,
      detail.x,
      detail.y,
      detail.width,
      detail.height,
      parseSurfaceColor(detail.color),
      detail.alpha
    );
  }
  applyAlphaMasks(rgba, width, composition.alphaMasks);
  return Object.freeze({ width, height, rgba: immutableRgba(rgba) });
};

export const rasterizeTexture = (
  document: ProjectDocument,
  texture: TextureAsset
): CanonicalTextureRaster => {
  assertTextureDimensions(texture.width, texture.height, 'Canonical texture');
  const composition = composeTextureRaster(document, texture);
  return rasterizeCanonicalTexture(texture.width, texture.height, composition);
};
