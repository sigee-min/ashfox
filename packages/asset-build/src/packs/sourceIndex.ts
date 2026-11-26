import type { CatalogAsset } from '../bundle/contract';

export interface IndexedCatalogAssetFiles {
  readonly glbPath?: string;
  readonly structureMetaPath?: string;
  readonly pngPath?: string;
  readonly wavPaths: ReadonlyMap<string, string>;
}

/** Pre-index an asset's file paths by extension and WAV variant id for O(1) lookup. */
export const indexCatalogAssetFiles = (asset: CatalogAsset): IndexedCatalogAssetFiles => {
  let glbPath: string | undefined;
  let structureMetaPath: string | undefined;
  let pngPath: string | undefined;
  const wavPaths = new Map<string, string>();
  for (const file of asset.files) {
    if (glbPath === undefined && file.path.endsWith('.glb')) glbPath = file.path;
    else if (structureMetaPath === undefined && file.path.endsWith('.structure.json'))
      structureMetaPath = file.path;
    else if (pngPath === undefined && file.path.endsWith('.png')) pngPath = file.path;
    else if (file.path.endsWith('.wav')) {
      const slash = file.path.lastIndexOf('/');
      const variantId = file.path.slice(slash + 1, -4);
      if (slash >= 0 && !wavPaths.has(variantId)) wavPaths.set(variantId, file.path);
    }
  }
  return { glbPath, structureMetaPath, pngPath, wavPaths };
};
