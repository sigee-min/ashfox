import type { ProjectDocument } from '../../model';
import {
  TEXTURE_MAX_RESOLUTION,
  preserveRasterDetailLimit,
  preserveRasterTotalDetailLimit,
} from '../../textures/limits';
import { COLOR_PATTERN, isNonEmptyString, isSafeBlobBucket, isSafeBlobKey } from '../shared/value';
import type { FindingSink, IdRegistrar } from '../contract';

type Texture = ProjectDocument['textures'][string];
type TextureRaster = NonNullable<Texture['raster']>;
type CanvasDetail = TextureRaster['canvasDetails'][number];
type AlphaMask = NonNullable<TextureRaster['alphaMasks']>[number];
type Density = ProjectDocument['settings']['surfacePixelDensity'];
type Rect = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

const isOutsideTexture = (rect: Rect, texture: Texture): boolean =>
  rect.x < 0 ||
  rect.y < 0 ||
  rect.width <= 0 ||
  rect.height <= 0 ||
  rect.x + rect.width > texture.width ||
  rect.y + rect.height > texture.height;

const isValidAlphaValue = (alpha: number, soft: boolean): boolean =>
  soft ? Number.isSafeInteger(alpha) && alpha >= 0 && alpha <= 255 : alpha === 0 || alpha === 255;

const isInvalidCanvasDetail = (detail: CanvasDetail, texture: Texture, soft: boolean): boolean =>
  !COLOR_PATTERN.test(detail.color) ||
  !isValidAlphaValue(detail.alpha, soft) ||
  !Number.isInteger(detail.x) ||
  !Number.isInteger(detail.y) ||
  !Number.isInteger(detail.width) ||
  !Number.isInteger(detail.height) ||
  isOutsideTexture(detail, texture);

const isInvalidAlphaMask = (mask: AlphaMask, texture: Texture): boolean =>
  !isNonEmptyString(mask.id) ||
  !Number.isSafeInteger(mask.x) ||
  !Number.isSafeInteger(mask.y) ||
  !Number.isSafeInteger(mask.width) ||
  !Number.isSafeInteger(mask.height) ||
  isOutsideTexture(mask, texture) ||
  !/^[01]+$/.test(mask.bits) ||
  mask.bits.length !== mask.width * mask.height;

/** Registers entry IDs up to the first invalid entry, as the bounded scan stops there. */
const hasInvalidEntry = <TEntry extends { readonly id: string }>(
  entries: readonly TEntry[],
  limit: number,
  path: string,
  registerId: IdRegistrar,
  isInvalid: (entry: TEntry) => boolean,
): boolean =>
  !Array.isArray(entries) ||
  entries.length > limit ||
  entries.some((entry, index) => {
    registerId(entry.id, `${path}.${index}`);
    return isInvalid(entry);
  });

const validateTextureRaster = (
  texture: Texture,
  path: string,
  add: FindingSink,
  registerId: IdRegistrar,
  density: Density,
): void => {
  if (!texture.raster) return;
  const soft = texture.raster.alphaMode === 'soft';
  const limit = preserveRasterDetailLimit(density);
  const invalidCanvas = hasInvalidEntry(
    texture.raster.canvasDetails,
    limit,
    `${path}.raster.canvasDetails`,
    registerId,
    (detail) => isInvalidCanvasDetail(detail, texture, soft),
  );
  const invalidMasks = hasInvalidEntry(
    texture.raster.alphaMasks ?? [],
    limit,
    `${path}.raster.alphaMasks`,
    registerId,
    (mask) => isInvalidAlphaMask(mask, texture),
  );
  if (
    !COLOR_PATTERN.test(texture.raster.background) ||
    !isValidAlphaValue(texture.raster.backgroundAlpha, soft) ||
    invalidCanvas ||
    invalidMasks
  ) {
    add({
      code: 'texture.invalid_raster',
      severity: 'error',
      message: 'Texture raster colors, alpha, and canvas details must match ' + 'their dimensions.',
      path: `${path}.raster`,
      assetIds: [texture.id],
    });
  }
};

const isValidDimension = (value: number): boolean =>
  Number.isInteger(value) && value > 0 && value <= TEXTURE_MAX_RESOLUTION;

const isInvalidBlob = (source: Texture['source']): boolean =>
  !isNonEmptyString(source.bucket) ||
  !isNonEmptyString(source.key) ||
  !isNonEmptyString(source.contentType) ||
  !isNonEmptyString(source.contentHash) ||
  !isSafeBlobBucket(source.bucket) ||
  !isSafeBlobKey(source.key) ||
  (source.byteLength !== undefined &&
    (!Number.isInteger(source.byteLength) || source.byteLength < 0));

const validateTextureIdentity = (
  texture: Texture,
  assetKey: string,
  path: string,
  add: FindingSink,
): void => {
  if (assetKey !== texture.id) {
    add({
      code: 'identity.key_mismatch',
      severity: 'error',
      message: `Texture map key "${assetKey}" does not match ID "${texture.id}".`,
      path,
      assetIds: [texture.id],
    });
  }
  if (!isValidDimension(texture.width) || !isValidDimension(texture.height)) {
    add({
      code: 'texture.invalid_dimensions',
      severity: 'error',
      message:
        'Texture dimensions must be positive integers no larger than ' +
        `${TEXTURE_MAX_RESOLUTION}.`,
      path,
      assetIds: [texture.id],
    });
  }
};

const validateTextureSource = (texture: Texture, path: string, add: FindingSink): void => {
  if (texture.atlasMode !== undefined && texture.atlasMode !== 'preserve') {
    add({
      code: 'texture.invalid_atlas_mode',
      severity: 'error',
      message: 'Texture atlas mode must be preserve when provided.',
      path: `${path}.atlasMode`,
      assetIds: [texture.id],
    });
  }
  if (isInvalidBlob(texture.source)) {
    add({
      code: 'texture.invalid_blob',
      severity: 'error',
      message:
        'Texture blob references require safe logical bucket/key values, contentType, contentHash, and a non-negative byteLength.',
      path: `${path}.source`,
      assetIds: [texture.id],
    });
  }
};

export const validateTextures = (
  document: ProjectDocument,
  add: FindingSink,
  registerId: IdRegistrar,
): void => {
  const density = document.settings.surfacePixelDensity;
  let preserveDetails = 0;
  for (const [assetKey, texture] of Object.entries(document.textures)) {
    const path = `textures.${assetKey}`;
    registerId(texture.id, path);
    if (texture.raster !== undefined) {
      preserveDetails += texture.raster.canvasDetails.length;
      if (preserveDetails > preserveRasterTotalDetailLimit(density)) {
        add({
          code: 'texture.invalid_raster',
          severity: 'error',
          message: 'Preserve-mode raster details exceed the bounded asset budget.',
          path: 'textures',
          assetIds: [texture.id],
        });
      }
    }
    validateTextureIdentity(texture, assetKey, path, add);
    validateTextureSource(texture, path, add);
    validateTextureRaster(texture, path, add, registerId, density);
  }
};
