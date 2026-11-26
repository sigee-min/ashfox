import { compareText, decodeUtf8, encodeUtf8 } from '@ashfox/internal-contracts';
import { deepFreeze } from '../../immutable';
import type { ExportAdaptedDocument } from '../adapter';
import type { AssetBuildIdentity } from '../../project/asset';
import type { InvariantFinding } from '../../validation/contract';
import { createExportAdaptationReceipt } from '../adaptations';
import { createCompactJsonExportFile, stringifyCompactDeterministicJson } from '../json';
import type { ExportBundle, ExportFile, ExportTargetId } from '../contract';
import { EXPORT_BUNDLE_SCHEMA_VERSION } from '../contract';
import { sha256ByteDigest } from '../../provenance/digest';
import { snapshotExportData } from './dataSnapshot';

const sealedLineages = new WeakMap<object, ExportBundle['lineage']>();
const sealedEnvelopes = new WeakMap<object, string>();

const bundleEnvelope = (bundle: ExportBundle): string =>
  JSON.stringify({
    schemaVersion: bundle.schemaVersion,
    projectId: bundle.projectId,
    revision: bundle.revision,
    target: bundle.target,
    rootPath: bundle.rootPath,
    entrypoints: bundle.entrypoints,
    files: bundle.files.map((file) => ({
      kind: file.kind,
      role: file.role,
      path: file.path,
      contentType: file.contentType,
    })),
    findings: bundle.findings,
    adaptations: bundle.adaptations,
  });

interface GlbJsonImages {
  images?: readonly { bufferView?: number }[];
  bufferViews?: readonly { byteOffset?: number; byteLength?: number }[];
}

const readU32 = (bytes: Uint8Array, offset: number): number =>
  (bytes[offset] ?? 0) |
  ((bytes[offset + 1] ?? 0) << 8) |
  ((bytes[offset + 2] ?? 0) << 16) |
  ((bytes[offset + 3] ?? 0) << 24);

const isGlbHeader = (bytes: Uint8Array): boolean =>
  bytes.byteLength >= 20 &&
  bytes[0] === 0x67 &&
  bytes[1] === 0x6c &&
  bytes[2] === 0x54 &&
  bytes[3] === 0x46;

const parseGlbChunks = (bytes: Uint8Array): { json: GlbJsonImages; binary: Uint8Array } | null => {
  if (!isGlbHeader(bytes)) return null;
  let offset = 12;
  let json: GlbJsonImages | null = null;
  let binary: Uint8Array | null = null;
  while (offset + 8 <= bytes.byteLength) {
    const length = readU32(bytes, offset);
    const type = readU32(bytes, offset + 4);
    const chunk = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === 0x4e4f534a) json = JSON.parse(decodeUtf8(chunk));
    if (type === 0x004e4942) binary = chunk;
    offset += 8 + length;
  }
  if (
    json === null ||
    binary === null ||
    !Array.isArray(json.images) ||
    !Array.isArray(json.bufferViews)
  ) {
    return null;
  }
  return { json, binary };
};

const glbImageDigest = (
  image: { bufferView?: number },
  bufferViews: readonly { byteOffset?: number; byteLength?: number }[],
  binary: Uint8Array,
): string => {
  const view = typeof image.bufferView === 'number' ? bufferViews[image.bufferView] : undefined;
  if (view === undefined || !Number.isSafeInteger(view.byteLength)) return '';
  const start = Number.isSafeInteger(view.byteOffset) ? view.byteOffset! : 0;
  return sha256ByteDigest(binary.subarray(start, start + view.byteLength!));
};

const embeddedGlbImageDigests = (file: ExportFile | undefined): readonly string[] => {
  if (file?.kind !== 'binary' || !file.path.toLowerCase().endsWith('.glb')) {
    return [];
  }
  try {
    const parsed = parseGlbChunks(file.data);
    if (parsed === null) return [];
    const { json, binary } = parsed;
    return json
      .images!.map((image) => glbImageDigest(image, json.bufferViews!, binary))
      .filter((digest) => digest.length > 0);
  } catch {
    return [];
  }
};

export interface ExportBundleContent {
  target: { id: ExportTargetId; version: string };
  rootPath: string;
  entrypoints: readonly string[];
  files: readonly ExportFile[];
}

const emittedFileLineage = (file: ExportFile) => {
  if (file.kind === 'blob-copy')
    return Object.freeze({
      kind: file.kind,
      role: file.role,
      path: file.path,
      contentType: file.contentType,
      sha256: file.source.contentHash,
      byteLength: file.source.byteLength ?? null,
    });
  const bytes = file.kind === 'binary' ? file.data : encodeUtf8(file.text);
  return Object.freeze({
    kind: file.kind,
    role: file.role,
    path: file.path,
    contentType: file.contentType,
    sha256: sha256ByteDigest(bytes),
    byteLength: bytes.byteLength,
  });
};

