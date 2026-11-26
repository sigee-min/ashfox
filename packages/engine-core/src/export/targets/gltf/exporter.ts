import type { TextureAsset } from '../../../model';
import type { AssetBuildIdentity } from '../../../project/asset';
import type { ExportAdaptedDocument } from '../../adapter';
import { assertValidatedExportTargetDocument, validateExportTarget } from '../../pipeline/validate';
import { type ExportBundle } from '../../contract';
import { compileGltfAnimations } from './animation';
import {
  canonicalTextureBytes,
  createTextureExportFile,
  type MaterializedTextureFile,
} from '../../texture';
import { GltfBinaryWriter } from './binary';
import type { CompiledGltf, GltfBuildOptions } from './build';
import { createGltfBundle } from './bundle';
import { appendHooksToGltfDocument } from './hooksEmit';
import { attachModelLods } from './lodEmit';
import { compressGltfWithMeshopt } from './meshopt';
import {
  orderedTextures,
  requireResolvedTexture,
  resolveGltfTextures,
  type GltfResolvedExportOptions,
} from './textures';
import { compileGltfScene } from './scene';
import type { GltfDocument, GltfImage, GltfMaterial, GltfSampler } from './contract';
import type { UvTransform } from './vertexLayout';

export type { CompiledGltf, GltfBuildOptions } from './build';
export type { GltfResolvedExportOptions } from './textures';

const textureExtension = (texture: TextureAsset): 'png' | 'jpg' =>
  texture.source.contentType === 'image/jpeg' ? 'jpg' : 'png';

const textureMimeType = (texture: TextureAsset): 'image/png' | 'image/jpeg' => {
  if (texture.source.contentType !== 'image/png' && texture.source.contentType !== 'image/jpeg') {
    throw new Error(`Texture "${texture.id}" is not a core glTF PNG or JPEG image.`);
  }
  return texture.source.contentType;
};

const GLTF_UNIT_SCALE = 1 / 16;

export const createGltfMaterial = (
  texture: TextureAsset,
  texIndex: number,
  masked: boolean,
  doubleSided: boolean,
  isEmissive = texture.renderMode === 'emissive',
  uvTransform?: UvTransform,
  name = texture.name,
): GltfMaterial => {
  const ext = uvTransform
    ? {
        KHR_texture_transform: {
          offset: [uvTransform.offset[0], uvTransform.offset[1]] as [number, number],
          scale: [uvTransform.scale[0], uvTransform.scale[1]] as [number, number],
        },
      }
    : undefined;
  return {
    name,
    pbrMetallicRoughness: {
      baseColorTexture: { index: texIndex, ...(ext ? { extensions: ext } : {}) },
      metallicFactor: 0,
      roughnessFactor: 1,
    },
    ...(isEmissive
      ? {
          emissiveTexture: { index: texIndex, ...(ext ? { extensions: ext } : {}) },
          emissiveFactor: [1, 1, 1],
        }
      : {}),
    ...(masked
      ? { alphaMode: 'MASK', alphaCutoff: 0.5 }
      : texture.renderMode === 'additive' || texture.renderMode === 'layered'
        ? { alphaMode: 'BLEND' }
        : {}),
    ...(doubleSided ? { doubleSided: true } : {}),
  };
};

const materialForTexture = (
  texture: TextureAsset,
  index: number,
  masked: boolean,
  forceSingleSided = false,
): GltfMaterial =>
  createGltfMaterial(
    texture,
    index,
    masked,
    texture.renderSides === 'double' && !forceSingleSided,
    texture.renderMode === 'emissive',
    undefined,
    forceSingleSided ? `${texture.name} (front-sided)` : texture.name,
  );

interface CompiledGltfTextures {
  readonly samplers: GltfSampler[];
  readonly materials: GltfMaterial[];
  readonly images: GltfImage[];
  readonly textureFiles: MaterializedTextureFile[];
  readonly materialByTextureId: ReadonlyMap<string, number>;
  readonly singleSidedMaterialByTextureId: ReadonlyMap<string, number>;
}

