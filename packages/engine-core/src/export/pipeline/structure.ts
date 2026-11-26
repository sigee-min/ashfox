import type { StructureProduct } from '../../compiler/structure/contract';
import { encodeCanonicalPng } from '../../textures/textureRecipe/png';
import { rasterizeTexture } from '../../textures/textureRecipe/raster';
import { sealCanonicalBoneFrame, type ProjectDocument } from '../../model';
import { sha256Digest } from '../../provenance/digest';
import type { AssetBuildIdentity } from '../../project/asset';
import { adaptProjectForExport } from '../adapter';
import type { BinaryExportFile, ExportBundle } from '../contract';
import { createCompactJsonExportFile } from '../json';
import { exportGltfResolved } from '../targets/gltf/exporter';
import { buildGlb } from '../targets/gltf/glb';
import { compressGltfWithMeshopt } from '../targets/gltf/meshopt';
import { buildStructureGltf } from '../targets/gltf/structureGltf';
import { createExportBundle } from './bundle';
import { snapshotExportData } from './dataSnapshot';

export interface StructureGltfOptions {
  readonly encoding?: 'portable' | 'optimized';
}

const isStructureProduct = (value: StructureProduct | ProjectDocument): value is StructureProduct =>
  'bakedMesh' in value && 'playableMeta' in value;

const structureBuildIdentity = (
  name: string,
  modelPath: string,
  buildKey: string,
): AssetBuildIdentity => {
  const digestHex = sha256Digest(`structure:${modelPath}:${buildKey}`).replace(/^sha256:/u, '');
  const digest = `sha256:${digestHex}` as const;
  return {
    packageName: 'structure',
    entryName: name,
    path: name,
    workspaceHash: digest,
    closureHash: digest,
    buildKey: digest,
    compilerFingerprint: buildKey,
    productHash: digest,
  };
};

const exportBakedStructureBundle = async (
  product: StructureProduct,
  modelPath: string,
  buildKey: string,
  encoding: 'portable' | 'optimized',
): Promise<ExportBundle> => {
  const { compiled, textures } = buildStructureGltf(product, {
    quantize: encoding !== 'portable',
  });
  const finalGltf = encoding === 'portable' ? compiled : await compressGltfWithMeshopt(compiled);
  const snapshot = snapshotExportData(
    { ...product.document, textures },
    'structure.document',
    'Structure document snapshot failed.',
  );
  for (const node of Object.values(snapshot.scene.nodes)) {
    if (node.kind === 'bone') sealCanonicalBoneFrame(node);
  }
  const adapted = adaptProjectForExport(snapshot, { target: 'glb', modelPath });
  const build = structureBuildIdentity(snapshot.name, modelPath, buildKey);
  const glbPath = `${modelPath}.glb`;
  const glbFile: BinaryExportFile = {
    kind: 'binary',
    role: 'model',
    path: glbPath,
    contentType: 'model/gltf-binary',
    data: buildGlb(finalGltf.document, finalGltf.binary),
  };
  const metaFile = createCompactJsonExportFile(
    'manifest',
    `${modelPath}.structure.json`,
    product.playableMeta,
  );
  return createExportBundle(adapted, build, [], {
    target: { id: 'gltf.2', version: '2.0' },
    rootPath: 'gltf',
    entrypoints: [glbPath],
    files: [glbFile, metaFile],
  });
};

export async function exportStructureGltfResolved(
  input: StructureProduct | ProjectDocument,
  modelPath: string,
  buildKey: string,
  options: StructureGltfOptions = {},
): Promise<ExportBundle> {
  const encoding = options.encoding ?? 'portable';
  if (isStructureProduct(input)) {
    return exportBakedStructureBundle(input, modelPath, buildKey, encoding);
  }
  const snapshot = snapshotExportData(
    input,
    'structure.document',
    'Structure document snapshot failed.',
  );
  for (const node of Object.values(snapshot.scene.nodes)) {
    if (node.kind === 'bone') sealCanonicalBoneFrame(node);
  }
  const adapted = adaptProjectForExport(snapshot, { target: 'glb', modelPath });
  const build = structureBuildIdentity(snapshot.name, modelPath, buildKey);
  const textures = new Map(Object.values(snapshot.textures).map((t) => [t.source.key, t]));
  return exportGltfResolved(adapted, build, {
    encoding,
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
