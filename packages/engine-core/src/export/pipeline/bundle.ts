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

const embeddedGlbImageDigests = (file: ExportFile | undefined): readonly string[] => {
  if (file?.kind !== 'binary' || !file.path.toLowerCase().endsWith('.glb')) {
    return [];
  }
  try {
    const bytes = file.data;
    if (
      bytes.byteLength < 20 ||
      bytes[0] !== 0x67 ||
      bytes[1] !== 0x6c ||
      bytes[2] !== 0x54 ||
      bytes[3] !== 0x46
    )
      return [];
    const readU32 = (offset: number): number =>
      (bytes[offset] ?? 0) |
      ((bytes[offset + 1] ?? 0) << 8) |
      ((bytes[offset + 2] ?? 0) << 16) |
      ((bytes[offset + 3] ?? 0) << 24);
    let offset = 12;
    let json: {
      images?: readonly { bufferView?: number }[];
      bufferViews?: readonly { byteOffset?: number; byteLength?: number }[];
    } | null = null;
    let binary: Uint8Array | null = null;
    while (offset + 8 <= bytes.byteLength) {
      const length = readU32(offset);
      const type = readU32(offset + 4);
      const chunk = bytes.subarray(offset + 8, offset + 8 + length);
      if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(chunk));
      if (type === 0x004e4942) binary = chunk;
      offset += 8 + length;
    }
    if (
      json === null ||
      binary === null ||
      !Array.isArray(json.images) ||
      !Array.isArray(json.bufferViews)
    )
      return [];
    return json.images
      .map((image) => {
        const view =
          typeof image.bufferView === 'number' ? json!.bufferViews![image.bufferView] : undefined;
        if (view === undefined || !Number.isSafeInteger(view.byteLength)) return '';
        const start = Number.isSafeInteger(view.byteOffset) ? view.byteOffset! : 0;
        return sha256ByteDigest(binary!.subarray(start, start + view.byteLength!));
      })
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
  const bytes = file.kind === 'binary' ? file.data : new TextEncoder().encode(file.text);
  return Object.freeze({
    kind: file.kind,
    role: file.role,
    path: file.path,
    contentType: file.contentType,
    sha256: sha256ByteDigest(bytes),
    byteLength: bytes.byteLength,
  });
};

const freezeExportData = <T>(value: T, seen = new WeakSet<object>()): T => {
  if (value === null || typeof value !== 'object' || value instanceof Uint8Array || seen.has(value))
    return value;
  seen.add(value);
  for (const child of Object.values(value as Record<string, unknown>)) {
    freezeExportData(child, seen);
  }
  return Object.freeze(value);
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
    data: freezeExportData(
      snapshotExportData(file.data, 'export.file.data', 'Export JSON file data snapshot failed.'),
    ),
  });
};

