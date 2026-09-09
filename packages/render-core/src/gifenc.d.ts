declare module 'gifenc' {
  export interface GifFrameOptions {
    palette: readonly (readonly number[])[];
    delay?: number;
    repeat?: number;
    transparent?: boolean;
    transparentIndex?: number;
    dispose?: number;
  }

  export interface GifEncoder {
    writeFrame: (
      indexedPixels: Uint8Array,
      width: number,
      height: number,
      options: GifFrameOptions
    ) => void;
    finish: () => void;
    bytes: () => Uint8Array;
    bytesView: () => Uint8Array;
  }

  export const GIFEncoder: () => GifEncoder;

  export const quantize: (
    rgba: Uint8Array | Uint8ClampedArray,
    maxColors: number,
    options?: {
      format?: 'rgb565' | 'rgb444' | 'rgba4444';
      oneBitAlpha?: boolean;
    }
  ) => number[][];

  export const applyPalette: (
    rgba: Uint8Array | Uint8ClampedArray,
    palette: readonly (readonly number[])[],
    format?: 'rgb565' | 'rgb444' | 'rgba4444'
  ) => Uint8Array;
}
