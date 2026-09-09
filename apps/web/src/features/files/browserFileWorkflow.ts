import {
  exportProductionProjectResolved,
  encodeCanonicalPng,
  rasterizeTexture,
  type AssetProject,
  type BlobRef,
  type ExportAdapterInput,
  type ExportBundle,
  type ExportFile,
  type ProjectDocument,
  type ResolvedBlob,
  type TextureAsset
} from '@ashfox/engine-core';

import type {
  ProjectAsset,
  ProjectAssets
} from '@ashfox/render-core/assets';
import type { TargetArtifactData } from './artifact/contract';
import {
  artifactContentHash,
  createSealedTargetArtifact,
  prepareTargetArtifactDocument,
} from './artifactFile';

export type TargetArtifactFile = TargetArtifactData;

const textureForSource = (
  document: ProjectDocument,
  source: BlobRef
): TextureAsset | undefined => Object.values(document.textures).find(
  (texture) => texture.source.bucket === source.bucket &&
    texture.source.key === source.key
);

const authoredRasterPng = async (
  document: ProjectDocument,
  texture: TextureAsset
): Promise<ProjectAsset> => {
  if (texture.source.contentType !== 'image/png') throw new Error(
    `Authored raster "${texture.name}" requires PNG materialization; received ${texture.source.contentType}.`
  );
  return {
    bytes: encodeCanonicalPng(rasterizeTexture(document, texture)),
    contentType: 'image/png'
  };
};

const resolveTextureAsset = async (
  document: ProjectDocument,
  texture: TextureAsset,
  assets: ProjectAssets
): Promise<ProjectAsset> => {
  if (texture.raster) return authoredRasterPng(document, texture);
  const stored = assets[texture.id];
  if (!stored) throw new Error(
    `Preserved texture "${texture.name}" is missing its imported bytes.`
  );
  if (stored.contentType !== texture.source.contentType) throw new Error(
    `Preserved texture "${texture.name}" MIME type does not match its source metadata.`
  );
  const bytes = new Uint8Array(stored.bytes);
  if (bytes.byteLength === 0 || texture.source.byteLength !== undefined &&
      texture.source.byteLength !== bytes.byteLength) throw new Error(
    `Preserved texture "${texture.name}" byte length does not match its source metadata.`
  );
  if (await artifactContentHash(bytes) !== texture.source.contentHash) throw new Error(
    `Preserved texture "${texture.name}" content hash does not match its source metadata.`
  );
  return { contentType: stored.contentType, bytes };
};

const resolveTexture = async (
  document: ProjectDocument,
  assets: ProjectAssets,
  source: BlobRef
): Promise<ResolvedBlob | null> => {
  const texture = textureForSource(document, source);
  return texture === undefined ? null : resolveTextureAsset(document, texture, assets);
};

const createExportBundle = async (
  project: AssetProject,
  assets: ProjectAssets,
  adapter: ExportAdapterInput
): Promise<{ document: ProjectDocument; bundle: ExportBundle }> => {
  const document = prepareTargetArtifactDocument(project.document);
  const bundle = await exportProductionProjectResolved(
    project,
    adapter,
    { resolveBlob: (source) => resolveTexture(document, assets, source) }
  );
  return { document, bundle };
};

const fileBytes = async (
  document: ProjectDocument,
  assets: ProjectAssets,
  file: ExportFile
): Promise<Uint8Array> => {
  switch (file.kind) {
    case 'json':
      return new TextEncoder().encode(file.text);
    case 'binary':
      return file.data;
    case 'blob-copy': {
      const resolved = await resolveTexture(document, assets, file.source);
      if (!resolved) throw new Error(`Texture source for "${file.path}" is unavailable.`);
      return resolved.bytes;
    }
  }
};

export const createTargetArtifact = async (
  project: AssetProject,
  assets: ProjectAssets,
  adapter: ExportAdapterInput
): Promise<TargetArtifactFile> => {
  const prepared = await createExportBundle(project, assets, adapter);
  const { bundle } = prepared;
  const entries = await Promise.all(bundle.files.map(async (file) => ({
    path: file.path,
    bytes: await fileBytes(prepared.document, assets, file)
  })));
  return createSealedTargetArtifact(
    project, bundle, prepared.document, entries);
};
