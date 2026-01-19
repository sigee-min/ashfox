import {
  FormatKind,
  IncludeDiffOption,
  IncludeStateOption,
  IfRevisionOption,
  ProjectStateDetail,
  ToolResponse
} from './shared';
import { Capabilities } from './capabilities';
import { ProjectDiff, ProjectInfo, ProjectState, WithState } from './project';
import { RenderPreviewPayload, RenderPreviewResult } from './preview';

export type ToolName =
  | 'list_capabilities'
  | 'get_project_state'
  | 'get_project_diff'
  | 'set_project_texture_resolution'
  | 'get_texture_usage'
  | 'list_projects'
  | 'select_project'
  | 'create_project'
  | 'reset_project'
  | 'delete_texture'
  | 'assign_texture'
  | 'set_face_uv'
  | 'add_bone'
  | 'update_bone'
  | 'delete_bone'
  | 'add_cube'
  | 'update_cube'
  | 'delete_cube'
  | 'apply_rig_template'
  | 'create_animation_clip'
  | 'update_animation_clip'
  | 'delete_animation_clip'
  | 'set_keyframes'
  | 'export'
  | 'render_preview'
  | 'validate';

export interface CreateProjectPayload extends IncludeStateOption, IncludeDiffOption, IfRevisionOption {
  format: FormatKind;
  name: string;
  confirmDiscard?: boolean;
  dialog?: Record<string, unknown>;
  confirmDialog?: boolean;
}

export type ListProjectsPayload = Record<string, never>;

export interface ResetProjectPayload extends IncludeStateOption, IncludeDiffOption, IfRevisionOption {}

export interface SelectProjectPayload extends IncludeStateOption {
  id?: string;
}

export interface GetProjectStatePayload {
  detail?: ProjectStateDetail;
}

export interface GetProjectDiffPayload {
  sinceRevision: string;
  detail?: ProjectStateDetail;
}

export interface SetProjectTextureResolutionPayload extends IncludeStateOption, IncludeDiffOption, IfRevisionOption {
  width: number;
  height: number;
  modifyUv?: boolean;
}

export interface GetTextureUsagePayload {
  textureId?: string;
  textureName?: string;
}

export interface DeleteTexturePayload extends IncludeStateOption, IncludeDiffOption, IfRevisionOption {
  id?: string;
  name?: string;
}

export type CubeFaceDirection = 'north' | 'south' | 'east' | 'west' | 'up' | 'down';

export interface AssignTexturePayload extends IncludeStateOption, IncludeDiffOption, IfRevisionOption {
  textureId?: string;
  textureName?: string;
  cubeIds?: string[];
  cubeNames?: string[];
  faces?: CubeFaceDirection[];
}

export type FaceUvMap = Partial<Record<CubeFaceDirection, [number, number, number, number]>>;

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
  uv?: [number, number];
  inflate?: number;
  mirror?: boolean;
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
  uv?: [number, number];
  inflate?: number;
  mirror?: boolean;
}

export interface DeleteCubePayload extends IncludeStateOption, IncludeDiffOption, IfRevisionOption {
  id?: string;
  name?: string;
}

export interface ApplyRigTemplatePayload extends IncludeStateOption, IncludeDiffOption, IfRevisionOption {
  templateId: string;
}

export interface CreateAnimationClipPayload extends IncludeStateOption, IncludeDiffOption, IfRevisionOption {
  id?: string;
  name: string;
  length: number;
  loop: boolean;
  fps: number;
}

export interface UpdateAnimationClipPayload extends IncludeStateOption, IncludeDiffOption, IfRevisionOption {
  id?: string;
  name?: string;
  newName?: string;
  length?: number;
  loop?: boolean;
  fps?: number;
}

export interface DeleteAnimationClipPayload extends IncludeStateOption, IncludeDiffOption, IfRevisionOption {
  id?: string;
  name?: string;
}

export type ChannelKind = 'rot' | 'pos' | 'scale';

export interface KeyframePoint {
  time: number;
  value: [number, number, number];
  interp?: 'linear' | 'step' | 'catmullrom';
}

export interface SetKeyframesPayload extends IncludeStateOption, IncludeDiffOption, IfRevisionOption {
  clipId?: string;
  clip: string;
  bone: string;
  channel: ChannelKind;
  keys: KeyframePoint[];
}

export interface ExportPayload extends IncludeStateOption {
  format: 'vanilla_json' | 'gecko_geo_anim' | 'animated_java';
  destPath: string;
}

export interface ValidatePayload extends IncludeStateOption {}

