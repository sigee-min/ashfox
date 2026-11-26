import type { ProjectDocument } from '@ashfox/engine-core';

import type { ProjectAssets } from '../assets';
import { projectToThreeScene } from '../projection';
import type { ProjectSceneProjection } from '../sceneTypes';

export interface CaptureProjectionOptions {
  showTextures?: boolean;
}

export const createCaptureProjection = (
  document: ProjectDocument,
  assets: ProjectAssets,
  options: CaptureProjectionOptions = {},
): ProjectSceneProjection =>
  projectToThreeScene(document, {
    assets,
    showSkeleton: false,
    showTextures: options.showTextures,
    showWireframe: false,
    untexturedColor: '#b59a74',
  });
