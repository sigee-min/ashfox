import * as THREE from 'three';

import type { ProjectDocument, TextureAsset } from '@ashfox/engine-core';

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

const createStoredTextureMap = (
  texture: TextureAsset,
  asset: ProjectAsset,
): {
  map: THREE.Texture;
  ready: Promise<void>;
} => {
  const copy = new Uint8Array(asset.bytes);
  const url = URL.createObjectURL(new Blob([copy.buffer], { type: asset.contentType }));
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
      rejectReady?.(new Error(`Texture "${texture.name}" could not be decoded.`));
    },
  );
  map.userData.ashfoxObjectUrl = url;
  return {
    map: configureTextureMap(map, texture),
    ready,
  };
};

interface TextureResource {
  texture: TextureAsset;
  map: THREE.Texture | null;
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
    if (texture.raster) {
      map = createRasterTextureMap(document, texture);
    } else if (assets[texture.id]) {
      const stored = createStoredTextureMap(texture, assets[texture.id]);
      map = stored.map;
      readiness.push(stored.ready);
    } else {
      readiness.push(Promise.reject(new Error(`Texture "${texture.name}" has no local bytes.`)));
    }
    resources.set(texture.id, { texture, map });
  }
  return { resources, readiness };
};

const buildStandardMaterial = (
  resource: TextureResource,
  emission: number,
): THREE.MeshStandardMaterial => {
  const additive = resource.texture.renderMode === 'additive';
  const transparent = additive || resource.texture.raster?.backgroundAlpha === 0;
  const baseColor = resource.map ? '#ffffff' : previewColor(resource.texture);
  return new THREE.MeshStandardMaterial({
    color: baseColor,
    map: resource.map,
    transparent,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    depthWrite: !additive && resource.texture.raster?.backgroundAlpha !== 0,
    side: resource.texture.renderSides === 'double' ? THREE.DoubleSide : THREE.FrontSide,
    roughness: 0.84,
    metalness: 0.02,
    emissive: emission > 0 ? baseColor : '#000000',
    emissiveMap: emission > 0 ? resource.map : null,
    emissiveIntensity: emission,
  });
};

const disposeProjectResources = (
  materials: Map<string, THREE.Material>,
  fallback: THREE.Material,
  resources: Map<string, TextureResource>,
): void => {
  for (const material of materials.values()) material.dispose();
  fallback.dispose();
  for (const { map } of resources.values()) {
    if (!map) continue;
    const url = map.userData.ashfoxObjectUrl;
    if (typeof url === 'string') URL.revokeObjectURL(url);
    map.dispose();
  }
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
