import type { ProjectDocument, DirectoryProduct, DirectoryFile, SpriteProduct } from '@ashfox/engine-core';
export interface SourceInput {
  readonly file?: string;
  readonly png?: string;
  readonly source?: string;
  readonly name?: string;
  readonly files?: Readonly<Record<string, string>>;
}
export interface Prepared {
  readonly kind: 'model' | 'sprite' | 'sound' | 'png';
  readonly revision: string;
  readonly files: readonly DirectoryFile[];
  readonly product?: DirectoryProduct;
  readonly document?: ProjectDocument;
  readonly sprite?: {readonly png:Uint8Array;readonly stages:Readonly<Record<'silhouette'|'shade'|'grain',Uint8Array>>;readonly receipt:SpriteProduct['receipt'];readonly evidence:SpriteProduct['evidence']};
  readonly png?: string;
}
export interface Media {
  readonly mime: string;
  readonly bytes: Uint8Array;
}
export { DEFAULT_VIEW, type ViewOptions } from '@ashfox/render-core/observation/contract';
