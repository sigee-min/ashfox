import type { TrackedAnimation, TrackedBone, TrackedCube, TrackedTexture } from './session';

export type FormatKind = 'vanilla' | 'geckolib' | 'animated_java';

export interface Capability {
  format: FormatKind;
  animations: boolean;
  enabled: boolean;
}

export interface Limits {
  maxCubes: number;
  maxTextureSize: number;
  maxAnimationSeconds: number;
}

export interface Capabilities {
  pluginVersion: string;
  toolSchemaVersion?: string;
  blockbenchVersion: string;
  formats: Capability[];
  limits: Limits;
  preview?: PreviewCapability;
  guidance?: CapabilitiesGuidance;
}

export interface PreviewCapability {
  pngOnly: boolean;
  fixedOutput: 'single';
  turntableOutput: 'sequence';
  response: 'dataUri' | 'content' | 'content+dataUri';
}

export interface CapabilitiesGuidance {
  toolPathStability: {
    cache: 'no' | 'yes';
    note: string;
  };
  retryPolicy: {
    maxAttempts: number;
    onErrors: string[];
    steps: string[];
  };
  rediscovery: {
    refetchTools: boolean;
    refreshState: boolean;
    methods: string[];
  };
}

export type ProjectStateDetail = 'summary' | 'full';

export interface ProjectDiffCounts {
  added: number;
  removed: number;
  changed: number;
}

export interface ProjectDiffCountsByKind {
  bones: ProjectDiffCounts;
  cubes: ProjectDiffCounts;
  textures: ProjectDiffCounts;
  animations: ProjectDiffCounts;
}

export interface ProjectDiffEntry<T> {
  key: string;
  item: T;
}

export interface ProjectDiffChange<T> {
  key: string;
  before: T;
  after: T;
}

export interface ProjectDiffSet<T> {
  added: Array<ProjectDiffEntry<T>>;
  removed: Array<ProjectDiffEntry<T>>;
  changed: Array<ProjectDiffChange<T>>;
}

export interface ProjectDiff {
  sinceRevision: string;
  currentRevision: string;
  baseMissing?: boolean;
  counts: ProjectDiffCountsByKind;
  bones?: ProjectDiffSet<TrackedBone>;
  cubes?: ProjectDiffSet<TrackedCube>;
  textures?: ProjectDiffSet<TrackedTexture>;
  animations?: ProjectDiffSet<TrackedAnimation>;
}

export interface ProjectState {
  id: string;
  active: boolean;
  name: string | null;
  format: FormatKind | null;
  formatId?: string | null;
  dirty?: boolean;
  revision: string;
  counts: {
    bones: number;
    cubes: number;
    textures: number;
    animations: number;
  };
  bones?: TrackedBone[];
  cubes?: TrackedCube[];
  textures?: TrackedTexture[];
  animations?: TrackedAnimation[];
}

export interface ProjectInfo {
  id: string;
  name: string | null;
  format: FormatKind | null;
  formatId?: string | null;
}

export type WithState<T> = T & { state?: ProjectState | null; diff?: ProjectDiff | null; revision?: string };

export interface IncludeDiffOption {
  includeDiff?: boolean;
  diffDetail?: ProjectStateDetail;
}

export type ToolName =
  | 'list_capabilities'
  | 'reload_plugin'
  | 'get_project_state'
  | 'get_project_diff'
  | 'list_projects'
  | 'select_project'
  | 'create_project'
  | 'reset_project'
  | 'import_texture'
  | 'update_texture'
  | 'delete_texture'
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

export type ToolErrorCode =
  | 'unsupported_format'
  | 'not_implemented'
  | 'invalid_state'
  | 'invalid_payload'
  | 'io_error'
  | 'unknown';

export interface ToolError {
  code: ToolErrorCode;
  message: string;
  fix?: string;
  details?: Record<string, unknown>;
}

export type McpTextContent = { type: 'text'; text: string };

export type McpImageContent = { type: 'image'; data: string; mimeType: string };

export type McpContentBlock = McpTextContent | McpImageContent;

export type ToolResponse<T> =
  | { ok: true; data: T; content?: McpContentBlock[]; structuredContent?: unknown }
  | { ok: false; error: ToolError; content?: McpContentBlock[]; structuredContent?: unknown };

export interface IncludeStateOption {
  includeState?: boolean;
}

export interface IfRevisionOption {
  ifRevision?: string;
}

export interface CreateProjectPayload {
  format: FormatKind;
  name: string;
  confirmDiscard?: boolean;
  dialog?: Record<string, unknown>;
  confirmDialog?: boolean;
  includeState?: boolean;
  includeDiff?: boolean;
  diffDetail?: ProjectStateDetail;
  ifRevision?: string;
}

export type ListProjectsPayload = Record<string, never>;
export type ReloadPluginPayload = Record<string, never>;

export interface ResetProjectPayload {
  includeState?: boolean;
  includeDiff?: boolean;
  diffDetail?: ProjectStateDetail;
  ifRevision?: string;
}

export interface SelectProjectPayload {
  id?: string;
  includeState?: boolean;
}

export interface GetProjectStatePayload {
  detail?: ProjectStateDetail;
}

export interface GetProjectDiffPayload {
  sinceRevision: string;
  detail?: ProjectStateDetail;
}

export interface ImportTexturePayload {
  id?: string;
  name: string;
  dataUri?: string;
  path?: string;
  includeState?: boolean;
  includeDiff?: boolean;
  diffDetail?: ProjectStateDetail;
  ifRevision?: string;
}

export interface UpdateTexturePayload {
  id?: string;
  name?: string;
  newName?: string;
  dataUri?: string;
  path?: string;
  includeState?: boolean;
  includeDiff?: boolean;
  diffDetail?: ProjectStateDetail;
  ifRevision?: string;
}

