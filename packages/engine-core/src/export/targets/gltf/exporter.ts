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
import { decodeBase64Bytes } from '../../../textures/textureRecipe/base64';
import { createGltfMaterial } from './material';
import { compileGltfScene } from './scene';
import type { GltfDocument, GltfImage, GltfMaterial, GltfSampler, GltfTexture } from './contract';

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

const materialForTexture = (
  texture: TextureAsset,
  index: number,
  masked: boolean,
  forceSingleSided = false,
  mrTexIndex?: number,
  normalTexIndex?: number,
): GltfMaterial =>
  createGltfMaterial(
    texture,
    index,
    masked,
    texture.renderSides === 'double' && !forceSingleSided,
    texture.renderMode === 'emissive',
    undefined,
    forceSingleSided ? `${texture.name} (front-sided)` : texture.name,
    mrTexIndex,
    normalTexIndex,
  );

interface CompiledGltfTextures {
  readonly samplers: GltfSampler[];
  readonly materials: GltfMaterial[];
  readonly images: GltfImage[];
  readonly gltfTextures: GltfTexture[];
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

const appendAuxPbrTexture = (
  texture: TextureAsset,
  index: number,
  suffix: string,
  base64: string | undefined,
  textureDirectory: string,
  imageStorage: 'embedded' | 'external',
  writer: GltfBinaryWriter,
  samplers: GltfSampler[],
  images: GltfImage[],
  gltfTextures: GltfTexture[],
  textureFiles: MaterializedTextureFile[],
): number | undefined => {
  if (!base64) return undefined;
  const bytes = decodeBase64Bytes(base64);
  const samplerIdx = samplers.length;
  samplers.push(textureSampler(texture));
  const imgIdx = images.length;
  const label = `${texture.name}_${suffix}`;
  if (imageStorage === 'embedded') {
    images.push({
      bufferView: writer.addBufferView(bytes),
      mimeType: 'image/png',
      name: label,
    });
  } else {
    images.push({
      uri: `textures/texture_${index}_${suffix}.png`,
      mimeType: 'image/png',
      name: label,
    });
    textureFiles.push({
      kind: 'binary',
      role: 'texture',
      path: `${textureDirectory}/texture_${index}_${suffix}.png`,
      contentType: 'image/png',
      data: bytes,
    });
  }
  const texIdx = gltfTextures.length;
  gltfTextures.push({ sampler: samplerIdx, source: imgIdx, name: label });
  return texIdx;
};

const appendColorTexture = (
  document: ExportAdaptedDocument,
  texture: TextureAsset,
  index: number,
  textureDirectory: string,
  imageStorage: 'embedded' | 'external',
  writer: GltfBinaryWriter,
  options: GltfBuildOptions,
  samplers: GltfSampler[],
  images: GltfImage[],
  gltfTextures: GltfTexture[],
  textureFiles: MaterializedTextureFile[],
): number => {
  const mimeType = textureMimeType(texture);
  const samplerIdx = samplers.length;
  samplers.push(textureSampler(texture));
  const imageIdx = images.length;
  if (imageStorage === 'embedded') {
    images.push(embeddedTextureImage(document, texture, mimeType, writer, options));
  } else {
    const extension = textureExtension(texture);
    images.push({ uri: `textures/texture_${index}.${extension}`, mimeType, name: texture.name });
    textureFiles.push(
      createTextureExportFile(
        document,
        texture,
        `${textureDirectory}/texture_${index}.${extension}`,
      ),
    );
  }
  const baseTexIdx = gltfTextures.length;
  gltfTextures.push({ sampler: samplerIdx, source: imageIdx, name: texture.name });
  return baseTexIdx;
};

const appendPbrTexturesForEntry = (
  texture: TextureAsset,
  index: number,
  textureDirectory: string,
  imageStorage: 'embedded' | 'external',
  writer: GltfBinaryWriter,
  acc: Omit<CompiledGltfTextures, 'materialByTextureId' | 'singleSidedMaterialByTextureId'>,
): Readonly<{ readonly mrTexIdx?: number; readonly normalTexIdx?: number }> => ({
  mrTexIdx: appendAuxPbrTexture(
    texture,
    index,
    'mr',
    texture.pbr?.metallicRoughnessPngBase64,
    textureDirectory,
    imageStorage,
    writer,
    acc.samplers,
    acc.images,
    acc.gltfTextures,
    acc.textureFiles,
  ),
  normalTexIdx: appendAuxPbrTexture(
    texture,
    index,
    'normal',
    texture.pbr?.normalPngBase64,
    textureDirectory,
    imageStorage,
    writer,
    acc.samplers,
    acc.images,
    acc.gltfTextures,
    acc.textureFiles,
  ),
});

const compileSingleGltfTexture = (
  document: ExportAdaptedDocument,
  texture: TextureAsset,
  index: number,
  textureDirectory: string,
  imageStorage: 'embedded' | 'external',
  writer: GltfBinaryWriter,
  options: GltfBuildOptions,
  planeTextureIds: ReadonlySet<string>,
  acc: Omit<CompiledGltfTextures, 'materialByTextureId' | 'singleSidedMaterialByTextureId'>,
  materialByTextureId: Map<string, number>,
  singleSidedMaterialByTextureId: Map<string, number>,
): void => {
  materialByTextureId.set(texture.id, acc.materials.length);
  const baseTexIdx = appendColorTexture(
    document,
    texture,
    index,
    textureDirectory,
    imageStorage,
    writer,
    options,
    acc.samplers,
    acc.images,
    acc.gltfTextures,
    acc.textureFiles,
  );
  const { mrTexIdx, normalTexIdx } = appendPbrTexturesForEntry(
    texture,
    index,
    textureDirectory,
    imageStorage,
    writer,
    acc,
  );
  const masked = planeTextureIds.has(texture.id);
  acc.materials.push(
    materialForTexture(texture, baseTexIdx, masked, false, mrTexIdx, normalTexIdx),
  );
  if (masked && texture.renderSides === 'double') {
    singleSidedMaterialByTextureId.set(texture.id, acc.materials.length);
    acc.materials.push(materialForTexture(texture, baseTexIdx, true, true, mrTexIdx, normalTexIdx));
  }
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
  const acc = {
    samplers: [] as GltfSampler[],
    materials: [] as GltfMaterial[],
    images: [] as GltfImage[],
    gltfTextures: [] as GltfTexture[],
    textureFiles: [] as MaterializedTextureFile[],
  };
  const planeTextureIds = collectPlaneTextureIds(document);
  textures.forEach((texture, index) =>
    compileSingleGltfTexture(
      document,
      texture,
      index,
      textureDirectory,
      imageStorage,
      writer,
      options,
      planeTextureIds,
      acc,
      materialByTextureId,
      singleSidedMaterialByTextureId,
    ),
  );
  return { ...acc, materialByTextureId, singleSidedMaterialByTextureId };
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
): GltfDocument => {
  const usesUnlit = compiledTextures.materials.some(
    (m) => m.extensions?.KHR_materials_unlit !== undefined,
  );
  const extensionsUsed: GltfDocument['extensionsUsed'] = [
    ...(writer.state.usesMeshQuantization ? (['KHR_mesh_quantization'] as const) : []),
    ...(usesUnlit ? (['KHR_materials_unlit'] as const) : []),
  ];
  return {
    asset: {
      version: profile.version,
      generator: 'ashfox engine core',
      ...(profile.copyright ? { copyright: profile.copyright } : {}),
    },
    ...(extensionsUsed.length > 0 ? { extensionsUsed } : {}),
    ...(writer.state.usesMeshQuantization
      ? { extensionsRequired: ['KHR_mesh_quantization' as const] }
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
          textures: compiledTextures.gltfTextures,
          materials: compiledTextures.materials,
        }
      : {}),
    ...(animations.length > 0 ? { animations } : {}),
  };
};

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
  const normalMaterialIndices = new Set<number>();
  compiledTextures.materials.forEach((m, idx) => {
    if (m.normalTexture !== undefined) normalMaterialIndices.add(idx);
  });
  const scene = compileGltfScene(document, {
    writer,
    materialByTextureId: compiledTextures.materialByTextureId,
    singleSidedMaterialByTextureId: compiledTextures.singleSidedMaterialByTextureId,
    normalMaterialIndices,
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
