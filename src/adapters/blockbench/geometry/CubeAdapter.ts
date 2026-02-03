import type { ToolError } from '../../../types';
import type { Logger } from '../../../logging';
import type { CubeCommand, DeleteCubeCommand, UpdateCubeCommand } from '../../../ports/editor';
import {
  assignVec2,
  assignVec3,
  attachToOutliner,
  moveOutlinerNode,
  normalizeParent,
  removeOutlinerNode,
  renameEntity,
  setVisibility,
  withUndo
} from '../blockbenchUtils';
import { getCubeApi } from '../blockbenchAdapterUtils';
import { findCubeRef, findGroup } from '../outlinerLookup';
import { withToolErrorAdapterError } from '../adapterErrors';
import { MODEL_BONE_NOT_FOUND, MODEL_CUBE_NOT_FOUND } from '../../../shared/messages';
import { enforceManualUvMode } from './uvUtils';

export class BlockbenchCubeAdapter {
  private readonly log: Logger;

  constructor(log: Logger) {
    this.log = log;
  }

  addCube(params: CubeCommand): ToolError | null {
    return withToolErrorAdapterError(this.log, 'cube add', 'cube add failed', () => {
      const api = getCubeApi();
      if ('error' in api) return api.error;
      const { CubeCtor, outliner } = api;
      withUndo({ elements: true, outliner: true }, 'Add cube', () => {
        const parent = normalizeParent(findGroup(params.bone));
        const cube = new CubeCtor({
          name: params.name,
          from: params.from,
          to: params.to,
          origin: params.origin,
          rotation: params.rotation,
          uv_offset: params.uvOffset ?? params.uv,
          box_uv: params.boxUv,
          inflate: params.inflate,
          mirror_uv: params.mirror
        }).init?.();
        if (cube) {
          enforceManualUvMode(cube);
          if (typeof params.boxUv === 'boolean') {
            cube.box_uv = params.boxUv;
            if (typeof cube.setUVMode === 'function') {
              cube.setUVMode(params.boxUv);
            }
          }
          if (params.uvOffset) assignVec2(cube, 'uv_offset', params.uvOffset);
          setVisibility(cube, params.visibility);
          if (params.id) cube.bbmcpId = params.id;
          const attached = attachToOutliner(parent, outliner, cube, this.log, 'cube');
          if (!attached && Array.isArray(outliner?.root)) {
            outliner.root.push(cube);
          }
        }
      });
      this.log.info('cube added', { name: params.name, bone: params.bone });
      return null;
    });
  }

  updateCube(params: UpdateCubeCommand): ToolError | null {
    return withToolErrorAdapterError(this.log, 'cube update', 'cube update failed', () => {
      const api = getCubeApi();
      if ('error' in api) return api.error;
      const { outliner } = api;
      const target = findCubeRef(params.name, params.id);
      if (!target) {
        const label = params.id ?? params.name ?? 'unknown';
        return { code: 'invalid_payload', message: MODEL_CUBE_NOT_FOUND(label) };
      }
      if (params.id) {
        target.bbmcpId = params.id;
      }
      const parent = params.boneRoot ? null : params.bone ? findGroup(params.bone) : undefined;
      if (params.bone && !parent) {
        return { code: 'invalid_payload', message: MODEL_BONE_NOT_FOUND(params.bone) };
      }
      withUndo({ elements: true, outliner: true }, 'Update cube', () => {
        if (params.newName && params.newName !== target.name) {
          renameEntity(target, params.newName);
        }
        const wantsManualUv = Boolean(params.uv || params.uvOffset) || params.boxUv === false;
        if (wantsManualUv) {
          enforceManualUvMode(target, { preserve: true });
        }
        if (params.from) assignVec3(target, 'from', params.from);
        if (params.to) assignVec3(target, 'to', params.to);
        if (params.origin) assignVec3(target, 'origin', params.origin);
        if (params.rotation) assignVec3(target, 'rotation', params.rotation);
        if (params.uv) assignVec2(target, 'uv_offset', params.uv);
        if (params.uvOffset) assignVec2(target, 'uv_offset', params.uvOffset);
        if (typeof params.inflate === 'number') target.inflate = params.inflate;
        if (typeof params.mirror === 'boolean') {
          target.mirror_uv = params.mirror;
          if (typeof target.mirror === 'boolean') target.mirror = params.mirror;
        }
        if (typeof params.boxUv === 'boolean') {
          target.box_uv = params.boxUv;
          if (typeof target.setUVMode === 'function') {
            target.setUVMode(params.boxUv);
          }
        }
        setVisibility(target, params.visibility);
        if (params.boneRoot || params.bone !== undefined) {
          moveOutlinerNode(target, parent ?? null, outliner, this.log, 'cube');
        }
      });
      this.log.info('cube updated', { name: params.name, newName: params.newName, bone: params.bone });
      return null;
    });
  }

  deleteCube(params: DeleteCubeCommand): ToolError | null {
    return withToolErrorAdapterError(this.log, 'cube delete', 'cube delete failed', () => {
      const api = getCubeApi();
      if ('error' in api) return api.error;
      const { outliner } = api;
      const target = findCubeRef(params.name, params.id);
      if (!target) {
        const label = params.id ?? params.name ?? 'unknown';
        return { code: 'invalid_payload', message: MODEL_CUBE_NOT_FOUND(label) };
      }
      withUndo({ elements: true, outliner: true }, 'Delete cube', () => {
        removeOutlinerNode(target, outliner);
      });
      this.log.info('cube deleted', { name: target?.name ?? params.name });
      return null;
    });
  }
}
