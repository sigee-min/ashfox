import type { AnimationClip } from './motion';
import type { SceneGraph } from './scene';
import type { TextureAsset } from './texture';

export type CompiledForwardDirection = 'north' | 'south' | 'east' | 'west';
export type AssetQualityProfile = 'creature' | 'prop' | 'block';

/**
 * Version-neutral compiler output consumed by the project and target layers.
 * It contains only canonical product semantics; source AST and HIR types do
 * not cross this boundary.
 */
export interface CompiledModel {
  readonly id: string;
  readonly name: string;
  readonly forward: CompiledForwardDirection;
  readonly profile?: AssetQualityProfile;
  /** v1 keeps one model unit aligned with one texture texel. */
  readonly textureDensity: 16;
  readonly textureResolution: readonly [number, number];
  readonly scene: SceneGraph;
  readonly textures: Readonly<Record<string, TextureAsset>>;
  readonly animations: Readonly<Record<string, AnimationClip>>;
}
