import { isClosedContractRecord } from '@ashfox/internal-contracts';
import { TEXTURE_MAX_RESOLUTION } from '../../textures/limits';

import {
  childPath,
  closedRecord,
  expectArray,
  expectBoolean,
  expectFiniteNumber,
  expectLiteral,
  expectString,
  hasOwn,
  reject,
  validateRecordMap,
  type ContractContext,
  type ContractRecord,
} from './shared';

const validateTextureDimension = (value: unknown, path: string, context: ContractContext): void => {
  expectFiniteNumber(value, path, context);
  if (
    typeof value === 'number' &&
    (!Number.isSafeInteger(value) || value < 1 || value > TEXTURE_MAX_RESOLUTION)
  ) {
    reject(
      context,
      path,
      `${path} must be a safe integer from 1 to ` + `${TEXTURE_MAX_RESOLUTION}.`,
    );
  }
};

const validateBlobRef = (value: unknown, path: string, context: ContractContext): void => {
  const record = closedRecord(
    value,
    path,
    ['bucket', 'key', 'contentType', 'contentHash'],
    ['byteLength'],
    context,
  );
  if (!record) return;
  expectString(record.bucket, `${path}.bucket`, context);
  expectString(record.key, `${path}.key`, context);
  expectString(record.contentType, `${path}.contentType`, context);
  expectString(record.contentHash, `${path}.contentHash`, context);
  if (hasOwn(record, 'byteLength')) {
    expectFiniteNumber(record.byteLength, `${path}.byteLength`, context);
  }
};

const validateRasterAlpha = (
  value: unknown,
  path: string,
  soft: boolean,
  context: ContractContext,
): void => {
  if (soft) {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > 255) {
      reject(context, path, `${path} must be an integer 0..255 in soft alphaMode.`);
    }
    return;
  }
  if (value !== 0 && value !== 255) {
    reject(context, path, `${path} must be 0 or 255.`);
  }
};

const validateCanvasDetail = (
  entry: unknown,
  detailPath: string,
  soft: boolean,
  context: ContractContext,
) => {
  const detail = closedRecord(
    entry,
    detailPath,
    ['id', 'color', 'alpha', 'x', 'y', 'width', 'height'],
    [],
    context,
  );
  if (!detail) return;
  expectString(detail.id, `${detailPath}.id`, context);
  expectString(detail.color, `${detailPath}.color`, context);
  expectFiniteNumber(detail.alpha, `${detailPath}.alpha`, context);
  validateRasterAlpha(detail.alpha, `${detailPath}.alpha`, soft, context);
  expectFiniteNumber(detail.x, `${detailPath}.x`, context);
  expectFiniteNumber(detail.y, `${detailPath}.y`, context);
  expectFiniteNumber(detail.width, `${detailPath}.width`, context);
  expectFiniteNumber(detail.height, `${detailPath}.height`, context);
};

const validateMaskIntegers = (mask: ContractRecord, maskPath: string, context: ContractContext) => {
  for (const key of ['x', 'y', 'width', 'height'] as const) {
    expectFiniteNumber(mask[key], `${maskPath}.${key}`, context);
    if (typeof mask[key] === 'number' && !Number.isSafeInteger(mask[key])) {
      reject(context, `${maskPath}.${key}`, `${maskPath}.${key} must be an exact integer.`);
    }
  }
};

const isPositiveInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0;

const validateMaskBits = (mask: ContractRecord, maskPath: string, context: ContractContext) => {
  if (typeof mask.width === 'number' && mask.width <= 0)
    reject(context, `${maskPath}.width`, `${maskPath}.width must be positive.`);
  if (typeof mask.height === 'number' && mask.height <= 0)
    reject(context, `${maskPath}.height`, `${maskPath}.height must be positive.`);
  if (typeof mask.bits !== 'string') return;
  if (!/^[01]+$/.test(mask.bits))
    reject(context, `${maskPath}.bits`, `${maskPath}.bits must contain only 0 and 1.`);
  if (
    isPositiveInteger(mask.width) &&
    isPositiveInteger(mask.height) &&
    mask.bits.length !== mask.width * mask.height
  )
    reject(context, `${maskPath}.bits`, `${maskPath}.bits must exactly fill the mask rectangle.`);
};

