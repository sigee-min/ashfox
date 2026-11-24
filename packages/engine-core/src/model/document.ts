import type {
  AssetId,
  ClipId,
  ProjectId,
  ProjectSettings,
  Revision,
  PROJECT_DOCUMENT_SCHEMA_VERSION,
} from './identity';
import type { AnimationClip } from './motion';
import type { SceneGraph } from './scene';
import type { TextureAsset } from './texture';

export interface ProjectDocument {
  schemaVersion: typeof PROJECT_DOCUMENT_SCHEMA_VERSION;
  id: ProjectId;
  name: string;
  revision: Revision;
  settings: ProjectSettings;
  scene: SceneGraph;
  textures: Readonly<Record<AssetId, TextureAsset>>;
  animations: Readonly<Record<ClipId, AnimationClip>>;
  createdAt: string;
  updatedAt: string;
}
