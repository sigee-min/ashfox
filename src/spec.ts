import { FormatKind, ProjectStateDetail } from './types';

export type RigTemplateKind = 'empty' | 'biped' | 'quadruped' | 'block_entity';

export interface ModelPart {
  id: string;
  size: [number, number, number];
  offset: [number, number, number];
  uv?: [number, number];
  inflate?: number;
  mirror?: boolean;
  pivot?: [number, number, number];
  parent?: string;
}

export interface ModelSpec {
  format: FormatKind;
  rigTemplate: RigTemplateKind;
  name: string;
  parts: ModelPart[];
}

export type AnimChannelKind = 'rot' | 'pos' | 'scale';
export type AnimInterp = 'linear' | 'step' | 'catmullrom';

export interface AnimKey {
  time: number;
  value: [number, number, number];
  interp?: AnimInterp;
}

export interface AnimChannel {
  bone: string;
  channel: AnimChannelKind;
  keys: AnimKey[];
}

export interface AnimationSpec {
  clip: string;
  duration: number;
  loop: boolean;
  fps: number;
  channels: AnimChannel[];
}

export interface ApplyModelSpecPayload {
  model: ModelSpec;
  includeState?: boolean;
  includeDiff?: boolean;
  diffDetail?: ProjectStateDetail;
  ifRevision?: string;
}

export interface TextureSpec {
  mode?: 'create' | 'update';
  id?: string;
  targetId?: string;
  targetName?: string;
  name?: string;
  width?: number;
  height?: number;
  background?: string;
  useExisting?: boolean;
  ops?: TextureOp[];
}

export type TextureOp =
  | { op: 'set_pixel'; x: number; y: number; color: string }
  | { op: 'fill_rect'; x: number; y: number; width: number; height: number; color: string }
  | { op: 'draw_rect'; x: number; y: number; width: number; height: number; color: string; lineWidth?: number }
  | { op: 'draw_line'; x1: number; y1: number; x2: number; y2: number; color: string; lineWidth?: number };

export interface ApplyTextureSpecPayload {
  textures: TextureSpec[];
  includeState?: boolean;
  includeDiff?: boolean;
  diffDetail?: ProjectStateDetail;
  ifRevision?: string;
}

export interface ApplyAnimSpecPayload {
  animation: AnimationSpec;
  includeState?: boolean;
  includeDiff?: boolean;
  diffDetail?: ProjectStateDetail;
  ifRevision?: string;
}

export interface ApplyProjectSpecPayload {
  model?: ModelSpec;
  textures?: TextureSpec[];
  animation?: AnimationSpec;
  projectMode?: 'auto' | 'reuse' | 'create';
  includeState?: boolean;
  includeDiff?: boolean;
  diffDetail?: ProjectStateDetail;
  ifRevision?: string;
}

export type ProxyTool =
  | 'apply_model_spec'
  | 'apply_texture_spec'
  | 'apply_anim_spec'
  | 'apply_project_spec'
  | 'render_preview'
  | 'validate';

