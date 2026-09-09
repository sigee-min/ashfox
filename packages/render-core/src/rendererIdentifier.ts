import * as THREE from 'three';

/*
 * Visual evidence is produced by the Three.js viewport renderer. Its exported
 * revision is the stable runtime identifier available to both the renderer and
 * the persistence validator; no deployment-specific or synthetic build value
 * is substituted here.
 */
export const VISUAL_REVIEW_RENDERER_IDENTIFIER =
  `three:r${THREE.REVISION}`;