export interface ToolPayloadMap {
  list_capabilities: Record<string, never>;
  get_project_state: GetProjectStatePayload;
  get_project_diff: GetProjectDiffPayload;
  set_project_texture_resolution: SetProjectTextureResolutionPayload;
  get_texture_usage: GetTextureUsagePayload;
  list_projects: ListProjectsPayload;
  select_project: SelectProjectPayload;
  create_project: CreateProjectPayload;
  reset_project: ResetProjectPayload;
  delete_texture: DeleteTexturePayload;
  assign_texture: AssignTexturePayload;
  set_face_uv: SetFaceUvPayload;
  add_bone: AddBonePayload;
  update_bone: UpdateBonePayload;
  delete_bone: DeleteBonePayload;
  add_cube: AddCubePayload;
  update_cube: UpdateCubePayload;
  delete_cube: DeleteCubePayload;
  apply_rig_template: ApplyRigTemplatePayload;
  create_animation_clip: CreateAnimationClipPayload;
  update_animation_clip: UpdateAnimationClipPayload;
  delete_animation_clip: DeleteAnimationClipPayload;
  set_keyframes: SetKeyframesPayload;
  export: ExportPayload;
  render_preview: RenderPreviewPayload;
  validate: ValidatePayload;
}

export interface CreateProjectResult {
  id: string;
  format: FormatKind;
  name: string;
}

export interface ListProjectsResult {
  projects: ProjectInfo[];
}

export interface SelectProjectResult {
  id: string;
  format: FormatKind;
  name: string | null;
  formatId?: string | null;
}

export interface GetProjectStateResult {
  project: ProjectState;
}

export interface GetProjectDiffResult {
  diff: ProjectDiff;
}

export interface SetProjectTextureResolutionResult {
  width: number;
  height: number;
}

export interface GetTextureUsageCube {
  id?: string;
  name: string;
  faces: Array<{ face: CubeFaceDirection; uv?: [number, number, number, number] }>;
}

export interface GetTextureUsageEntry {
  id?: string;
  name: string;
  cubeCount: number;
  faceCount: number;
  cubes: GetTextureUsageCube[];
}

export interface GetTextureUsageUnresolved {
  textureRef: string;
  cubeId?: string;
  cubeName: string;
  face: CubeFaceDirection;
}

export interface GetTextureUsageResult {
  textures: GetTextureUsageEntry[];
  unresolved?: GetTextureUsageUnresolved[];
}

export interface ExportResult {
  path: string;
}

export type ValidateFinding = {
  code: string;
  message: string;
  severity: 'error' | 'warning' | 'info';
};

export interface ValidateResult {
  findings: ValidateFinding[];
}

export interface ToolResultMap {
  list_capabilities: Capabilities;
  get_project_state: GetProjectStateResult;
  get_project_diff: GetProjectDiffResult;
  set_project_texture_resolution: WithState<SetProjectTextureResolutionResult>;
  get_texture_usage: GetTextureUsageResult;
  list_projects: ListProjectsResult;
  select_project: WithState<SelectProjectResult>;
  create_project: WithState<CreateProjectResult>;
  reset_project: WithState<{ ok: true }>;
  delete_texture: WithState<{ id: string; name: string }>;
  assign_texture: WithState<{ textureId?: string; textureName: string; cubeCount: number; faces?: CubeFaceDirection[] }>;
  set_face_uv: WithState<{ cubeId?: string; cubeName: string; faces: CubeFaceDirection[] }>;
  add_bone: WithState<{ id: string; name: string }>;
  update_bone: WithState<{ id: string; name: string }>;
  delete_bone: WithState<{ id: string; name: string; removedBones: number; removedCubes: number }>;
  add_cube: WithState<{ id: string; name: string }>;
  update_cube: WithState<{ id: string; name: string }>;
  delete_cube: WithState<{ id: string; name: string }>;
  apply_rig_template: WithState<{ templateId: string }>;
  create_animation_clip: WithState<{ id: string; name: string }>;
  update_animation_clip: WithState<{ id: string; name: string }>;
  delete_animation_clip: WithState<{ id: string; name: string }>;
  set_keyframes: WithState<{ clip: string; clipId?: string; bone: string }>;
  export: WithState<ExportResult>;
  render_preview: WithState<RenderPreviewResult>;
  validate: WithState<ValidateResult>;
}

export interface Dispatcher {
  handle<TName extends ToolName>(
    name: TName,
    payload: ToolPayloadMap[TName]
  ): ToolResponse<ToolResultMap[TName]>;
}