const validateMaskBounds = (
  mask: ContractRecord,
  maskPath: string,
  context: ContractContext,
  textureWidth: unknown,
  textureHeight: unknown,
): void => {
  if (
    typeof textureWidth !== 'number' ||
    typeof textureHeight !== 'number' ||
    typeof mask.x !== 'number' ||
    typeof mask.y !== 'number' ||
    typeof mask.width !== 'number' ||
    typeof mask.height !== 'number'
  )
    return;
  if (
    mask.x < 0 ||
    mask.y < 0 ||
    mask.x + mask.width > textureWidth ||
    mask.y + mask.height > textureHeight
  )
    reject(context, maskPath, `${maskPath} must stay inside its texture atlas.`);
};

const validateAlphaMask = (
  entry: unknown,
  maskPath: string,
  context: ContractContext,
  textureWidth: unknown,
  textureHeight: unknown,
): void => {
  const mask = closedRecord(
    entry,
    maskPath,
    ['id', 'x', 'y', 'width', 'height', 'bits'],
    [],
    context,
  );
  if (!mask) return;
  expectString(mask.id, `${maskPath}.id`, context);
  expectString(mask.bits, `${maskPath}.bits`, context);
  validateMaskIntegers(mask, maskPath, context);
  validateMaskBits(mask, maskPath, context);
  validateMaskBounds(mask, maskPath, context, textureWidth, textureHeight);
};

const validateTextureRaster = (
  value: unknown,
  path: string,
  context: ContractContext,
  textureWidth: unknown,
  textureHeight: unknown,
): void => {
  const record = closedRecord(
    value,
    path,
    ['background', 'backgroundAlpha', 'canvasDetails'],
    ['alphaMode', 'alphaMasks'],
    context,
  );
  if (!record) return;
  const soft = record.alphaMode === 'soft';
  if (hasOwn(record, 'alphaMode')) {
    expectLiteral(record.alphaMode, ['binary', 'soft'], `${path}.alphaMode`, context);
  }
  expectString(record.background, `${path}.background`, context);
  expectFiniteNumber(record.backgroundAlpha, `${path}.backgroundAlpha`, context);
  validateRasterAlpha(record.backgroundAlpha, `${path}.backgroundAlpha`, soft, context);
  const details = expectArray(record.canvasDetails, `${path}.canvasDetails`, context);
  details?.forEach((entry, index) => {
    validateCanvasDetail(entry, `${path}.canvasDetails[${index}]`, soft, context);
  });
  if (!hasOwn(record, 'alphaMasks')) return;
  const masks = expectArray(record.alphaMasks, `${path}.alphaMasks`, context);
  masks?.forEach((entry, index) => {
    const maskPath = `${path}.alphaMasks[${index}]`;
    validateAlphaMask(entry, maskPath, context, textureWidth, textureHeight);
  });
};

const validateTextureMetadata = (value: unknown, path: string, context: ContractContext): void => {
  const metadata = closedRecord(
    value,
    path,
    [],
    ['previewColor', 'canonicalRgbaSha256', 'canonicalPngSha256', 'ashfoxUnlit', 'ashfoxBlendMode'],
    context,
  );
  if (!metadata) return;
  for (const [key, entry] of Object.entries(metadata)) {
    const entryPath = childPath(path, key);
    if (
      typeof entry === 'string' ||
      typeof entry === 'boolean' ||
      (typeof entry === 'number' && Number.isFinite(entry))
    ) {
      continue;
    }
    reject(context, entryPath, `${entryPath} must be a finite JSON scalar.`);
  }
};

