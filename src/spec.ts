import {
  ProjectStateDetail,
  UvPaintMapping,
  UvPaintScope,
  UvPaintSource,
  UvPaintSpec,
  UvPaintTarget
} from './types';

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
  rigTemplate: RigTemplateKind;
  parts: ModelPart[];
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
  uvPaint?: UvPaintSpec;
  ops?: TextureOp[];
}

export type { UvPaintScope, UvPaintMapping, UvPaintTarget, UvPaintSource, UvPaintSpec };
export type TextureOp =
  | { op: 'set_pixel'; x: number; y: number; color: string }
  | { op: 'fill_rect'; x: number; y: number; width: number; height: number; color: string }
  | { op: 'draw_rect'; x: number; y: number; width: number; height: number; color: string; lineWidth?: number }
  | { op: 'draw_line'; x1: number; y1: number; x2: number; y2: number; color: string; lineWidth?: number };

export interface ApplyTextureSpecPayload {
  textures: TextureSpec[];
  uvUsageId: string;
  includeState?: boolean;
  includeDiff?: boolean;
  diffDetail?: ProjectStateDetail;
  ifRevision?: string;
}

export type ProxyTool =
  | 'apply_model_spec'
  | 'apply_texture_spec'
  | 'render_preview'
  | 'validate';




