import * as THREE from 'three';

import type {
  ProjectDocument,
  TextureAsset
} from '@ashfox/engine-core';

import { renderTextureRaster } from './renderTextureRaster';
import type {
  ProjectAsset,
  ProjectAssets
} from './assets';

export interface ProjectMaterialLibrary {
  resolve(
    textureId: string | null,
    lightEmission?: number
  ): THREE.Material;
  ready: Promise<void>;
  dispose(): void;
}

export const materialEmissionIntensity = (
  renderMode: TextureAsset['renderMode'],
  lightEmission = 0
): number =>
  Math.max(
    renderMode === 'emissive' || renderMode === 'additive'
      ? 1.15
      : 0,
    Math.min(15, Math.max(0, lightEmission)) / 6
  );

const previewColor = (texture: TextureAsset): string => {
  const value = texture.metadata?.previewColor;
  return typeof value === 'string' ? value : '#8e98a3';
};

export const configureTextureMap = (
  map: THREE.Texture,
  texture: TextureAsset
): THREE.Texture => {
  map.magFilter =
    texture.sampling === 'nearest'
      ? THREE.NearestFilter
      : THREE.LinearFilter;
  map.minFilter =
    texture.raster?.backgroundAlpha === 0
      ? THREE.NearestFilter
      : texture.sampling === 'nearest'
      ? THREE.NearestMipmapNearestFilter
      : THREE.LinearMipmapLinearFilter;
  map.generateMipmaps = texture.raster?.backgroundAlpha !== 0;
  map.colorSpace =
    texture.colorSpace === 'srgb'
      ? THREE.SRGBColorSpace
      : THREE.NoColorSpace;
  map.needsUpdate = true;
  return map;
};

const createRasterTextureMap = (
  document: ProjectDocument,
  texture: TextureAsset
): THREE.Texture =>
  configureTextureMap(
    new THREE.CanvasTexture(renderTextureRaster(document, texture)),
    texture
  );

const createStoredTextureMap = (
  texture: TextureAsset,
  asset: ProjectAsset
): {
  map: THREE.Texture;
  ready: Promise<void>;
} => {
  const copy = new Uint8Array(asset.bytes);
  const url = URL.createObjectURL(
    new Blob([copy.buffer], { type: asset.contentType })
  );
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
  map = new THREE.TextureLoader().load(url, () => {
    releaseUrl();
    resolveReady?.();
  }, undefined, () => {
    releaseUrl();
    rejectReady?.(
      new Error(`Texture "${texture.name}" could not be decoded.`)
    );
  });
  map.userData.ashfoxObjectUrl = url;
  return {
    map: configureTextureMap(map, texture),
    ready
  };
};

export const createProjectMaterials = (
  document: ProjectDocument,
  assets: ProjectAssets,
  untexturedColor = '#808892',
  showTextures = true
): ProjectMaterialLibrary => {
  const readiness: Promise<void>[] = [];
  const resources = new Map<
    string,
    { texture: TextureAsset; map: THREE.Texture | null }
  >();
  for (const texture of showTextures
    ? Object.values(document.textures)
    : []) {
    let map: THREE.Texture | null;
    if (texture.raster) {
      map = createRasterTextureMap(document, texture);
    } else if (assets[texture.id]) {
      const stored = createStoredTextureMap(
        texture,
        assets[texture.id]
      );
      map = stored.map;
      readiness.push(stored.ready);
    } else {
      map = null;
      readiness.push(Promise.reject(
        new Error(`Texture "${texture.name}" has no local bytes.`)
      ));
    }
    resources.set(texture.id, { texture, map });
  }
  const materials = new Map<string, THREE.Material>();
  const fallback = new THREE.MeshStandardMaterial({
    color: untexturedColor,
    roughness: 0.9
  });

  const resolve = (
    textureId: string | null,
    lightEmission = 0
  ): THREE.Material => {
    if (textureId === null) return fallback;
    const resource = resources.get(textureId);
    if (!resource) return fallback;
    const emission = materialEmissionIntensity(
      resource.texture.renderMode,
      lightEmission
    );
    const key = `${textureId}:${emission}`;
    const cached = materials.get(key);
    if (cached) return cached;
    const additive = resource.texture.renderMode === 'additive';
    const common = {
      color: resource.map ? '#ffffff' : previewColor(resource.texture),
      map: resource.map,
      transparent: additive || resource.texture.raster?.backgroundAlpha === 0,
      blending: additive
        ? THREE.AdditiveBlending
        : THREE.NormalBlending,
      depthWrite: !additive && resource.texture.raster?.backgroundAlpha !== 0,
      side:
        resource.texture.renderSides === 'double'
          ? THREE.DoubleSide
          : THREE.FrontSide
    } as const;
    const material = new THREE.MeshStandardMaterial({
      ...common,
      roughness: 0.84,
      metalness: 0.02,
      emissive:
        emission > 0
          ? resource.map
            ? '#ffffff'
            : previewColor(resource.texture)
          : '#000000',
      emissiveMap: emission > 0 ? resource.map : null,
      emissiveIntensity: emission
    });
    materials.set(key, material);
    return material;
  };

  return {
    resolve,
    ready: Promise.all(readiness).then(() => undefined),
    dispose: () => {
      for (const material of materials.values()) material.dispose();
      fallback.dispose();
      for (const { map } of resources.values()) {
        if (!map) continue;
        const url = map.userData.ashfoxObjectUrl;
        if (typeof url === 'string') URL.revokeObjectURL(url);
        map.dispose();
      }
    }
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
