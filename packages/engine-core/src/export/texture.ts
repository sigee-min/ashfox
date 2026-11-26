import type { ProjectDocument, TextureAsset } from '../model';
import { rasterizeTexture } from '../textures/textureRecipe/raster';
import { encodeCanonicalPng, encodeCanonicalPngWithDigest } from '../textures/textureRecipe/png';
import type { BlobCopyExportFile, BinaryExportFile } from './contract';
import type { ExportAdaptedDocument, ExportTextureAsset } from './adapter';

export type MaterializedTextureFile = BlobCopyExportFile | BinaryExportFile;

export const canonicalTextureBytes = (
  document: ProjectDocument,
  texture: TextureAsset,
): Uint8Array => encodeCanonicalPng(rasterizeTexture(document, texture));

/** Inline raster textures are emitted as canonical PNG bytes. External
 * textures remain blob references and must be resolved by the delivery host. */
export const createTextureExportFile = (
  document: ExportAdaptedDocument,
  texture: ExportTextureAsset,
  path: string,
): MaterializedTextureFile => {
  if (texture.raster !== undefined) {
    const { bytes, digest } = encodeCanonicalPngWithDigest(rasterizeTexture(document, texture));
    if (texture.source.contentHash !== digest || texture.source.byteLength !== bytes.byteLength) {
      throw new Error(`Texture "${texture.id}" failed canonical PNG lineage validation.`);
    }
    return {
      kind: 'binary',
      role: 'texture',
      path,
      contentType: 'image/png',
      data: bytes,
    };
  }
  return {
    kind: 'blob-copy',
    role: 'texture',
    path,
    contentType: texture.source.contentType,
    source: texture.source,
  };
};
