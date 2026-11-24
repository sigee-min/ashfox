import type { ProjectDocument } from '../../model';
import type { FindingSink, IdRegistrar } from '../contract';
import { validateAnimationClip } from './clip';

export const validateAnimations = (
  document: ProjectDocument,
  add: FindingSink,
  registerId: IdRegistrar,
): void => {
  for (const [clipKey, clip] of Object.entries(document.animations)) {
    const path = `animations.${clipKey}`;
    registerId(clip.id, path);
    if (clipKey !== clip.id) {
      add({
        code: 'identity.key_mismatch',
        severity: 'error',
        message: `Animation map key "${clipKey}" does not match ID "${clip.id}".`,
        path,
        clipIds: [clip.id],
      });
    }
    validateAnimationClip(clip, document, path, add, registerId);
  }
};
