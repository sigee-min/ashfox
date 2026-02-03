import {
  FormatKind,
  IncludeDiffOption,
  IncludeStateOption,
  IfRevisionOption,
  ProjectStateDetail
} from '../shared';
import { BlockPipelineMode, BlockPipelineOnConflict, BlockPipelineTextures, BlockVariant } from '../blockPipeline';
import type { UvPaintSpec } from '../../domain/uv/paintSpec';
import type { CubeFaceDirection, FaceUvMap } from '../../domain/model';
import type {
  EnsureProjectMatch,
  EnsureProjectOnMismatch,
  EnsureProjectOnMissing,
  EnsureProjectAction,
  TexturePresetName
} from '../../shared/toolConstants';

export interface EnsureProjectPayload extends IncludeStateOption, IncludeDiffOption, IfRevisionOption {
  action?: EnsureProjectAction;
  target?: { name?: string };
  format?: FormatKind;
  name?: string;
  match?: EnsureProjectMatch;
  onMismatch?: EnsureProjectOnMismatch;
  onMissing?: EnsureProjectOnMissing;
  confirmDiscard?: boolean;
  force?: boolean;
  dialog?: Record<string, unknown>;
}

export interface BlockPipelinePayload {
  name: string;
  texture: string;
  namespace?: string;
  variants?: BlockVariant[];
  textures?: BlockPipelineTextures;
  onConflict?: BlockPipelineOnConflict;
  mode?: BlockPipelineMode;
  ifRevision?: string;
}

export interface GenerateTexturePresetPayload extends IncludeStateOption, IncludeDiffOption, IfRevisionOption {
  preset: TexturePresetName;
  width: number;
  height: number;
  uvUsageId: string;
  name?: string;
  targetId?: string;
  targetName?: string;
  mode?: 'create' | 'update';
  seed?: number;
  palette?: string[];
  uvPaint?: UvPaintSpec;
}

export interface AutoUvAtlasPayload extends IncludeStateOption, IncludeDiffOption, IfRevisionOption {
  padding?: number;
  apply?: boolean;
}

export interface ReadTexturePayload {
  id?: string;
  name?: string;
  saveToTmp?: boolean;
  tmpName?: string;
  tmpPrefix?: string;
}

export type ExportTraceLogMode = 'auto' | 'writeFile' | 'export';

export interface ExportTraceLogPayload {
  mode?: ExportTraceLogMode;
  destPath?: string;
  fileName?: string;
}

export interface ReloadPluginsPayload {
  confirm?: boolean;
  delayMs?: number;
}

export interface GetProjectStatePayload {
  detail?: ProjectStateDetail;
  includeUsage?: boolean;
}

export interface SetProjectTextureResolutionPayload extends IncludeStateOption, IncludeDiffOption, IfRevisionOption {
  width: number;
  height: number;
  modifyUv?: boolean;
}

export interface PreflightTexturePayload {
  textureId?: string;
  textureName?: string;
  includeUsage?: boolean;
}

export interface DeleteTexturePayload extends IncludeStateOption, IncludeDiffOption, IfRevisionOption {
  id?: string;
  name?: string;
}

export interface AssignTexturePayload extends IncludeStateOption, IncludeDiffOption, IfRevisionOption {
  textureId?: string;
  textureName?: string;
  cubeIds?: string[];
  cubeNames?: string[];
  faces?: CubeFaceDirection[];
}

export interface SetFaceUvPayload extends IncludeStateOption, IncludeDiffOption, IfRevisionOption {
  cubeId?: string;
  cubeName?: string;
  faces: FaceUvMap;
}

export interface AddBonePayload extends IncludeStateOption, IncludeDiffOption, IfRevisionOption {
  id?: string;
  name: string;
  parent?: string;
  parentId?: string;
  pivot: [number, number, number];
  rotation?: [number, number, number];
  scale?: [number, number, number];
  visibility?: boolean;
}

export interface UpdateBonePayload extends IncludeStateOption, IncludeDiffOption, IfRevisionOption {
  id?: string;
  name?: string;
  newName?: string;
  parent?: string;
  parentId?: string;
  parentRoot?: boolean;
  pivot?: [number, number, number];
  rotation?: [number, number, number];
  scale?: [number, number, number];
  visibility?: boolean;
}

export interface DeleteBonePayload extends IncludeStateOption, IncludeDiffOption, IfRevisionOption {
  id?: string;
  name?: string;
}

export interface AddCubePayload extends IncludeStateOption, IncludeDiffOption, IfRevisionOption {
  id?: string;
  name: string;
  from: [number, number, number];
  to: [number, number, number];
  bone?: string;
  boneId?: string;
  origin?: [number, number, number];
  rotation?: [number, number, number];
  inflate?: number;
  mirror?: boolean;
  visibility?: boolean;
  boxUv?: boolean;
  uvOffset?: [number, number];
}

export interface UpdateCubePayload extends IncludeStateOption, IncludeDiffOption, IfRevisionOption {
  id?: string;
  name?: string;
  newName?: string;
  bone?: string;
  boneId?: string;
  boneRoot?: boolean;
  from?: [number, number, number];
  to?: [number, number, number];
  origin?: [number, number, number];
  rotation?: [number, number, number];
  inflate?: number;
  mirror?: boolean;
  visibility?: boolean;
  boxUv?: boolean;
  uvOffset?: [number, number];
}

export interface DeleteCubePayload extends IncludeStateOption, IncludeDiffOption, IfRevisionOption {
  id?: string;
  name?: string;
}

export interface ExportPayload extends IncludeStateOption, IfRevisionOption {
  format: 'java_block_item_json' | 'gecko_geo_anim' | 'animated_java';
  destPath: string;
}

export interface ValidatePayload extends IncludeStateOption, IfRevisionOption {}

