import type { GifCaptureResult } from '@ashfox/render-core/capture/gifCaptureSurface';
import type { ArtifactFile } from '../files/artifactFile';

export interface GifCaptureFile extends Omit<GifCaptureResult, 'bytes'>, ArtifactFile {
  kind: 'build';
  name: string;
  contentType: 'image/gif';
}

export const isGifCaptureFile = (
  file: ArtifactFile | null
): file is GifCaptureFile =>
  file !== null &&
  file.kind === 'build' &&
  file.contentType === 'image/gif' &&
  'frameCount' in file;
