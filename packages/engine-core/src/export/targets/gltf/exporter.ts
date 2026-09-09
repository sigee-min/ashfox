import type {
  TextureAsset
} from '../../../model';
import type { AssetBuildIdentity } from '../../../project/asset';
import type { ExportAdaptedDocument } from '../../adapter';
import { assertValidatedExportTargetDocument,
  validateExportTarget } from '../../pipeline/validate';
import {
  type ExportBundle
} from '../../contract';
import { compileGltfAnimations } from './animation';
import {
  canonicalTextureBytes,
  createTextureExportFile,
  type MaterializedTextureFile
} from '../../texture';
import { GltfBinaryWriter } from './binary';
import type {
  CompiledGltf,
  GltfBuildOptions
} from './build';
import { createGltfBundle } from './bundle';
import { compressGltfWithMeshopt } from './meshopt';
import {
  orderedTextures,
  requireResolvedTexture,
  resolveGltfTextures,
  type GltfResolvedExportOptions
} from './textures';
import { compileGltfScene } from './scene';
import type {
  GltfDocument,
  GltfImage,
  GltfMaterial,
  GltfSampler
} from './contract';

export type {
  CompiledGltf,
  GltfBuildOptions
} from './build';
export type {
  GltfResolvedExportOptions
} from './textures';

const textureExtension = (texture: TextureAsset): 'png' | 'jpg' =>
  texture.source.contentType === 'image/jpeg' ? 'jpg' : 'png';

const textureMimeType = (
  texture: TextureAsset
): 'image/png' | 'image/jpeg' => {
  if (
    texture.source.contentType !== 'image/png' &&
    texture.source.contentType !== 'image/jpeg'
  ) {
    throw new Error(
      `Texture "${texture.id}" is not a core glTF PNG or JPEG image.`
    );
  }
  return texture.source.contentType;
};

const GLTF_UNIT_SCALE = 1 / 16;

const materialForTexture = (texture: TextureAsset, index: number,
  masked: boolean, forceSingleSided = false): GltfMaterial => ({
  name: forceSingleSided ? `${texture.name} (front-sided)` : texture.name,
  pbrMetallicRoughness: {
    baseColorTexture: { index }, metallicFactor: 0, roughnessFactor: 1
  },
  ...(texture.renderMode === 'emissive' ? {
    emissiveTexture: { index }, emissiveFactor: [1, 1, 1]
  } : {}),
  ...(masked ? { alphaMode: 'MASK', alphaCutoff: 0.5 } :
    texture.renderMode === 'additive' || texture.renderMode === 'layered'
      ? { alphaMode: 'BLEND' } : {}),
  ...(texture.renderSides === 'double' && !forceSingleSided
    ? { doubleSided: true } : {})
});