const snapshotExportFile = (file: ExportFile): ExportFile => {
  if (file.kind === 'binary')
    return Object.freeze({
      ...file,
      data: file.data.slice(),
    });
  if (file.kind === 'blob-copy')
    return Object.freeze({
      ...file,
      source: Object.freeze({ ...file.source }),
    });
  return Object.freeze({
    ...file,
    data: deepFreeze(
      snapshotExportData(file.data, 'export.file.data', 'Export JSON file data snapshot failed.'),
    ),
  });
};

const assertUniqueContentPaths = (files: readonly ExportFile[]): void => {
  if (
    files.some((file) => file.path === 'ashfox-lineage.json') ||
    new Set(files.map((file) => file.path)).size !== files.length
  ) {
    throw new TypeError(
      'Export content paths must be unique and cannot claim the lineage manifest.',
    );
  }
};

const textureCoverageById = (
  document: ExportAdaptedDocument,
  orderedTextures: readonly ExportAdaptedDocument['textures'][string][],
): ReadonlyMap<string, Set<string>> => {
  const coverage = new Map<string, Set<string>>();
  for (const texture of orderedTextures) coverage.set(texture.id, new Set());
  for (const node of Object.values(document.scene.nodes)) {
    if (node.kind !== 'plane') continue;
    for (const face of Object.values(node.faces)) {
      if (face.enabled && face.textureId !== null) {
        coverage.get(face.textureId)?.add(node.coverageId);
      }
    }
  }
  return coverage;
};

const texturePathLookup = (
  orderedTextures: readonly ExportAdaptedDocument['textures'][string][],
  contentFiles: readonly ExportFile[],
): ReadonlyMap<string, string | null> => {
  const textureFiles = contentFiles.filter((file) => file.role === 'texture');
  if (textureFiles.length !== orderedTextures.length) {
    return new Map(orderedTextures.map((texture) => [texture.id, null]));
  }
  return new Map(
    orderedTextures.map((texture, index) => [texture.id, textureFiles[index]?.path ?? null]),
  );
};

const buildTextureLineageEntries = (
  document: ExportAdaptedDocument,
  contentFiles: readonly ExportFile[],
) => {
  const orderedTextures = Object.values(document.textures).sort((left, right) =>
    compareText(left.id, right.id),
  );
  const embeddedDigests = embeddedGlbImageDigests(
    contentFiles.find((file) => file.kind === 'binary' && file.path.toLowerCase().endsWith('.glb')),
  );
  const pathById = texturePathLookup(orderedTextures, contentFiles);
  const coverageById = textureCoverageById(document, orderedTextures);
  return Object.freeze(
    orderedTextures.map((texture, index) =>
      Object.freeze({
        id: texture.id,
        path: pathById.get(texture.id) ?? null,
        coverageIds: Object.freeze([...(coverageById.get(texture.id) ?? [])].sort(compareText)),
        embeddedSha256: embeddedDigests[index] ?? null,
        pngSha256: texture.source.contentType === 'image/png' ? texture.source.contentHash : null,
        byteLength: Number.isSafeInteger(texture.source.byteLength)
          ? texture.source.byteLength!
          : null,
      }),
    ),
  );
};

const buildBundleLineage = (
  document: ExportAdaptedDocument,
  build: AssetBuildIdentity,
  content: ExportBundleContent,
  target: ExportBundleContent['target'],
) =>
  Object.freeze({
    policy: 'ashfox-export-lineage' as const,
    target,
    projectId: document.id,
    revision: document.revision,
    rootPath: content.rootPath,
    entrypoints: Object.freeze([...content.entrypoints]),
    packageName: build.packageName,
    entryName: build.entryName,
    entryPath: build.path,
    workspaceHash: build.workspaceHash,
    closureHash: build.closureHash,
    buildKey: build.buildKey,
    compilerFingerprint: build.compilerFingerprint,
    productHash: build.productHash,
    textures: buildTextureLineageEntries(document, content.files),
    files: Object.freeze(content.files.map(emittedFileLineage)),
  });

export const createExportBundle = (
  document: ExportAdaptedDocument,
  build: AssetBuildIdentity,
  findings: readonly InvariantFinding[],
  content: ExportBundleContent,
): ExportBundle => {
  assertUniqueContentPaths(content.files);
  const target = Object.isFrozen(content.target)
    ? content.target
    : Object.freeze({ ...content.target });
  const lineage = buildBundleLineage(document, build, content, target);
  const lineageFile = snapshotExportFile(
    createCompactJsonExportFile('manifest', 'ashfox-lineage.json', lineage),
  );
  const files = Object.freeze([...content.files.map(snapshotExportFile), lineageFile]);
  const bundle: ExportBundle = Object.freeze({
    schemaVersion: EXPORT_BUNDLE_SCHEMA_VERSION,
    projectId: document.id,
    revision: document.revision,
    target,
    rootPath: content.rootPath,
    entrypoints: Object.freeze([...content.entrypoints]),
    files,
    lineage,
    findings: deepFreeze(
      snapshotExportData(findings, 'export.findings', 'Export findings snapshot failed.'),
    ),
    adaptations: deepFreeze(
      snapshotExportData(
        createExportAdaptationReceipt(document),
        'export.adaptations',
        'Export adaptation snapshot failed.',
      ),
    ),
  });
  sealedLineages.set(bundle, lineage);
  sealedEnvelopes.set(bundle, bundleEnvelope(bundle));
  return bundle;
};

