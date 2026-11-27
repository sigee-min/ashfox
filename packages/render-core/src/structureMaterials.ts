import * as THREE from 'three';

import type { StructureProduct } from '@ashfox/engine-core';

import { createStructureTextureMap } from './sceneMaterials';

type BakedMesh = StructureProduct['bakedMesh'];
type BakedBatch = BakedMesh['batches'][number];

const createSunShaftGradientTexture = (): THREE.DataTexture => {
  const [width, height] = [32, 32];
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const vFalloff = Math.pow(1 - y / (height - 1), 1.65);
    for (let x = 0; x < width; x += 1) {
      const uFalloff = Math.pow(Math.sin((Math.PI * (x + 0.5)) / width), 1.35);
      const alpha = Math.round(255 * vFalloff * uFalloff * 0.85);
      const off = (y * width + x) * 4;
      data[off] = 255;
      data[off + 1] = 255;
      data[off + 2] = 255;
      data[off + 3] = alpha;
    }
  }
  const tex = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
};

const STANDARD_LAYER_PARAMS: Readonly<Record<string, Record<string, unknown>>> = {
  translucent: {
    transparent: true,
    opacity: 0.28,
    depthWrite: false,
    roughness: 0.16,
    metalness: 0.05,
    side: THREE.DoubleSide,
  },
  cutout: {
    alphaTest: 0.5,
    transparent: false,
    depthWrite: true,
    roughness: 0.82,
    metalness: 0.04,
    side: THREE.DoubleSide,
  },
  emissive: { roughness: 0.45, metalness: 0.05, side: THREE.DoubleSide },
  opaque: { roughness: 0.86, metalness: 0.04, side: THREE.FrontSide },
};

const buildBatchMaterial = (
  layer: BakedBatch['layer'],
  map: THREE.Texture | null,
  twilight: boolean,
  clipPlanes: THREE.Plane[] | null,
): THREE.Material => {
  const shared = { map, vertexColors: true, ...(clipPlanes ? { clippingPlanes: clipPlanes } : {}) };
  if (layer === 'sun_shaft') {
    return new THREE.MeshBasicMaterial({
      ...shared,
      transparent: true,
      opacity: 0.36,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
  }
  const extra =
    layer === 'emissive'
      ? {
          emissive: new THREE.Color('#ffbe66'),
          emissiveMap: map,
          emissiveIntensity: twilight ? 2.75 : 1.15,
        }
      : {};
  return new THREE.MeshStandardMaterial({ ...shared, ...STANDARD_LAYER_PARAMS[layer], ...extra });
};

const createBatchMesh = (
  batch: BakedBatch,
  material: THREE.Material,
  disposables: (() => void)[],
): THREE.Mesh => {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(batch.positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(batch.normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(batch.uvs, 2));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(batch.colors, 3));
  geometry.setIndex(batch.indices as number[]);
  geometry.computeBoundingSphere();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.userData = { ashfoxLayer: batch.layer };
  mesh.castShadow = batch.layer === 'opaque' || batch.layer === 'cutout';
  mesh.receiveShadow = batch.layer !== 'sun_shaft';
  if (batch.layer === 'sun_shaft' || batch.layer === 'translucent') mesh.renderOrder = 2;
  disposables.push(() => geometry.dispose());
  return mesh;
};

const resolveBatchTex = (
  batch: BakedBatch,
  bakedMesh: BakedMesh,
  texCache: Map<string, THREE.Texture>,
): THREE.Texture | null => {
  const hit = texCache.get(batch.textureId);
  if (hit) return hit;
  if (batch.layer === 'sun_shaft') {
    const tex = createSunShaftGradientTexture();
    texCache.set(batch.textureId, tex);
    return tex;
  }
  const asset = bakedMesh.textures[batch.textureId];
  if (!asset) return null;
  const tex = createStructureTextureMap(asset);
  texCache.set(batch.textureId, tex);
  return tex;
};

/** Materializes layered structure baked batches and registers textures/materials for disposal. */
export const appendBakedBatches = (
  root: THREE.Group,
  bakedMesh: BakedMesh,
  twilight: boolean,
  clipPlanes: THREE.Plane[] | null,
  disposables: (() => void)[],
): void => {
  const texCache = new Map<string, THREE.Texture>();
  const matCache = new Map<string, THREE.Material>();
  for (const batch of bakedMesh.batches) {
    if (batch.positions.length === 0 || batch.indices.length === 0) continue;
    const map = resolveBatchTex(batch, bakedMesh, texCache);
    const matKey = `${batch.layer}:${batch.textureId}:${twilight ? 1 : 0}`;
    const material =
      matCache.get(matKey) ?? buildBatchMaterial(batch.layer, map, twilight, clipPlanes);
    matCache.set(matKey, material);
    root.add(createBatchMesh(batch, material, disposables));
  }
  disposables.push(() => {
    for (const mat of matCache.values()) mat.dispose();
    for (const tex of texCache.values()) tex.dispose();
  });
};
