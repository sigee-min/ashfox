import type { Capabilities, ToolError } from '../../types';
import type { EditorPort } from '../../ports/editor';
import type { TextureRendererPort } from '../../ports/textureRenderer';
import type { SessionState } from '../../session';
import type { UvPolicyConfig } from '../../domain/uv/policy';
import type { UsecaseResult } from '../result';
import {
  buildUvAtlasMessages,
  buildUvGuardMessages,
  buildUvPaintMessages,
  buildUvPaintPixelMessages,
  buildUvPaintSourceMessages
} from '../../shared/messages';

export type TextureToolContext = {
  ensureActive: () => ToolError | null;
  ensureRevisionMatch: (ifRevision?: string) => ToolError | null;
  getSnapshot: () => SessionState;
  editor: EditorPort;
  textureRenderer?: TextureRendererPort;
  capabilities: Capabilities;
  getUvPolicyConfig: () => UvPolicyConfig;
  importTexture: (payload: {
    name: string;
    image: CanvasImageSource;
    width?: number;
    height?: number;
    ifRevision?: string;
  }) => UsecaseResult<{ id: string; name: string }>;
  updateTexture: (payload: {
    id?: string;
    name?: string;
    newName?: string;
    image: CanvasImageSource;
    width?: number;
    height?: number;
    ifRevision?: string;
  }) => UsecaseResult<{ id: string; name: string }>;
};

export const uvAtlasMessages = buildUvAtlasMessages();
export const uvGuardMessages = buildUvGuardMessages();
export const uvPaintMessages = buildUvPaintMessages();
export const uvPaintPixelMessages = buildUvPaintPixelMessages();
export const uvPaintSourceMessages = buildUvPaintSourceMessages();