export interface DeleteTexturePayload {
  id?: string;
  name?: string;
  includeState?: boolean;
  includeDiff?: boolean;
  diffDetail?: ProjectStateDetail;
  ifRevision?: string;
}

export interface AddBonePayload {
  id?: string;
  name: string;
  parent?: string;
  parentId?: string;
  pivot: [number, number, number];
  rotation?: [number, number, number];
  scale?: [number, number, number];
  includeState?: boolean;
  includeDiff?: boolean;
  diffDetail?: ProjectStateDetail;
  ifRevision?: string;
}

export interface UpdateBonePayload {
  id?: string;
  name?: string;
  newName?: string;
  parent?: string;
  parentId?: string;
  parentRoot?: boolean;
  pivot?: [number, number, number];
  rotation?: [number, number, number];
  scale?: [number, number, number];
  includeState?: boolean;
  includeDiff?: boolean;
  diffDetail?: ProjectStateDetail;
  ifRevision?: string;
}

export interface DeleteBonePayload {
  id?: string;
  name?: string;
  includeState?: boolean;
  includeDiff?: boolean;
  diffDetail?: ProjectStateDetail;
  ifRevision?: string;
}

export interface AddCubePayload {
  id?: string;
  name: string;
  from: [number, number, number];
  to: [number, number, number];
  bone?: string;
  boneId?: string;
  uv?: [number, number];
  inflate?: number;
  mirror?: boolean;
  includeState?: boolean;
  includeDiff?: boolean;
  diffDetail?: ProjectStateDetail;
  ifRevision?: string;
}

export interface UpdateCubePayload {
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
  includeState?: boolean;
  includeDiff?: boolean;
  diffDetail?: ProjectStateDetail;
  ifRevision?: string;
}

export interface DeleteCubePayload {
  id?: string;
  name?: string;
  includeState?: boolean;
  includeDiff?: boolean;
  diffDetail?: ProjectStateDetail;
  ifRevision?: string;
}

export interface ApplyRigTemplatePayload {
  templateId: string;
  includeState?: boolean;
  includeDiff?: boolean;
  diffDetail?: ProjectStateDetail;
  ifRevision?: string;
}

export interface CreateAnimationClipPayload {
  id?: string;
  name: string;
  length: number;
  loop: boolean;
  fps: number;
  includeState?: boolean;
  includeDiff?: boolean;
  diffDetail?: ProjectStateDetail;
  ifRevision?: string;
}

export interface UpdateAnimationClipPayload {
  id?: string;
  name?: string;
  newName?: string;
  length?: number;
  loop?: boolean;
  fps?: number;
  includeState?: boolean;
  includeDiff?: boolean;
  diffDetail?: ProjectStateDetail;
  ifRevision?: string;
}

export interface DeleteAnimationClipPayload {
  id?: string;
  name?: string;
  includeState?: boolean;
  includeDiff?: boolean;
  diffDetail?: ProjectStateDetail;
  ifRevision?: string;
}

export type ChannelKind = 'rot' | 'pos' | 'scale';

export interface KeyframePoint {
  time: number;
  value: [number, number, number];
  interp?: 'linear' | 'step' | 'catmullrom';
}

export interface SetKeyframesPayload {
  clipId?: string;
  clip: string;
  bone: string;
  channel: ChannelKind;
  keys: KeyframePoint[];
  includeState?: boolean;
  includeDiff?: boolean;
  diffDetail?: ProjectStateDetail;
  ifRevision?: string;
}

export interface ExportPayload {
  format: 'vanilla_json' | 'gecko_geo_anim' | 'animated_java';
  destPath: string;
  includeState?: boolean;
}

export type RenderPreviewOutputKind = 'single' | 'sequence';

export interface RenderPreviewPayload {
  mode: 'fixed' | 'turntable';
  angle?: [number, number] | [number, number, number];
  clip?: string;
  timeSeconds?: number;
  durationSeconds?: number;
  fps?: number;
  output?: RenderPreviewOutputKind;
  includeState?: boolean;
}

export interface ValidatePayload {
  includeState?: boolean;
}

export interface ToolPayloadMap {
  list_capabilities: Record<string, never>;
  reload_plugin: ReloadPluginPayload;
  get_project_state: GetProjectStatePayload;
  get_project_diff: GetProjectDiffPayload;
  list_projects: ListProjectsPayload;
  select_project: SelectProjectPayload;
  create_project: CreateProjectPayload;
  reset_project: ResetProjectPayload;
  import_texture: ImportTexturePayload;
  update_texture: UpdateTexturePayload;
  delete_texture: DeleteTexturePayload;
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

export interface ReloadPluginResult {
  ok: true;
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

export interface ExportResult {
  path: string;
}

export interface PreviewImage {
  mime: string;
  dataUri: string;
  byteLength: number;
  width: number;
  height: number;
}

export interface PreviewFrame {
  index: number;
  mime: string;
  dataUri: string;
  byteLength: number;
  width: number;
  height: number;
}

export interface RenderPreviewResult {
  kind: RenderPreviewOutputKind;
  frameCount: number;
  image?: PreviewImage;
  frames?: PreviewFrame[];
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
  reload_plugin: ReloadPluginResult;
  get_project_state: GetProjectStateResult;
  get_project_diff: GetProjectDiffResult;
  list_projects: ListProjectsResult;
  select_project: WithState<SelectProjectResult>;
  create_project: WithState<CreateProjectResult>;
  reset_project: WithState<{ ok: true }>;
  import_texture: WithState<{ id: string; name: string; path?: string }>;
  update_texture: WithState<{ id: string; name: string }>;
  delete_texture: WithState<{ id: string; name: string }>;
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
