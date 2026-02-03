import type { Capabilities } from '../capabilities';
import type { ProjectState, WithState } from '../project';
import type { RenderPreviewResult } from '../preview';
import type { TextureUsageResult } from '../textureUsage';
import type { FormatKind } from '../shared';
import type { CubeFaceDirection } from '../../domain/model';
import type { AtlasTexturePlan } from '../../domain/uv/atlas';

export interface EnsureProjectResult {
  action: 'created' | 'reused' | 'deleted';
  project: { id: string; format: FormatKind; name: string | null; formatId?: string | null };
}

export interface BlockPipelineResult {
  name: string;
  namespace: string;
  variants: string[];
  resources?: Array<{ uri: string; name: string; kind: string; mimeType?: string }>;
  assets?: {
    blockstates?: Record<string, unknown>;
    models?: Record<string, unknown>;
    items?: Record<string, unknown>;
  };
}

export interface ReadTextureResult {
  texture: {
    id?: string;
    name?: string;
    mimeType: string;
    dataUri: string;
    width?: number;
    height?: number;
    byteLength?: number;
    hash?: string;
  };
  saved?: {
    texture: {
      path: string;
      mime: string;
      byteLength: number;
      width?: number;
      height?: number;
    };
  };
}

export interface ExportTraceLogResult {
  uri?: string;
  path?: string;
  fileName?: string;
  mode?: 'auto' | 'writeFile' | 'export';
  byteLength?: number;
}

export interface ReloadPluginsResult {
  scheduled: true;
  delayMs: number;
  method: 'devReload';
}

export interface GenerateTexturePresetResult {
  width: number;
  height: number;
  seed: number;
  coverage: {
    opaquePixels: number;
    totalPixels: number;
    opaqueRatio: number;
    bounds?: { x1: number; y1: number; x2: number; y2: number };
  };
  uvUsageId?: string;
  note?: string;
  textures?: Array<{ name: string; width: number; height: number }>;
}

export interface AutoUvAtlasResult {
  applied: boolean;
  steps: number;
  resolution: { width: number; height: number };
  textures: AtlasTexturePlan[];
}

export interface GetProjectStateResult {
  project: ProjectState;
}

export interface SetProjectTextureResolutionResult {
  width: number;
  height: number;
}

export interface PreflightUvBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
  faceCount: number;
}

export interface PreflightUsageSummary {
  textureCount: number;
  cubeCount: number;
  faceCount: number;
  unresolvedCount: number;
}

export type PreflightWarningCode =
  | 'uv_no_rects'
  | 'uv_unresolved_refs'
  | 'uv_bounds_exceed'
  | 'uv_overlap'
  | 'uv_scale_mismatch'
  | 'uv_rect_small'
  | 'uv_rect_skewed';

export interface PreflightTextureResult {
  uvUsageId: string;
  textureResolution?: { width: number; height: number };
  usageSummary: PreflightUsageSummary;
  uvBounds?: PreflightUvBounds;
  recommendedResolution?: { width: number; height: number; reason: string };
  warnings?: string[];
  warningCodes?: PreflightWarningCode[];
  textureUsage?: TextureUsageResult;
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
  read_texture: ReadTextureResult;
  export_trace_log: ExportTraceLogResult;
  reload_plugins: ReloadPluginsResult;
  generate_texture_preset: WithState<GenerateTexturePresetResult>;
  auto_uv_atlas: WithState<AutoUvAtlasResult>;
  set_project_texture_resolution: WithState<SetProjectTextureResolutionResult>;
  preflight_texture: PreflightTextureResult;
  ensure_project: WithState<EnsureProjectResult>;
  block_pipeline: WithState<BlockPipelineResult>;
  delete_texture: WithState<{ id: string; name: string }>;
  assign_texture: WithState<{ textureId?: string; textureName: string; cubeCount: number; faces?: CubeFaceDirection[] }>;
  set_face_uv: WithState<{ cubeId?: string; cubeName: string; faces: CubeFaceDirection[] }>;
  add_bone: WithState<{ id: string; name: string }>;
  update_bone: WithState<{ id: string; name: string }>;
  delete_bone: WithState<{ id: string; name: string; removedBones: number; removedCubes: number }>;
  add_cube: WithState<{ id: string; name: string }>;
  update_cube: WithState<{ id: string; name: string }>;
  delete_cube: WithState<{ id: string; name: string }>;
  export: WithState<ExportResult>;
  render_preview: WithState<RenderPreviewResult>;
  validate: WithState<ValidateResult>;
}