const collectPlaneTextureIds = (document: ExportAdaptedDocument): ReadonlySet<string> =>
  new Set(
    Object.values(document.scene.nodes).flatMap((node) =>
      node.kind === 'plane'
        ? Object.values(node.faces).flatMap((face) =>
            face.enabled && face.textureId !== null ? [face.textureId] : [],
          )
        : [],
    ),
  );

const textureSampler = (texture: TextureAsset): GltfSampler => {
  const filter = texture.sampling === 'nearest' ? 9728 : 9729;
  return {
    magFilter: filter,
    minFilter: filter,
    wrapS: 10497,
    wrapT: 10497,
  };
};

const embeddedTextureImage = (
  document: ExportAdaptedDocument,
  texture: TextureAsset,
  mimeType: 'image/png' | 'image/jpeg',
  writer: GltfBinaryWriter,
  options: GltfBuildOptions,
): GltfImage => {
  const resolved =
    options.resolvedTextures?.get(texture.id) ??
    (texture.raster !== undefined
      ? { bytes: canonicalTextureBytes(document, texture), contentType: 'image/png' }
      : undefined);
  const checked = requireResolvedTexture(
    texture,
    resolved === undefined ? undefined : new Map([[texture.id, resolved]]),
  );
  return {
    bufferView: writer.addBufferView(checked.bytes),
    mimeType,
    name: texture.name,
  };
};

const compileGltfTextures = (
  document: ExportAdaptedDocument,
  textures: readonly TextureAsset[],
  textureDirectory: string,
  imageStorage: 'embedded' | 'external',
  writer: GltfBinaryWriter,
  options: GltfBuildOptions,
): CompiledGltfTextures => {
  const materialByTextureId = new Map<string, number>();
  const singleSidedMaterialByTextureId = new Map<string, number>();
  const samplers: GltfSampler[] = [];
  const materials: GltfMaterial[] = [];
  const images: GltfImage[] = [];
  const textureFiles: MaterializedTextureFile[] = [];
  const planeTextureIds = collectPlaneTextureIds(document);

  textures.forEach((texture, index) => {
    const mimeType = textureMimeType(texture);
    materialByTextureId.set(texture.id, materials.length);
    samplers.push(textureSampler(texture));
    const masked = planeTextureIds.has(texture.id);
    materials.push(materialForTexture(texture, index, masked));
    if (masked && texture.renderSides === 'double') {
      singleSidedMaterialByTextureId.set(texture.id, materials.length);
      materials.push(materialForTexture(texture, index, true, true));
    }
    if (imageStorage === 'embedded') {
      images.push(embeddedTextureImage(document, texture, mimeType, writer, options));
    } else {
      const extension = textureExtension(texture);
      images.push({
        uri: `textures/texture_${index}.${extension}`,
        mimeType,
        name: texture.name,
      });
      textureFiles.push(
        createTextureExportFile(
          document,
          texture,
          `${textureDirectory}/texture_${index}.${extension}`,
        ),
      );
    }
  });

  return {
    samplers,
    materials,
    images,
    textureFiles,
    materialByTextureId,
    singleSidedMaterialByTextureId,
  };
};

const modelPathInfo = (modelPath: string) => {
  const segments = modelPath.split('/');
  const modelFileName = segments[segments.length - 1];
  const modelDirectory = segments.slice(0, -1).join('/');
  return {
    modelFileName,
    textureDirectory: modelDirectory.length > 0 ? `${modelDirectory}/textures` : 'textures',
  };
};

const assembleGltfDocument = (
  document: ExportAdaptedDocument,
  profile: Extract<ExportAdaptedDocument['formatProfile'], { id: 'gltf.2' }>,
  modelFileName: string,
  writer: GltfBinaryWriter,
  binary: Uint8Array,
  textures: readonly TextureAsset[],
  compiledTextures: CompiledGltfTextures,
  scene: ReturnType<typeof compileGltfScene>,
  animations: ReturnType<typeof compileGltfAnimations>,
): GltfDocument => ({
  asset: {
    version: profile.version,
    generator: 'ashfox engine core',
    ...(profile.copyright ? { copyright: profile.copyright } : {}),
  },
  ...(writer.state.usesMeshQuantization
    ? {
        extensionsUsed: ['KHR_mesh_quantization' as const],
        extensionsRequired: ['KHR_mesh_quantization' as const],
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
            ...(profile.container === 'gltf' ? { uri: `${modelFileName}.bin` } : {}),
          },
        ],
        bufferViews: writer.state.bufferViews,
        accessors: writer.state.accessors,
      }
    : {}),
  ...(scene.meshes.length > 0 ? { meshes: scene.meshes } : {}),
  ...(scene.skins.length > 0 ? { skins: scene.skins } : {}),
  ...(textures.length > 0
    ? {
        images: compiledTextures.images,
        samplers: compiledTextures.samplers,
        textures: textures.map((texture, index) => ({
          sampler: index,
          source: index,
          name: texture.name,
        })),
        materials: compiledTextures.materials,
      }
    : {}),
  ...(animations.length > 0 ? { animations } : {}),
});

