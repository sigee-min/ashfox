import { encodeCanonicalPng } from '../../textures/textureRecipe/png';
import { rasterizeTexture } from '../../textures/textureRecipe/raster';
import { sealCanonicalBoneFrame, type ProjectDocument } from '../../model';
import { sha256Digest } from '../../provenance/digest';
import type { AssetBuildIdentity } from '../../project/asset';
import { adaptProjectForExport } from '../adapter';
import type { ExportBundle } from '../contract';
import { exportGltfResolved } from '../targets/gltf/exporter';
import { snapshotExportData } from './dataSnapshot';

export interface StructureGltfOptions {
  readonly encoding?: 'portable' | 'optimized';
}

export async function exportStructureGltfResolved(
  document: ProjectDocument,
  modelPath: string,
  buildKey: string,
  options: StructureGltfOptions = {},
): Promise<ExportBundle> {
  const snapshot = snapshotExportData(
    document,
    'structure.document',
    'Structure document snapshot failed.',
  );
  for (const node of Object.values(snapshot.scene.nodes)) {
    if (node.kind === 'bone') sealCanonicalBoneFrame(node);
  }
  const adapted = adaptProjectForExport(snapshot, { target: 'glb', modelPath });
  const digestHex = sha256Digest(`structure:${modelPath}:${buildKey}`).replace(/^sha256:/u, '');
  const digest = `sha256:${digestHex}` as const;
  const build: AssetBuildIdentity = {
    packageName: 'structure',
    entryName: snapshot.name,
    path: snapshot.name,
    workspaceHash: digest,
    closureHash: digest,
    buildKey: digest,
    compilerFingerprint: buildKey,
    productHash: digest,
  };
  const textures = new Map(Object.values(snapshot.textures).map((t) => [t.source.key, t]));
  return exportGltfResolved(adapted, build, {
    encoding: options.encoding ?? 'portable',
    resolveBlob: async (ref) => {
      const texture = textures.get(ref.key);
      return texture
        ? {
            bytes: encodeCanonicalPng(rasterizeTexture(snapshot, texture)),
            contentType: 'image/png',
          }
        : null;
    },
  });
}
