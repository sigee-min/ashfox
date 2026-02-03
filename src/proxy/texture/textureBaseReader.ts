import type { Logger } from '../../logging';
import type { DomPort } from '../../ports/dom';
import type { TextureSpec } from '../../spec';
import type { ToolResponse } from '../../types';
import type { ToolService } from '../../usecases/ToolService';
import { toToolResponse } from '../../shared/tooling/toolResponse';
import { resolveTextureBase } from './textureBase';

export const readTextureBase = async (args: {
  service: ToolService;
  dom: DomPort;
  texture: TextureSpec;
  label: string;
  detectNoChange: boolean;
  log?: Logger;
}): Promise<ToolResponse<{ base: { image: CanvasImageSource; width: number; height: number }; dataUri: string | null }>> => {
  args.log?.info('applyTextureSpec base requested', { texture: args.label });
  const readRes = toToolResponse(
    args.service.readTexture({ id: args.texture.targetId, name: args.texture.targetName })
  );
  if (!readRes.ok) {
    args.log?.warn('applyTextureSpec base missing', { texture: args.label, code: readRes.error.code });
    return readRes;
  }
  const dataUri = args.detectNoChange ? readRes.data.dataUri ?? null : null;
  const resolved = await resolveTextureBase(args.dom, readRes.data);
  if (!resolved.ok) {
    args.log?.warn('applyTextureSpec base unresolved', { texture: args.label, code: resolved.error.code });
    return resolved;
  }
  args.log?.info('applyTextureSpec base resolved', {
    texture: args.label,
    width: resolved.data.width,
    height: resolved.data.height
  });
  return { ok: true, data: { base: resolved.data, dataUri } };
};