export const createExportBundle = (
  document: ExportAdaptedDocument,
  build: AssetBuildIdentity,
  findings: readonly InvariantFinding[],
  content: ExportBundleContent,
): ExportBundle => {
  if (
    content.files.some((file) => file.path === 'ashfox-lineage.json') ||
    new Set(content.files.map((file) => file.path)).size !== content.files.length
  ) {
    throw new TypeError(
      'Export content paths must be unique and cannot claim the lineage manifest.',
    );
  }
  const orderedTextures = Object.values(document.textures).sort((left, right) =>
    left.id.localeCompare(right.id),
  );
  const textureFiles = content.files.filter((file) => file.role === 'texture');
  const embeddedDigests = embeddedGlbImageDigests(
    content.files.find(
      (file) => file.kind === 'binary' && file.path.toLowerCase().endsWith('.glb'),
    ),
  );
  const texturePathById =
    textureFiles.length === orderedTextures.length
      ? new Map(
          orderedTextures.map((texture, index) => [texture.id, textureFiles[index]?.path ?? null]),
        )
      : new Map(orderedTextures.map((texture) => [texture.id, null]));
  const coverageIdsByTexture = new Map<string, Set<string>>();
  for (const texture of orderedTextures) coverageIdsByTexture.set(texture.id, new Set());
  for (const node of Object.values(document.scene.nodes)) {
    if (node.kind !== 'plane') continue;
    for (const face of Object.values(node.faces))
      if (face.enabled && face.textureId !== null)
        coverageIdsByTexture.get(face.textureId)?.add(node.coverageId);
  }
  const target = Object.isFrozen(content.target)
    ? content.target
    : Object.freeze({ ...content.target });
  const lineage = Object.freeze({
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
    textures: Object.freeze(
      orderedTextures.map((texture, index) =>
        Object.freeze({
          id: texture.id,
          path: texturePathById.get(texture.id) ?? null,
          coverageIds: Object.freeze([...(coverageIdsByTexture.get(texture.id) ?? [])].sort()),
          embeddedSha256: embeddedDigests[index] ?? null,
          pngSha256: texture.source.contentType === 'image/png' ? texture.source.contentHash : null,
          byteLength: Number.isSafeInteger(texture.source.byteLength)
            ? texture.source.byteLength!
            : null,
        }),
      ),
    ),
    files: Object.freeze(content.files.map(emittedFileLineage)),
  });
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
    findings: freezeExportData(
      snapshotExportData(findings, 'export.findings', 'Export findings snapshot failed.'),
    ),
    adaptations: freezeExportData(
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

/** Verifies the target envelope and every emitted non-manifest byte. */
export const verifyExportBundleLineage = (bundle: ExportBundle): boolean => {
  if (
    bundle.schemaVersion !== EXPORT_BUNDLE_SCHEMA_VERSION ||
    sealedLineages.get(bundle) !== bundle.lineage ||
    sealedEnvelopes.get(bundle) !== bundleEnvelope(bundle)
  )
    return false;
  const lineage = bundle.lineage;
  if (
    lineage.target.id !== bundle.target.id ||
    lineage.target.version !== bundle.target.version ||
    lineage.projectId !== bundle.projectId ||
    lineage.revision !== bundle.revision ||
    lineage.rootPath !== bundle.rootPath ||
    JSON.stringify(lineage.entrypoints) !== JSON.stringify(bundle.entrypoints)
  ) {
    return false;
  }
  const manifests = bundle.files.filter((file) => file.path === 'ashfox-lineage.json');
  if (
    manifests.length !== 1 ||
    manifests[0]?.kind !== 'json' ||
    manifests[0].text !== stringifyCompactDeterministicJson(manifests[0].data) ||
    JSON.stringify(manifests[0].data) !== JSON.stringify(lineage)
  )
    return false;
  const contentFiles = bundle.files.filter((file) => file.path !== 'ashfox-lineage.json');
  if (
    contentFiles.length !== lineage.files.length ||
    new Set(contentFiles.map((file) => file.path)).size !== contentFiles.length
  ) {
    return false;
  }
  const expected = new Map(lineage.files.map((entry) => [entry.path, entry]));
  if (expected.size !== lineage.files.length) return false;
  for (const file of contentFiles) {
    const entry = expected.get(file.path);
    if (
      entry === undefined ||
      entry.kind !== file.kind ||
      entry.role !== file.role ||
      entry.contentType !== file.contentType
    ) {
      return false;
    }
    if (file.kind === 'json' && file.text !== stringifyCompactDeterministicJson(file.data))
      return false;
    if (file.kind === 'blob-copy') {
      if (
        entry.sha256 !== file.source.contentHash ||
        entry.byteLength !== (file.source.byteLength ?? null)
      )
        return false;
      continue;
    }
    const bytes = file.kind === 'binary' ? file.data : new TextEncoder().encode(file.text);
    if (entry.sha256 !== sha256ByteDigest(bytes) || entry.byteLength !== bytes.byteLength)
      return false;
  }
  if (
    new Set(lineage.textures.map((entry) => entry.id)).size !== lineage.textures.length ||
    lineage.textures.some((entry) => new Set(entry.coverageIds).size !== entry.coverageIds.length)
  )
    return false;
  const embeddedFile = bundle.files.find(
    (file) => file.kind === 'binary' && file.path.toLowerCase().endsWith('.glb'),
  );
  const embeddedDigests = embeddedGlbImageDigests(embeddedFile);
  if (
    embeddedFile !== undefined &&
    (embeddedDigests.length !== lineage.textures.length ||
      lineage.textures.some((entry, index) => entry.embeddedSha256 !== embeddedDigests[index]))
  )
    return false;
  const paths = new Set<string>();
  for (const texture of lineage.textures) {
    if (texture.path === null) continue;
    if (paths.has(texture.path)) return false;
    paths.add(texture.path);
    const file = bundle.files.find((candidate) => candidate.path === texture.path);
    const fileEntry = lineage.files.find((entry) => entry.path === texture.path);
    if (
      file?.role !== 'texture' ||
      fileEntry === undefined ||
      texture.pngSha256 !== fileEntry.sha256 ||
      texture.byteLength !== fileEntry.byteLength
    )
      return false;
  }
  return true;
};
