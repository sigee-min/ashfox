import * as THREE from 'three';

import {
  rasterizeCanonicalTexture,
  type ProjectDocument,
  type TextureAsset,
} from '@ashfox/engine-core';

import { renderTextureRaster } from './renderTextureRaster';
import type { ProjectAsset, ProjectAssets } from './assets';

export interface ProjectMaterialLibrary {
  resolve(textureId: string | null, lightEmission?: number): THREE.Material;
  ready: Promise<void>;
  dispose(): void;
}

export const materialEmissionIntensity = (
  renderMode: TextureAsset['renderMode'],
  lightEmission = 0,
): number =>
  Math.max(
    renderMode === 'emissive' || renderMode === 'additive' ? 1.15 : 0,
    Math.min(15, Math.max(0, lightEmission)) / 6,
  );

const previewColor = (texture: TextureAsset): string => {
  const value = texture.metadata?.previewColor;
  return typeof value === 'string' ? value : '#8e98a3';
};

export const configureTextureMap = (map: THREE.Texture, texture: TextureAsset): THREE.Texture => {
  map.magFilter = texture.sampling === 'nearest' ? THREE.NearestFilter : THREE.LinearFilter;
  map.minFilter =
    texture.raster?.backgroundAlpha === 0
      ? THREE.NearestFilter
      : texture.sampling === 'nearest'
        ? THREE.NearestMipmapNearestFilter
        : THREE.LinearMipmapLinearFilter;
  map.generateMipmaps = texture.raster?.backgroundAlpha !== 0;
  map.colorSpace = texture.colorSpace === 'srgb' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  map.needsUpdate = true;
  return map;
};

const createRasterTextureMap = (document: ProjectDocument, texture: TextureAsset): THREE.Texture =>
  configureTextureMap(new THREE.CanvasTexture(renderTextureRaster(document, texture)), texture);

const decodeBase64Png = (encoded: string): Uint8Array => {
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
};

const loadTextureFromBytes = (
  label: string,
  bytes: Uint8Array,
  contentType: string,
  configure: (map: THREE.Texture) => THREE.Texture,
): { map: THREE.Texture; ready: Promise<void> } => {
  const copy = new Uint8Array(bytes);
  const url = URL.createObjectURL(new Blob([copy.buffer], { type: contentType }));
  let map: THREE.Texture;
  const releaseUrl = (): void => {
    URL.revokeObjectURL(url);
    delete map.userData.ashfoxObjectUrl;
  };
  let resolveReady: (() => void) | null = null;
  let rejectReady: ((error: Error) => void) | null = null;
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  map = new THREE.TextureLoader().load(
    url,
    () => {
      releaseUrl();
      resolveReady?.();
    },
    undefined,
    () => {
      releaseUrl();
      rejectReady?.(new Error(`Texture "${label}" could not be decoded.`));
    },
  );
  map.userData.ashfoxObjectUrl = url;
  return { map: configure(map), ready };
};

const configurePbrDataMap = (map: THREE.Texture, texture: TextureAsset): THREE.Texture => {
  const nearest = texture.sampling === 'nearest';
  map.magFilter = nearest ? THREE.NearestFilter : THREE.LinearFilter;
  map.minFilter = nearest ? THREE.NearestFilter : THREE.LinearFilter;
  map.generateMipmaps = false;
  map.colorSpace = THREE.NoColorSpace;
  map.channel = 0;
  map.needsUpdate = true;
  return map;
};

const createStoredTextureMap = (
  texture: TextureAsset,
  asset: ProjectAsset,
): { map: THREE.Texture; ready: Promise<void> } =>
  loadTextureFromBytes(texture.name, asset.bytes, asset.contentType, (map) =>
    configureTextureMap(map, texture),
  );

interface TextureResource {
  texture: TextureAsset;
  map: THREE.Texture | null;
  mrMap: THREE.Texture | null;
}

