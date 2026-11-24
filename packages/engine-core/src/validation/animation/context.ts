import type { AnimationClip, ProjectDocument } from '../../model';
import type { FindingSink, IdRegistrar } from '../contract';

export interface ClipValidationContext {
  readonly clip: AnimationClip;
  readonly document: ProjectDocument;
  readonly path: string;
  readonly add: FindingSink;
  readonly registerId: IdRegistrar;
}
