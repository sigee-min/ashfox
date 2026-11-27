import type { AssetId, EntityId } from './identity';

export interface BlobRef {
  bucket: string;
  key: string;
  contentType: string;
  contentHash: string;
  byteLength?: number;
}

export interface TextureCanvasDetail {
  id: EntityId;
  color: string;
  /** Explicit alpha (0 or 255 in binary mode; 0..255 in soft alphaMode). */
  alpha: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * A source-owned binary coverage chart bound to an explicit atlas rectangle.
 * The bits are row-major in the rectangle's canonical (top-left) orientation;
 * the compiler normalizes authored UV winding before storing this record.
 */
export interface TextureAlphaMask {
  id: EntityId;
  x: number;
  y: number;
  width: number;
  height: number;
  bits: string;
}

export interface TextureRaster {
  background: string;
  /** Explicit background alpha (0 or 255 in binary mode; 0..255 in soft mode). */
  backgroundAlpha: number;
  alphaMode?: 'binary' | 'soft';
  canvasDetails: readonly TextureCanvasDetail[];
  /** Final alpha-only operations, applied after all color paint. */
  alphaMasks?: readonly TextureAlphaMask[];
}

export interface TextureAsset {
  id: AssetId;
  name: string;
  width: number;
  height: number;
  source: BlobRef;
  visible: boolean;
  sampling: 'nearest' | 'linear';
  colorSpace: 'srgb' | 'linear';
  renderMode: 'default' | 'emissive' | 'additive' | 'layered';
  renderSides: 'auto' | 'front' | 'double';
  /** Explicit source raster; generated atlases are not a document mode. */
  atlasMode?: 'preserve';
  pbrChannel?: 'color' | 'normal' | 'height' | 'mer';
  raster?: TextureRaster;
  metadata?: Readonly<Record<string, string | number | boolean>>;
}