export const buildGltf = (
  document: ExportAdaptedDocument,
  options: GltfBuildOptions = {},
): CompiledGltf => {
  assertValidatedExportTargetDocument(document, ['glb', 'gltf']);
  const profile = document.formatProfile;
  if (profile.id !== 'gltf.2') {
    throw new Error('Project does not use the gltf.2 profile.');
  }

  const writer = new GltfBinaryWriter(options.quantize ?? true);
  const { modelFileName, textureDirectory } = modelPathInfo(profile.modelPath);
  const textures = orderedTextures(document);
  const compiledTextures = compileGltfTextures(
    document,
    textures,
    textureDirectory,
    profile.imageStorage,
    writer,
    options,
  );
  const unitScale = GLTF_UNIT_SCALE;
  const scene = compileGltfScene(document, {
    writer,
    materialByTextureId: compiledTextures.materialByTextureId,
    singleSidedMaterialByTextureId: compiledTextures.singleSidedMaterialByTextureId,
    unitScale,
  });
  const animations = compileGltfAnimations(document, {
    writer,
    nodeIndexById: scene.nodeIndexById,
    restTranslationById: scene.restTranslationById,
    restRotationById: scene.restRotationById,
    restScaleById: scene.restScaleById,
    unitScale,
  });
  const binary = writer.toUint8Array();

  return {
    document: assembleGltfDocument(
      document,
      profile,
      modelFileName,
      writer,
      binary,
      textures,
      compiledTextures,
      scene,
      animations,
    ),
    binary,
    textureFiles: compiledTextures.textureFiles,
  };
};

export const exportGltf = (
  document: ExportAdaptedDocument,
  build: AssetBuildIdentity,
): ExportBundle => {
  const validation = validateExportTarget(document, {
    profileId: 'gltf.2',
    errorMessage: 'glTF 2.0 export validation failed.',
  });
  const validatedDocument = validation.document;
  const compiled = attachModelLods(buildGltf(validatedDocument), validatedDocument);
  return createGltfBundle(validatedDocument, build, compiled, validation.findings);
};

export const exportGltfResolved = async (
  document: ExportAdaptedDocument,
  build: AssetBuildIdentity,
  options: GltfResolvedExportOptions,
): Promise<ExportBundle> => {
  const validation = validateExportTarget(document, {
    profileId: 'gltf.2',
    errorMessage: 'glTF 2.0 export validation failed.',
  });
  const validatedDocument = validation.document;
  const profile = validation.profile;
  const encoding = options.encoding ?? 'optimized';
  if (encoding !== 'portable' && encoding !== 'optimized')
    throw new TypeError('Unknown glTF encoding');
  const resolvedTextures =
    profile.imageStorage === 'external'
      ? undefined
      : await resolveGltfTextures(validatedDocument, options.resolveBlob);
  const quantize = encoding !== 'portable';
  const plain = buildGltf(validatedDocument, {
    resolvedTextures,
    quantize,
  });
  const withLod =
    options.includeLods === false ? plain : attachModelLods(plain, validatedDocument, { quantize });
  const withHooks: CompiledGltf = {
    ...withLod,
    document: appendHooksToGltfDocument(withLod.document, options.hooks, {
      unitScale: GLTF_UNIT_SCALE,
    }),
  };
  const compiled = encoding === 'portable' ? withHooks : await compressGltfWithMeshopt(withHooks);
  return createGltfBundle(validatedDocument, build, compiled, validation.findings);
};