export const buildGltf = (
  document: ExportAdaptedDocument,
  options: GltfBuildOptions = {}
): CompiledGltf => {
  assertValidatedExportTargetDocument(document, ['glb', 'gltf']);
  const profile = document.formatProfile;
  if (profile.id !== 'gltf.2') {
    throw new Error('Project does not use the gltf.2 profile.');
  }

  const writer = new GltfBinaryWriter(options.quantize ?? true);
  const modelPathSegments = profile.modelPath.split('/');
  const modelFileName =
    modelPathSegments[modelPathSegments.length - 1];
  const modelDirectory = modelPathSegments.slice(0, -1).join('/');
  const textureDirectory =
    modelDirectory.length > 0
      ? `${modelDirectory}/textures`
      : 'textures';
  const textures = orderedTextures(document);
  const materialByTextureId = new Map<string, number>();
  const singleSidedMaterialByTextureId = new Map<string, number>();
  const samplers: GltfSampler[] = [];
  const materials: GltfMaterial[] = [];
  const images: GltfImage[] = [];
  const textureFiles: MaterializedTextureFile[] = [];
  const planeTextureIds = new Set(
    Object.values(document.scene.nodes).flatMap((node) =>
      node.kind === 'plane'
        ? Object.values(node.faces).flatMap((face) =>
            face.enabled && face.textureId !== null ? [face.textureId] : []
          )
        : []
    )
  );

  textures.forEach((texture, index) => {
    const mimeType = textureMimeType(texture);
    materialByTextureId.set(texture.id, materials.length);
    samplers.push({
      magFilter: texture.sampling === 'nearest' ? 9728 : 9729,
      minFilter: texture.sampling === 'nearest' ? 9728 : 9729,
      wrapS: 10497,
      wrapT: 10497
    });
    const masked = planeTextureIds.has(texture.id);
    materials.push(materialForTexture(texture, index, masked));
    if (masked && texture.renderSides === 'double') {
      singleSidedMaterialByTextureId.set(texture.id, materials.length);
      materials.push(materialForTexture(texture, index, true, true));
    }
    if (profile.imageStorage === 'embedded') {
      const resolved = options.resolvedTextures?.get(texture.id) ??
        (texture.raster !== undefined
          ? { bytes: canonicalTextureBytes(document, texture),
              contentType: 'image/png' }
          : undefined);
      const checked = requireResolvedTexture(texture,
        resolved === undefined ? undefined : new Map([[texture.id, resolved]]));
      images.push({
        bufferView: writer.addBufferView(checked.bytes),
        mimeType,
        name: texture.name
      });
    } else {
      images.push({
        uri: `textures/texture_${index}.${textureExtension(texture)}`,
        mimeType,
        name: texture.name
      });
      textureFiles.push(createTextureExportFile(document, texture,
        `${textureDirectory}/texture_${index}.${textureExtension(texture)}`));
    }
  });

  const unitScale = GLTF_UNIT_SCALE;
  const scene = compileGltfScene(document, {
    writer,
    materialByTextureId,
    singleSidedMaterialByTextureId,
    unitScale
  });
  const animations = compileGltfAnimations(document, {
    writer,
    nodeIndexById: scene.nodeIndexById,
    restTranslationById: scene.restTranslationById,
    restRotationById: scene.restRotationById,
    restScaleById: scene.restScaleById,
    unitScale
  });
  const binary = writer.toUint8Array();
  const documentData: GltfDocument = {
    asset: {
      version: profile.version,
      generator: 'ashfox engine core',
      ...(profile.copyright ? { copyright: profile.copyright } : {})
    },
    ...(writer.state.usesMeshQuantization
      ? {
          extensionsUsed: ['KHR_mesh_quantization' as const],
          extensionsRequired: ['KHR_mesh_quantization' as const]
        }
      : {}),
    scene: 0,
    scenes: [{ name: document.name, nodes: scene.rootNodeIndices }],
    nodes: scene.nodes,
    ...(binary.byteLength > 0
      ? {
          buffers: [
            {
              byteLength: binary.byteLength,
              ...(profile.container === 'gltf'
                ? { uri: `${modelFileName}.bin` }
                : {})
            }
          ],
          bufferViews: writer.state.bufferViews,
          accessors: writer.state.accessors
        }
      : {}),
    ...(scene.meshes.length > 0 ? { meshes: scene.meshes } : {}),
    ...(scene.skins.length > 0 ? { skins: scene.skins } : {}),
    ...(textures.length > 0
      ? {
          images,
          samplers,
          textures: textures.map((texture, index) => ({
            sampler: index,
            source: index,
            name: texture.name
          })),
          materials
        }
      : {}),
    ...(animations.length > 0 ? { animations } : {})
  };

  return {
    document: documentData,
    binary,
    textureFiles
  };
};

export const exportGltf = (
  document: ExportAdaptedDocument,
  build: AssetBuildIdentity
): ExportBundle => {
  const validation = validateExportTarget(document, {
    profileId: 'gltf.2',
    errorMessage: 'glTF 2.0 export validation failed.'
  });
  const validatedDocument = validation.document;
  const compiled = buildGltf(validatedDocument);
  return createGltfBundle(validatedDocument, build, compiled, validation.findings);
};

export const exportGltfResolved = async (
  document: ExportAdaptedDocument,
  build: AssetBuildIdentity,
  options: GltfResolvedExportOptions
): Promise<ExportBundle> => {
  const validation = validateExportTarget(document, {
    profileId: 'gltf.2',
    errorMessage: 'glTF 2.0 export validation failed.'
  });
  const validatedDocument = validation.document;
  const profile = validation.profile;
  const encoding = options.encoding ?? 'optimized';
  if (encoding !== 'portable' && encoding !== 'optimized') throw new TypeError('Unknown glTF encoding');
  const resolvedTextures = profile.imageStorage === 'external' ? undefined : await resolveGltfTextures(
    validatedDocument, options.resolveBlob
  );
  const plain = buildGltf(validatedDocument, { resolvedTextures, quantize: encoding !== 'portable' });
  const compiled = encoding === 'portable' ? plain : await compressGltfWithMeshopt(plain);
  return createGltfBundle(validatedDocument, build, compiled, validation.findings);
};