const validateTexturePbr = (value: unknown, path: string, context: ContractContext): void => {
  const pbr = closedRecord(
    value,
    path,
    ['roughness', 'metallic'],
    ['metallicRoughnessPngBase64', 'normalPngBase64', 'normalScale'],
    context,
  );
  if (!pbr) return;
  expectFiniteNumber(pbr.roughness, `${path}.roughness`, context);
  if (typeof pbr.roughness === 'number' && (pbr.roughness < 0 || pbr.roughness > 1)) {
    reject(context, `${path}.roughness`, `${path}.roughness must be between 0 and 1.`);
  }
  expectFiniteNumber(pbr.metallic, `${path}.metallic`, context);
  if (typeof pbr.metallic === 'number' && (pbr.metallic < 0 || pbr.metallic > 1)) {
    reject(context, `${path}.metallic`, `${path}.metallic must be between 0 and 1.`);
  }
  if (hasOwn(pbr, 'metallicRoughnessPngBase64')) {
    expectString(pbr.metallicRoughnessPngBase64, `${path}.metallicRoughnessPngBase64`, context);
  }
  if (hasOwn(pbr, 'normalPngBase64')) {
    expectString(pbr.normalPngBase64, `${path}.normalPngBase64`, context);
  }
  if (hasOwn(pbr, 'normalScale')) {
    expectFiniteNumber(pbr.normalScale, `${path}.normalScale`, context);
    if (typeof pbr.normalScale === 'number' && (pbr.normalScale < 0 || pbr.normalScale > 2)) {
      reject(context, `${path}.normalScale`, `${path}.normalScale must be between 0 and 2.`);
    }
  }
};

const validateTexture = (value: unknown, path: string, context: ContractContext): void => {
  const record = closedRecord(
    value,
    path,
    [
      'id',
      'name',
      'width',
      'height',
      'source',
      'visible',
      'sampling',
      'colorSpace',
      'renderMode',
      'renderSides',
    ],
    ['atlasMode', 'pbrChannel', 'pbr', 'raster', 'metadata'],
    context,
  );
  if (!record) return;
  expectString(record.id, `${path}.id`, context);
  expectString(record.name, `${path}.name`, context);
  validateTextureDimension(record.width, `${path}.width`, context);
  validateTextureDimension(record.height, `${path}.height`, context);
  validateBlobRef(record.source, `${path}.source`, context);
  expectBoolean(record.visible, `${path}.visible`, context);
  expectLiteral(record.sampling, ['nearest', 'linear'], `${path}.sampling`, context);
  expectLiteral(record.colorSpace, ['srgb', 'linear'], `${path}.colorSpace`, context);
  expectLiteral(
    record.renderMode,
    ['default', 'emissive', 'additive', 'layered'],
    `${path}.renderMode`,
    context,
  );
  expectLiteral(record.renderSides, ['auto', 'front', 'double'], `${path}.renderSides`, context);
  if (hasOwn(record, 'atlasMode')) {
    expectLiteral(record.atlasMode, ['preserve'], `${path}.atlasMode`, context);
  }
  if (hasOwn(record, 'pbrChannel')) {
    expectLiteral(
      record.pbrChannel,
      ['color', 'normal', 'height', 'mer'],
      `${path}.pbrChannel`,
      context,
    );
  }
  if (hasOwn(record, 'pbr')) {
    validateTexturePbr(record.pbr, `${path}.pbr`, context);
  }
  if (hasOwn(record, 'raster')) {
    validateTextureRaster(record.raster, `${path}.raster`, context, record.width, record.height);
  }
  if (hasOwn(record, 'metadata')) {
    validateTextureMetadata(record.metadata, `${path}.metadata`, context);
  }
};

export const validateTextures = (value: unknown, context: ContractContext): void => {
  if (isClosedContractRecord(value)) {
    const textures = Object.values(value);
    if (textures.length > 64) {
      reject(context, 'textures', 'textures must contain at most 64 assets.');
    }
  }
  validateRecordMap(value, 'textures', context, (entry, path) => {
    validateTexture(entry, path, context);
  });
};