const collectTextureResources = (
  document: ProjectDocument,
  assets: ProjectAssets,
  showTextures: boolean,
): { resources: Map<string, TextureResource>; readiness: Promise<void>[] } => {
  const readiness: Promise<void>[] = [];
  const resources = new Map<string, TextureResource>();
  for (const texture of showTextures ? Object.values(document.textures) : []) {
    let map: THREE.Texture | null = null;
    let mrMap: THREE.Texture | null = null;
    if (texture.raster) {
      map = createRasterTextureMap(document, texture);
    } else if (assets[texture.id]) {
      const stored = createStoredTextureMap(texture, assets[texture.id]);
      map = stored.map;
      readiness.push(stored.ready);
    } else {
      readiness.push(Promise.reject(new Error(`Texture "${texture.name}" has no local bytes.`)));
    }
    const mrBase64 = texture.pbr?.metallicRoughnessPngBase64;
    if (mrBase64) {
      const mrLoaded = loadTextureFromBytes(
        `${texture.name}_mr`,
        decodeBase64Png(mrBase64),
        'image/png',
        (m) => configurePbrDataMap(m, texture),
      );
      mrMap = mrLoaded.map;
      readiness.push(mrLoaded.ready);
    }
    resources.set(texture.id, { texture, map, mrMap });
  }
  return { resources, readiness };
};

const buildUnlitMaterial = (
  baseColor: string,
  map: THREE.Texture | null,
  additive: boolean,
  premul: boolean,
  side: THREE.Side,
): THREE.MeshBasicMaterial =>
  new THREE.MeshBasicMaterial({
    color: baseColor,
    map,
    transparent: true,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    premultipliedAlpha: premul,
    depthWrite: false,
    side,
    toneMapped: false,
  });

const buildStandardMaterial = (resource: TextureResource, emission: number): THREE.Material => {
  const additive =
    resource.texture.renderMode === 'additive' ||
    resource.texture.metadata?.ashfoxBlendMode === 'additive';
  const unlit = additive || resource.texture.metadata?.ashfoxUnlit === true;
  const softAlpha = resource.texture.raster?.alphaMode === 'soft';
  const transparent = additive || softAlpha || resource.texture.raster?.backgroundAlpha === 0;
  const baseColor = resource.map ? '#ffffff' : previewColor(resource.texture);
  const side = resource.texture.renderSides === 'double' ? THREE.DoubleSide : THREE.FrontSide;
  if (unlit) {
    return buildUnlitMaterial(
      baseColor,
      resource.map,
      additive,
      resource.texture.metadata?.ashfoxBlendMode === 'premul',
      side,
    );
  }
  const pbr = resource.texture.pbr;
  const hasMrMap = resource.mrMap !== null;
  return new THREE.MeshStandardMaterial({
    color: baseColor,
    map: resource.map,
    transparent,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    depthWrite: !additive && !softAlpha && resource.texture.raster?.backgroundAlpha !== 0,
    side,
    roughness: hasMrMap ? 1.0 : (pbr?.roughness ?? 0.88),
    metalness: hasMrMap ? 1.0 : (pbr?.metallic ?? 0.0),
    roughnessMap: resource.mrMap,
    metalnessMap: resource.mrMap,
    aoMap: resource.mrMap,
    aoMapIntensity: hasMrMap ? 0.45 : 0,
    envMapIntensity: 1.15,
    emissive: emission > 0 ? baseColor : '#000000',
    emissiveMap: emission > 0 ? resource.map : null,
    emissiveIntensity: emission,
  });
};

const disposeTextureMap = (map: THREE.Texture | null): void => {
  if (!map) return;
  const url = map.userData.ashfoxObjectUrl;
  if (typeof url === 'string') URL.revokeObjectURL(url);
  map.dispose();
};

const disposeProjectResources = (
  materials: Map<string, THREE.Material>,
  fallback: THREE.Material,
  resources: Map<string, TextureResource>,
): void => {
  for (const material of materials.values()) material.dispose();
  fallback.dispose();
  for (const { map, mrMap } of resources.values()) {
    disposeTextureMap(map);
    disposeTextureMap(mrMap);
  }
};

const createStudioDomeTexture = (): THREE.CanvasTexture => {
  const canvas = window.document.createElement('canvas');
  canvas.width = 16;
  canvas.height = 256;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Studio dome canvas is unavailable.');
  const gradient = context.createLinearGradient(0, 0, 0, canvas.height);
  gradient.addColorStop(0, '#cfd8e6');
  gradient.addColorStop(0.5, '#8c98ab');
  gradient.addColorStop(1, '#555e6c');
  context.fillStyle = gradient;
  context.fillRect(0, 0, canvas.width, canvas.height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  return texture;
};

const addStudioCycloramaDome = (
  envScene: THREE.Scene,
  disposables: { dispose: () => void }[],
): void => {
  const domeTexture = createStudioDomeTexture();
  const domeGeometry = new THREE.SphereGeometry(40, 32, 24);
  const domeMaterial = new THREE.MeshBasicMaterial({
    map: domeTexture,
    side: THREE.BackSide,
    toneMapped: false,
  });
  envScene.add(new THREE.Mesh(domeGeometry, domeMaterial));
  disposables.push(domeTexture, domeGeometry, domeMaterial);
};

const addStudioSoftboxPanel = (
  envScene: THREE.Scene,
  disposables: { dispose: () => void }[],
  color: string,
  intensity: number,
  size: readonly [number, number, number],
  pos: readonly [number, number, number],
): void => {
  const geom = new THREE.BoxGeometry(size[0], size[1], size[2]);
  const mat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(color).multiplyScalar(intensity),
    toneMapped: false,
  });
  const mesh = new THREE.Mesh(geom, mat);
  mesh.position.set(pos[0], pos[1], pos[2]);
  envScene.add(mesh);
  disposables.push(geom, mat);
};

