export interface ProjectAsset {
  contentType: string;
  bytes: Uint8Array;
}

export type ProjectAssets = Readonly<Record<string, ProjectAsset>>;
