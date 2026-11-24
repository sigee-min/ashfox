import type { ProjectDocument } from '../../model';
import { findFullyOccludedCubes } from '../../sceneOcclusion';
import type { FindingSink } from '../contract';

export const validateSceneOcclusion = (document: ProjectDocument, add: FindingSink): void => {
  for (const occlusion of findFullyOccludedCubes(document)) {
    add({
      code: 'cube.fully_occluded',
      severity: 'warning',
      message:
        `Cube "${occlusion.innerId}" is completely hidden inside ` +
        `opaque cube "${occlusion.outerId}".`,
      path: `scene.nodes.${occlusion.innerId}.bounds`,
      entityIds: [occlusion.innerId, occlusion.outerId],
      fix: 'Delete the hidden cube or expose part of it outside the containing cube.',
    });
  }
};
