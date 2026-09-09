import type {
  AssetId,
  ProjectDocument,
  TextureAsset
} from '../../../model';
import {
  BlobResolutionError,
  ExportMaterializationRequiredError,
  type BlobResolver,
  type ResolvedBlob
} from '../../contract';
import { sha256ByteDigest } from '../../../provenance/digest';

export interface GltfResolvedExportOptions {
  resolveBlob: BlobResolver;
  readonly encoding?: 'portable' | 'optimized';
}

const BUILTIN_UINT8_ARRAY_PROTOTYPE = Uint8Array.prototype;

const copyExactBytes = (value: unknown): Uint8Array | null => {
  if (!ArrayBuffer.isView(value) || Object.getPrototypeOf(value) !==
    BUILTIN_UINT8_ARRAY_PROTOTYPE) return null;
  const keys = Reflect.ownKeys(value);
  if (keys.some((key, index) => typeof key !== 'string' ||
    key !== String(index))) return null;
  const result = new Uint8Array(keys.length);
  for (let index = 0; index < keys.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (descriptor === undefined || !descriptor.enumerable ||
      !Object.prototype.hasOwnProperty.call(descriptor, 'value') ||
      typeof descriptor.value !== 'number' ||
      !Number.isSafeInteger(descriptor.value) || descriptor.value < 0 ||
      descriptor.value > 255) return null;
    result[index] = descriptor.value;
  }
  return result;
};

export const orderedTextures = (
  document: ProjectDocument
): TextureAsset[] =>
  Object.values(document.textures).sort((left, right) =>
    left.id.localeCompare(right.id)
  );

export const validateResolvedTexture = (
  texture: TextureAsset,
  resolved: ResolvedBlob
): ResolvedBlob => {
  if (typeof resolved !== 'object' || resolved === null ||
    Object.getPrototypeOf(resolved) !== Object.prototype ||
    Reflect.ownKeys(resolved).length !== 2 ||
    !Object.prototype.hasOwnProperty.call(resolved, 'bytes') ||
    !Object.prototype.hasOwnProperty.call(resolved, 'contentType')) {
    throw new BlobResolutionError(
      'blob.invalid_bytes', texture.id, texture.source,
      `Resolved texture "${texture.id}" must be one exact data object.`
    );
  }
  const bytesDescriptor = Object.getOwnPropertyDescriptor(resolved, 'bytes');
  const typeDescriptor = Object.getOwnPropertyDescriptor(resolved,
    'contentType');
  if (bytesDescriptor === undefined || !bytesDescriptor.enumerable ||
    !('value' in bytesDescriptor) || typeDescriptor === undefined ||
    !typeDescriptor.enumerable || !('value' in typeDescriptor)) {
    throw new BlobResolutionError(
      'blob.invalid_bytes',
      texture.id,
      texture.source,
      `Resolved texture "${texture.id}" did not provide Uint8Array bytes.`
    );
  }
  const bytes = copyExactBytes(bytesDescriptor.value);
  if (bytes === null) throw new BlobResolutionError(
    'blob.invalid_bytes', texture.id, texture.source,
    `Resolved texture "${texture.id}" did not provide exact dense bytes.`);
  const contentType = typeDescriptor.value;
  if (typeof contentType !== 'string') throw new BlobResolutionError(
    'blob.content_type_mismatch', texture.id, texture.source,
    `Resolved texture "${texture.id}" content type must be a primitive string.`);
  if (contentType !== texture.source.contentType) {
    throw new BlobResolutionError(
      'blob.content_type_mismatch',
      texture.id,
      texture.source,
      `Resolved texture "${texture.id}" has content type "${String(contentType)}", expected "${texture.source.contentType}".`
    );
  }
  if (
    texture.source.byteLength !== undefined &&
    bytes.byteLength !== texture.source.byteLength
  ) {
    throw new BlobResolutionError(
      'blob.byte_length_mismatch',
      texture.id,
      texture.source,
      `Resolved texture "${texture.id}" has ${bytes.byteLength} bytes, expected ${texture.source.byteLength}.`
    );
  }
  if (/^sha256:[0-9a-f]{64}$/u.test(texture.source.contentHash) &&
    sha256ByteDigest(bytes) !== texture.source.contentHash) {
    throw new BlobResolutionError(
      'blob.content_hash_mismatch', texture.id, texture.source,
      `Resolved texture "${texture.id}" does not match its SHA-256 authority.`
    );
  }
  return Object.freeze({ bytes, contentType: contentType as string });
};

export const requireResolvedTexture = (
  texture: TextureAsset,
  resolvedTextures: ReadonlyMap<AssetId, ResolvedBlob> | undefined
): ResolvedBlob => {
  const resolved = resolvedTextures?.get(texture.id);
  if (!resolved) {
    throw new ExportMaterializationRequiredError(
      `Embedded GLB export requires resolved bytes for texture "${texture.id}".`
    );
  }
  return validateResolvedTexture(texture, resolved);
};

const resolveTexture = async (
  texture: TextureAsset,
  resolveBlob: BlobResolver
): Promise<readonly [AssetId, ResolvedBlob]> => {
  let resolved: ResolvedBlob | null;
  try {
    resolved = await resolveBlob(texture.source);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new BlobResolutionError(
      'blob.read_failed',
      texture.id,
      texture.source,
      `Failed to resolve texture "${texture.id}": ${reason}`
    );
  }
  if (!resolved) {
    throw new BlobResolutionError(
      'blob.not_found',
      texture.id,
      texture.source,
      `Texture blob "${texture.source.bucket}/${texture.source.key}" was not found.`
    );
  }
  return [texture.id, validateResolvedTexture(texture, resolved)];
};

export const resolveGltfTextures = async (
  document: ProjectDocument,
  resolveBlob: BlobResolver
): Promise<ReadonlyMap<AssetId, ResolvedBlob>> => {
  const entries = await Promise.all(
    orderedTextures(document).map((texture) =>
      resolveTexture(texture, resolveBlob)
    )
  );
  return new Map(entries);
};
