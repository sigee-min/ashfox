import type { ProjectDocument } from '../../model';
import {
  TEXTURE_MAX_RESOLUTION,
  preserveRasterDetailLimit,
  preserveRasterTotalDetailLimit,
} from '../../textures/limits';
import { COLOR_PATTERN, isNonEmptyString, isSafeBlobBucket, isSafeBlobKey } from '../shared/value';
import type { FindingSink, IdRegistrar } from '../contract';

const validateTextureRaster = (
  texture: ProjectDocument['textures'][string],
  path: string,
  add: FindingSink,
  registerId: IdRegistrar,
  density: ProjectDocument['settings']['surfacePixelDensity'],
): void => {
  if (!texture.raster) return;
  const canvasDetails = texture.raster.canvasDetails;
  const invalidCanvas =
    !Array.isArray(canvasDetails) ||
    canvasDetails.length > preserveRasterDetailLimit(density) ||
    canvasDetails.some((detail, index) => {
      registerId(detail.id, `${path}.raster.canvasDetails.${index}`);
      return (
        !COLOR_PATTERN.test(detail.color) ||
        (detail.alpha !== 0 && detail.alpha !== 255) ||
        !Number.isInteger(detail.x) ||
        !Number.isInteger(detail.y) ||
        !Number.isInteger(detail.width) ||
        !Number.isInteger(detail.height) ||
        detail.x < 0 ||
        detail.y < 0 ||
        detail.width <= 0 ||
        detail.height <= 0 ||
        detail.x + detail.width > texture.width ||
        detail.y + detail.height > texture.height
      );
    });
  const alphaMasks = texture.raster.alphaMasks ?? [];
  const invalidMasks =
    !Array.isArray(alphaMasks) ||
    alphaMasks.length > preserveRasterDetailLimit(density) ||
    alphaMasks.some((mask, index) => {
      registerId(mask.id, `${path}.raster.alphaMasks.${index}`);
      return (
        !isNonEmptyString(mask.id) ||
        !Number.isSafeInteger(mask.x) ||
        !Number.isSafeInteger(mask.y) ||
        !Number.isSafeInteger(mask.width) ||
        !Number.isSafeInteger(mask.height) ||
        mask.x < 0 ||
        mask.y < 0 ||
        mask.width <= 0 ||
        mask.height <= 0 ||
        mask.x + mask.width > texture.width ||
        mask.y + mask.height > texture.height ||
        !/^[01]+$/.test(mask.bits) ||
        mask.bits.length !== mask.width * mask.height
      );
    });
  if (
    !COLOR_PATTERN.test(texture.raster.background) ||
    (texture.raster.backgroundAlpha !== 0 && texture.raster.backgroundAlpha !== 255) ||
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

export const validateTextures = (
  document: ProjectDocument,
  add: FindingSink,
  registerId: IdRegistrar,
): void => {
  let preserveDetails = 0;
  for (const [assetKey, texture] of Object.entries(document.textures)) {
    const path = `textures.${assetKey}`;
    registerId(texture.id, path);
    if (texture.raster !== undefined) {
      preserveDetails += texture.raster.canvasDetails.length;
      if (preserveDetails > preserveRasterTotalDetailLimit(document.settings.surfacePixelDensity)) {
        add({
          code: 'texture.invalid_raster',
          severity: 'error',
          message: 'Preserve-mode raster details exceed the bounded asset budget.',
          path: 'textures',
          assetIds: [texture.id],
        });
      }
    }
    if (assetKey !== texture.id) {
      add({
        code: 'identity.key_mismatch',
        severity: 'error',
        message: `Texture map key "${assetKey}" does not match ID "${texture.id}".`,
        path,
        assetIds: [texture.id],
      });
    }
    if (
      !Number.isInteger(texture.width) ||
      texture.width <= 0 ||
      texture.width > TEXTURE_MAX_RESOLUTION ||
      !Number.isInteger(texture.height) ||
      texture.height <= 0 ||
      texture.height > TEXTURE_MAX_RESOLUTION
    ) {
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
    if (texture.atlasMode !== undefined && texture.atlasMode !== 'preserve') {
      add({
        code: 'texture.invalid_atlas_mode',
        severity: 'error',
        message: 'Texture atlas mode must be preserve when provided.',
        path: `${path}.atlasMode`,
        assetIds: [texture.id],
      });
    }
    if (
      !isNonEmptyString(texture.source.bucket) ||
      !isNonEmptyString(texture.source.key) ||
      !isNonEmptyString(texture.source.contentType) ||
      !isNonEmptyString(texture.source.contentHash) ||
      (isNonEmptyString(texture.source.bucket) && !isSafeBlobBucket(texture.source.bucket)) ||
      (isNonEmptyString(texture.source.key) && !isSafeBlobKey(texture.source.key)) ||
      (texture.source.byteLength !== undefined &&
        (!Number.isInteger(texture.source.byteLength) || texture.source.byteLength < 0))
    ) {
      add({
        code: 'texture.invalid_blob',
        severity: 'error',
        message:
          'Texture blob references require safe logical bucket/key values, contentType, contentHash, and a non-negative byteLength.',
        path: `${path}.source`,
        assetIds: [texture.id],
      });
    }
    validateTextureRaster(texture, path, add, registerId, document.settings.surfacePixelDensity);
  }
};
