import type { Logger } from '../../../logging';
import { errorMessage } from '../../../logging';
import { toolError } from '../../../shared/tooling/toolResponse';
import type {
  DeleteTextureCommand,
  ImportTextureCommand,
  ReadTextureCommand,
  TextureSource,
  TextureStat,
  UpdateTextureCommand
} from '../../../ports/editor';
import type { ToolError } from '../../../types';
import type { TextureConstructor } from '../../../types/blockbench';
import { readTextureId, readTextureSize, removeEntity, renameEntity, withUndo } from '../blockbenchUtils';
import { getTextureApi } from '../blockbenchAdapterUtils';
import {
  ADAPTER_TEXTURE_CANVAS_UNAVAILABLE,
  ADAPTER_TEXTURE_DATA_UNAVAILABLE,
  TEXTURE_NOT_FOUND
} from '../../../shared/messages';
import { getTextureDataUri } from './textureData';
import {
  applyTextureDefaults,
  applyTextureDimensions,
  applyTextureImage,
  applyTextureMeta,
  finalizeTextureChange
} from './textureOps';
import { findTextureRef, listTextureStats } from './textureLookup';

export const runImportTexture = (log: Logger, params: ImportTextureCommand): ToolError | null => {
  try {
    const api = getTextureApi();
    if ('error' in api) return api.error;
    const TextureCtor = api.TextureCtor as TextureConstructor;
    let imageMissing = false;
    withUndo({ textures: true }, 'Import texture', () => {
      const tex = new TextureCtor({ name: params.name, width: params.width, height: params.height });
      if (params.id) tex.bbmcpId = params.id;
      applyTextureDefaults(tex);
      if (typeof tex.add === 'function') {
        tex.add();
      }
      applyTextureDimensions(tex, params.width, params.height);
      applyTextureMeta(tex, params);
      if (!applyTextureImage(tex, params.image)) {
        imageMissing = true;
        return;
      }
      if (applyTextureDimensions(tex, params.width, params.height)) {
        if (!applyTextureImage(tex, params.image)) {
          imageMissing = true;
          return;
        }
      }
      finalizeTextureChange(tex);
      tex.select?.();
    });
    if (imageMissing) {
      return { code: 'not_implemented', message: ADAPTER_TEXTURE_CANVAS_UNAVAILABLE };
    }
    log.info('texture imported', { name: params.name });
    return null;
  } catch (err) {
    const message = errorMessage(err, 'texture import failed');
    log.error('texture import error', { message });
    return { code: 'io_error', message };
  }
};

export const runUpdateTexture = (log: Logger, params: UpdateTextureCommand): ToolError | null => {
  try {
    const api = getTextureApi();
    if ('error' in api) return api.error;
    const target = findTextureRef(params.name, params.id);
    if (!target) {
      const label = params.id ?? params.name ?? 'unknown';
      return { code: 'invalid_payload', message: TEXTURE_NOT_FOUND(label) };
    }
    if (params.id) target.bbmcpId = params.id;
    let imageMissing = false;
    withUndo({ textures: true }, 'Update texture', () => {
      if (params.newName && params.newName !== target.name) {
        renameEntity(target, params.newName);
      }
      applyTextureDefaults(target);
      applyTextureDimensions(target, params.width, params.height);
      applyTextureMeta(target, params);
      if (!applyTextureImage(target, params.image)) {
        imageMissing = true;
        return;
      }
      if (applyTextureDimensions(target, params.width, params.height)) {
        if (!applyTextureImage(target, params.image)) {
          imageMissing = true;
          return;
        }
      }
      finalizeTextureChange(target);
    });
    if (imageMissing) {
      return { code: 'not_implemented', message: ADAPTER_TEXTURE_CANVAS_UNAVAILABLE };
    }
    log.info('texture updated', { name: params.name, newName: params.newName });
    return null;
  } catch (err) {
    const message = errorMessage(err, 'texture update failed');
    log.error('texture update error', { message });
    return { code: 'io_error', message };
  }
};

export const runDeleteTexture = (log: Logger, params: DeleteTextureCommand): ToolError | null => {
  try {
    const api = getTextureApi();
    if ('error' in api) return api.error;
    const TextureCtor = api.TextureCtor as TextureConstructor;
    const target = findTextureRef(params.name, params.id);
    if (!target) {
      const label = params.id ?? params.name ?? 'unknown';
      return { code: 'invalid_payload', message: TEXTURE_NOT_FOUND(label) };
    }
    withUndo({ textures: true }, 'Delete texture', () => {
      if (removeEntity(target)) return;
      const list = TextureCtor?.all;
      if (Array.isArray(list)) {
        const idx = list.indexOf(target);
        if (idx >= 0) list.splice(idx, 1);
      }
    });
    log.info('texture deleted', { name: target?.name ?? params.name });
    return null;
  } catch (err) {
    const message = errorMessage(err, 'texture delete failed');
    log.error('texture delete error', { message });
    return toolError('unknown', message, { reason: 'adapter_exception', context: 'texture_delete' });
  }
};

export const runReadTexture = (
  log: Logger,
  params: ReadTextureCommand
): { result?: TextureSource; error?: ToolError } => {
  try {
    const api = getTextureApi();
    if ('error' in api) return { error: api.error };
    const target = findTextureRef(params.name, params.id);
    if (!target) {
      const label = params.id ?? params.name ?? 'unknown';
      return { error: { code: 'invalid_payload', message: TEXTURE_NOT_FOUND(label) } };
    }
    const size = readTextureSize(target);
    const width = size.width;
    const height = size.height;
    const path = target?.path ?? target?.source;
    const dataUri = getTextureDataUri(target);
    const image = (target?.img ?? target?.canvas) as CanvasImageSource | null;
    if (!dataUri && !image) {
      return { error: { code: 'not_implemented', message: ADAPTER_TEXTURE_DATA_UNAVAILABLE } };
    }
    return {
      result: {
        id: readTextureId(target) ?? undefined,
        name: target?.name ?? target?.id ?? 'texture',
        width,
        height,
        path,
        dataUri: dataUri ?? undefined,
        image: image ?? undefined
      }
    };
  } catch (err) {
    const message = errorMessage(err, 'texture read failed');
    log.error('texture read error', { message });
    return { error: toolError('unknown', message, { reason: 'adapter_exception', context: 'texture_read' }) };
  }
};

export const runListTextures = (): TextureStat[] => listTextureStats();
