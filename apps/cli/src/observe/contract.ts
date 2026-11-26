import type {
  AssetDeclarations,
  AssetProject,
  ProjectDocument,
  DirectoryProduct,
  DirectoryFile,
  SpriteProfile,
  SpriteProduct,
} from '@ashfox/engine-core';
export interface SourceInput {
  readonly file?: string;
  readonly source?: string;
  readonly name?: string;
  readonly files?: Readonly<Record<string, string>>;
}
export interface Prepared {
  readonly kind: 'model' | 'sprite' | 'sound' | 'structure';
  readonly revision: string;
  readonly declarations: AssetDeclarations;
  readonly products?: readonly {
    readonly kind: string;
    readonly entry: DirectoryProduct['entry'];
  }[];
  readonly files: readonly DirectoryFile[];
  readonly product?: DirectoryProduct;
  readonly project?: AssetProject;
  readonly document?: ProjectDocument;
  readonly sprite?: {
    readonly profile: SpriteProfile;
    readonly png: Uint8Array;
    readonly rgba: Uint8Array;
    readonly stages: Readonly<Record<'silhouette' | 'shade' | 'grain', Uint8Array>>;
    readonly receipt: SpriteProduct['receipt'];
    readonly evidence: SpriteProduct['evidence'];
    readonly telemetry: SpriteProduct['telemetry'];
  };
}
export interface Media {
  readonly mime: string;
  readonly bytes: Uint8Array;
}
export { DEFAULT_VIEW, type ViewOptions } from '@ashfox/render-core/observation/contract';
