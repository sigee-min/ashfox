export type FormatDescriptor = {
  id: string;
  name?: string;
  singleTexture?: boolean;
  perTextureUvSize?: boolean;
};

export interface FormatPort {
  listFormats: () => FormatDescriptor[];
  getActiveFormatId: () => string | null;
}