/** Generates a bright neutral studio cyclorama dome PMREM IBL environment texture. */
export const createStudioEnvironmentMap = (
  renderer: THREE.WebGLRenderer,
): THREE.WebGLRenderTarget => {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  envScene.background = new THREE.Color('#8c98ab');
  const disposables: { dispose: () => void }[] = [];
  addStudioCycloramaDome(envScene, disposables);
  addStudioSoftboxPanel(envScene, disposables, '#fff5e6', 3.4, [12, 0.5, 12], [4, 9, -4]);
  addStudioSoftboxPanel(envScene, disposables, '#dce9ff', 2.2, [10, 8, 0.5], [-8, 4, -6]);
  addStudioSoftboxPanel(envScene, disposables, '#e4eefc', 1.8, [0.5, 8, 12], [9, 3, 4]);
  addStudioSoftboxPanel(envScene, disposables, '#6c7686', 1.2, [18, 0.5, 18], [0, -8, 0]);
  const target = pmrem.fromScene(envScene, 0.04);
  for (const item of disposables) item.dispose();
  pmrem.dispose();
  return target;
};

export const createProjectMaterials = (
  document: ProjectDocument,
  assets: ProjectAssets,
  untexturedColor = '#808892',
  showTextures = true,
): ProjectMaterialLibrary => {
  const { resources, readiness } = collectTextureResources(document, assets, showTextures);
  const materials = new Map<string, THREE.Material>();
  const fallback = new THREE.MeshStandardMaterial({ color: untexturedColor, roughness: 0.9 });

  const resolve = (textureId: string | null, lightEmission = 0): THREE.Material => {
    const resource = textureId === null ? undefined : resources.get(textureId);
    if (!resource) return fallback;
    const emission = materialEmissionIntensity(resource.texture.renderMode, lightEmission);
    const key = `${textureId}:${emission}`;
    const existing = materials.get(key);
    if (existing) return existing;
    const material = buildStandardMaterial(resource, emission);
    materials.set(key, material);
    return material;
  };

  return {
    resolve,
    ready: Promise.all(readiness).then(() => undefined),
    dispose: () => disposeProjectResources(materials, fallback, resources),
  };
};

export const disposeMaterial = (material: THREE.Material): void => {
  if ('map' in material) {
    const map = material.map as THREE.Texture | null;
    const url = map?.userData.ashfoxObjectUrl;
    if (typeof url === 'string') URL.revokeObjectURL(url);
    map?.dispose();
  }
  material.dispose();
};

/** Materializes a repeatable nearest-filtered CanvasTexture for StructureBakedMesh batches. */
export const createStructureTextureMap = (texture: TextureAsset): THREE.Texture => {
  const canvas = window.document.createElement('canvas');
  canvas.width = Math.max(1, texture.width);
  canvas.height = Math.max(1, texture.height);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Structure texture canvas is unavailable.');
  if (texture.raster) {
    const raster = rasterizeCanonicalTexture(texture.width, texture.height, {
      background: texture.raster.background,
      backgroundAlpha: texture.raster.backgroundAlpha,
      canvasDetails: texture.raster.canvasDetails,
      alphaMasks: texture.raster.alphaMasks ?? [],
    });
    const image = context.createImageData(raster.width, raster.height);
    image.data.set(raster.rgba.copy());
    context.putImageData(image, 0, 0);
  } else {
    context.fillStyle = previewColor(texture);
    context.fillRect(0, 0, canvas.width, canvas.height);
  }
  const map = new THREE.CanvasTexture(canvas);
  map.magFilter = THREE.NearestFilter;
  map.minFilter = THREE.NearestFilter;
  map.generateMipmaps = false;
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.flipY = false;
  map.colorSpace = texture.colorSpace === 'srgb' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  map.needsUpdate = true;
  return map;
};