const hasValidBundleHeader = (bundle: ExportBundle): boolean => {
  if (
    bundle.schemaVersion !== EXPORT_BUNDLE_SCHEMA_VERSION ||
    sealedLineages.get(bundle) !== bundle.lineage ||
    sealedEnvelopes.get(bundle) !== bundleEnvelope(bundle)
  ) {
    return false;
  }
  const lineage = bundle.lineage;
  return (
    lineage.target.id === bundle.target.id &&
    lineage.target.version === bundle.target.version &&
    lineage.projectId === bundle.projectId &&
    lineage.revision === bundle.revision &&
    lineage.rootPath === bundle.rootPath &&
    JSON.stringify(lineage.entrypoints) === JSON.stringify(bundle.entrypoints)
  );
};

const hasValidLineageManifest = (bundle: ExportBundle): boolean => {
  const manifests = bundle.files.filter((file) => file.path === 'ashfox-lineage.json');
  return (
    manifests.length === 1 &&
    manifests[0]?.kind === 'json' &&
    manifests[0].text === stringifyCompactDeterministicJson(manifests[0].data) &&
    JSON.stringify(manifests[0].data) === JSON.stringify(bundle.lineage)
  );
};

const contentFileMatchesLineage = (
  file: ExportFile,
  entry: ExportBundle['lineage']['files'][number] | undefined,
): boolean => {
  if (
    entry === undefined ||
    entry.kind !== file.kind ||
    entry.role !== file.role ||
    entry.contentType !== file.contentType
  ) {
    return false;
  }
  if (file.kind === 'json' && file.text !== stringifyCompactDeterministicJson(file.data)) {
    return false;
  }
  if (file.kind === 'blob-copy') {
    return (
      entry.sha256 === file.source.contentHash &&
      entry.byteLength === (file.source.byteLength ?? null)
    );
  }
  const bytes = file.kind === 'binary' ? file.data : encodeUtf8(file.text);
  return entry.sha256 === sha256ByteDigest(bytes) && entry.byteLength === bytes.byteLength;
};

const hasValidContentFiles = (bundle: ExportBundle): boolean => {
  const contentFiles = bundle.files.filter((file) => file.path !== 'ashfox-lineage.json');
  if (
    contentFiles.length !== bundle.lineage.files.length ||
    new Set(contentFiles.map((file) => file.path)).size !== contentFiles.length
  ) {
    return false;
  }
  const expected = new Map(bundle.lineage.files.map((entry) => [entry.path, entry]));
  if (expected.size !== bundle.lineage.files.length) return false;
  return contentFiles.every((file) => contentFileMatchesLineage(file, expected.get(file.path)));
};

const hasValidEmbeddedGlbTextures = (bundle: ExportBundle): boolean => {
  const textures = bundle.lineage.textures;
  if (
    new Set(textures.map((entry) => entry.id)).size !== textures.length ||
    textures.some((entry) => new Set(entry.coverageIds).size !== entry.coverageIds.length)
  ) {
    return false;
  }
  const embeddedFile = bundle.files.find(
    (file) => file.kind === 'binary' && file.path.toLowerCase().endsWith('.glb'),
  );
  if (embeddedFile === undefined) return true;
  const embeddedDigests = embeddedGlbImageDigests(embeddedFile);
  return (
    embeddedDigests.length === textures.length &&
    textures.every((entry, index) => entry.embeddedSha256 === embeddedDigests[index])
  );
};

const hasValidExternalTexturePaths = (bundle: ExportBundle): boolean => {
  const paths = new Set<string>();
  for (const texture of bundle.lineage.textures) {
    if (texture.path === null) continue;
    if (paths.has(texture.path)) return false;
    paths.add(texture.path);
    const file = bundle.files.find((candidate) => candidate.path === texture.path);
    const fileEntry = bundle.lineage.files.find((entry) => entry.path === texture.path);
    if (
      file?.role !== 'texture' ||
      fileEntry === undefined ||
      texture.pngSha256 !== fileEntry.sha256 ||
      texture.byteLength !== fileEntry.byteLength
    ) {
      return false;
    }
  }
  return true;
};

/** Verifies the target envelope and every emitted non-manifest byte. */
export const verifyExportBundleLineage = (bundle: ExportBundle): boolean =>
  hasValidBundleHeader(bundle) &&
  hasValidLineageManifest(bundle) &&
  hasValidContentFiles(bundle) &&
  hasValidEmbeddedGlbTextures(bundle) &&
  hasValidExternalTexturePaths(bundle);
