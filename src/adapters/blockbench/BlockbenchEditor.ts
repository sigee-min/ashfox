import {
  AnimationCommand,
  DeleteAnimationCommand,
  BoneCommand,
  CubeCommand,
  DeleteBoneCommand,
  DeleteCubeCommand,
  DeleteTextureCommand,
  EditorPort,
  ImportTextureCommand,
  KeyframeCommand,
  ReadTextureCommand,
  TextureSource,
  TextureStat,
  UpdateAnimationCommand,
  UpdateBoneCommand,
  UpdateCubeCommand,
  UpdateTextureCommand
} from '../../ports/editor';
import { RenderPreviewPayload, RenderPreviewResult, RenderPreviewOutputKind, ToolError, FormatKind } from '../../types';
import { Logger } from '../../logging';

/* Blockbench globals (provided at runtime). */
declare const Blockbench: any;
declare const Texture: any;
declare const Group: any;
declare const Cube: any;
declare const Animator: any;
declare const Animation: any;
declare const Outliner: any;
declare const ModelFormat: any;
declare const Undo: any;
declare const Preview: any;

const DEFAULT_TURNTABLE_FPS = 20;
const DEFAULT_TURNTABLE_SECONDS = 2;
const DEG_TO_RAD = Math.PI / 180;

type BlockbenchGlobals = {
  Blockbench?: any;
  Texture?: any;
  Group?: any;
  Cube?: any;
  Animator?: any;
  Animation?: any;
  Outliner?: any;
  ModelFormat?: any;
  Undo?: any;
  Preview?: any;
};

const readGlobals = (): BlockbenchGlobals => ({
  Blockbench: (globalThis as any).Blockbench,
  Texture: (globalThis as any).Texture,
  Group: (globalThis as any).Group,
  Cube: (globalThis as any).Cube,
  Animator: (globalThis as any).Animator,
  Animation: (globalThis as any).Animation,
  Outliner: (globalThis as any).Outliner,
  ModelFormat: (globalThis as any).ModelFormat,
  Undo: (globalThis as any).Undo,
  Preview: (globalThis as any).Preview
});

type DataUrlInfo = {
  mime: string;
  dataUri: string;
  byteLength: number;
};

const parseDataUrl = (dataUrl: string): { ok: true; value: DataUrlInfo } | { ok: false; message: string } => {
  const raw = String(dataUrl ?? '');
  const comma = raw.indexOf(',');
  if (comma === -1) {
    return { ok: false, message: 'invalid data url' };
  }
  const meta = raw.slice(0, comma);
  const payload = raw.slice(comma + 1).trim();
  if (!meta.toLowerCase().includes('base64')) {
    return { ok: false, message: 'data url is not base64' };
  }
  const mimeMatch = /^data:([^;]+);/i.exec(meta);
  const mime = mimeMatch?.[1] ?? 'application/octet-stream';
  const normalized = payload.replace(/\s/g, '');
  if (!normalized) {
    return { ok: false, message: 'empty base64 payload' };
  }
  let padding = 0;
  if (normalized.endsWith('==')) padding = 2;
  else if (normalized.endsWith('=')) padding = 1;
  const byteLength = Math.max(0, Math.floor((normalized.length * 3) / 4) - padding);
  return { ok: true, value: { mime, dataUri: `data:${mime};base64,${normalized}`, byteLength } };
};

export class BlockbenchEditor implements EditorPort {
  private readonly log: Logger;

  constructor(log: Logger) {
    this.log = log;
  }

  createProject(
    name: string,
    formatId: string,
    kind: FormatKind,
    options?: { confirmDiscard?: boolean; dialog?: Record<string, unknown>; confirmDialog?: boolean }
  ): ToolError | null {
    try {
      const globals = readGlobals();
      const blockbench = globals.Blockbench;
      const modelFormat = globals.ModelFormat;
      const resolvedId = String(formatId ?? '');
      const formats = (globalThis as any).Formats ?? modelFormat?.formats ?? null;
      const hasUnsaved = hasUnsavedChanges(blockbench);
      if (hasUnsaved) {
        if (options?.confirmDiscard === false) {
          return {
            code: 'invalid_state',
            message: 'Project has unsaved changes. Save or close it before creating a new project.'
          };
        }
        if (!options?.confirmDiscard) {
          this.log.warn('auto-discarding unsaved changes for project creation', { name, format: kind });
        } else {
          this.log.warn('discarding unsaved changes for project creation', { name, format: kind });
        }
        markProjectSaved(blockbench);
      }
      const formatEntry = formats?.[resolvedId];
      const canCreate =
        typeof formatEntry?.new === 'function' ||
        typeof blockbench?.newProject === 'function' ||
        typeof modelFormat?.new === 'function';
      if (!canCreate) {
        return { code: 'not_implemented', message: 'Blockbench project creation unavailable' };
      }
      if (typeof formatEntry?.new === 'function') {
        formatEntry.new();
      } else if (typeof blockbench?.newProject === 'function') {
        blockbench.newProject(resolvedId);
      } else if (typeof modelFormat?.new === 'function') {
        modelFormat.new();
      }
      const dialogResult = tryAutoConfirmProjectDialog(name, options);
      if (!dialogResult.ok) return dialogResult.error;
      if (typeof blockbench?.setProjectName === 'function') {
        blockbench.setProjectName(name);
      } else if (blockbench?.project) {
        blockbench.project.name = name;
      }
      this.log.info('project created', { name, format: kind, formatId: resolvedId });
      return null;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'project create failed';
      this.log.error('project create error', { message });
      return { code: 'unknown', message };
    }
  }

  importTexture(params: ImportTextureCommand): ToolError | null {
    if (!params.dataUri && !params.path) return { code: 'invalid_payload', message: 'dataUri or path is required' };
    try {
      const { Texture: TextureCtor } = readGlobals();
      if (typeof TextureCtor === 'undefined') {
        return { code: 'not_implemented', message: 'Texture API not available' };
      }
      this.withUndo({ textures: true }, 'Import texture', () => {
        const tex = new TextureCtor({ name: params.name });
        if (params.id) tex.bbmcpId = params.id;
        let loadedViaData = false;
        if (params.dataUri) {
          if (typeof tex.fromDataURL === 'function') {
            tex.fromDataURL(params.dataUri);
            loadedViaData = true;
          } else if (typeof tex.loadFromDataURL === 'function') {
            tex.loadFromDataURL(params.dataUri);
            loadedViaData = true;
          } else {
            tex.source = params.dataUri;
          }
        } else if (params.path) {
          tex.source = params.path;
          tex.path = params.path;
        }
        if (typeof tex.add === 'function') {
          tex.add();
        }
        if (!loadedViaData) {
          tex.load?.();
        }
        tex.select?.();
      });
      this.log.info('texture imported', { name: params.name });
      return null;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'texture import failed';
      this.log.error('texture import error', { message });
      return { code: 'io_error', message };
    }
  }

  updateTexture(params: UpdateTextureCommand): ToolError | null {
    try {
      const { Texture: TextureCtor } = readGlobals();
      if (typeof TextureCtor === 'undefined') {
        return { code: 'not_implemented', message: 'Texture API not available' };
      }
      const target = this.findTextureRef(params.name, params.id);
      if (!target) {
        const label = params.id ?? params.name ?? 'unknown';
        return { code: 'invalid_payload', message: `Texture not found: ${label}` };
      }
      if (params.id) target.bbmcpId = params.id;
      this.withUndo({ textures: true }, 'Update texture', () => {
        if (params.newName && params.newName !== target.name) {
          if (typeof target.rename === 'function') {
            target.rename(params.newName);
          } else {
            target.name = params.newName;
          }
        }
        const source = params.dataUri ?? params.path;
        if (source) {
          if (params.dataUri && typeof target.fromDataURL === 'function') {
            target.fromDataURL(params.dataUri);
          } else if (params.dataUri && typeof target.loadFromDataURL === 'function') {
            target.loadFromDataURL(params.dataUri);
          } else {
            target.source = source;
            if (params.path) target.path = params.path;
            target.load?.();
          }
        }
      });
      this.log.info('texture updated', { name: params.name, newName: params.newName });
      return null;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'texture update failed';
      this.log.error('texture update error', { message });
      return { code: 'io_error', message };
    }
  }

  deleteTexture(params: DeleteTextureCommand): ToolError | null {
    try {
      const { Texture: TextureCtor } = readGlobals();
      if (typeof TextureCtor === 'undefined') {
        return { code: 'not_implemented', message: 'Texture API not available' };
      }
      const target = this.findTextureRef(params.name, params.id);
      if (!target) {
        const label = params.id ?? params.name ?? 'unknown';
        return { code: 'invalid_payload', message: `Texture not found: ${label}` };
      }
      this.withUndo({ textures: true }, 'Delete texture', () => {
        if (typeof target.remove === 'function') {
          target.remove();
          return;
        }
        if (typeof target.delete === 'function') {
          target.delete();
          return;
        }
        if (typeof target.dispose === 'function') {
          target.dispose();
          return;
        }
        const list = TextureCtor?.all;
        if (Array.isArray(list)) {
          const idx = list.indexOf(target);
          if (idx >= 0) list.splice(idx, 1);
        }
      });
      this.log.info('texture deleted', { name: target?.name ?? params.name });
      return null;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'texture delete failed';
      this.log.error('texture delete error', { message });
      return { code: 'unknown', message };
    }
  }

  readTexture(params: ReadTextureCommand): { result?: TextureSource; error?: ToolError } {
    try {
      const { Texture: TextureCtor } = readGlobals();
      if (typeof TextureCtor === 'undefined') {
        return { error: { code: 'not_implemented', message: 'Texture API not available' } };
      }
      const target = this.findTextureRef(params.name, params.id);
      if (!target) {
        const label = params.id ?? params.name ?? 'unknown';
        return { error: { code: 'invalid_payload', message: `Texture not found: ${label}` } };
      }
      const width = target?.width ?? target?.img?.naturalWidth ?? target?.img?.width ?? 0;
      const height = target?.height ?? target?.img?.naturalHeight ?? target?.img?.height ?? 0;
      const path = target?.path ?? target?.source;
      const dataUri = getTextureDataUri(target);
      const image = (target?.img ?? target?.canvas) as CanvasImageSource | null;
      if (!dataUri && !image) {
        return { error: { code: 'not_implemented', message: 'Texture data unavailable' } };
      }
      return {
        result: {
          id: readTextureId(target),
          name: target?.name ?? target?.id ?? 'texture',
          width,
          height,
          path,
          dataUri: dataUri ?? undefined,
          image: image ?? undefined
        }
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'texture read failed';
      this.log.error('texture read error', { message });
      return { error: { code: 'unknown', message } };
    }
  }

  addBone(params: BoneCommand): ToolError | null {
    try {
      const globals = readGlobals();
      const GroupCtor = globals.Group;
      const outliner = globals.Outliner;
      if (typeof GroupCtor === 'undefined') {
        return { code: 'not_implemented', message: 'Group API not available' };
      }
      this.withUndo({ elements: true, outliner: true }, 'Add bone', () => {
        const parent = normalizeParent(this.findGroup(params.parent));
        const group = new GroupCtor({
          name: params.name,
          origin: params.pivot,
          rotation: params.rotation,
          scale: params.scale
        }).init?.();
        if (group) {
          if (params.id) group.bbmcpId = params.id;
          const attached = attachToOutliner(parent, outliner, group, this.log, 'bone');
          if (!attached && outliner?.root?.push) {
            outliner.root.push(group);
          }
        }
      });
      this.log.info('bone added', { name: params.name, parent: params.parent });
      return null;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'bone add failed';
      this.log.error('bone add error', { message });
      return { code: 'unknown', message };
    }
  }

  updateBone(params: UpdateBoneCommand): ToolError | null {
    try {
      const globals = readGlobals();
      const GroupCtor = globals.Group;
      const outliner = globals.Outliner;
      if (typeof GroupCtor === 'undefined') {
        return { code: 'not_implemented', message: 'Group API not available' };
      }
      const target = this.findGroupRef(params.name, params.id);
      if (!target) {
        const label = params.id ?? params.name ?? 'unknown';
        return { code: 'invalid_payload', message: `Bone not found: ${label}` };
      }
      if (params.id) {
        target.bbmcpId = params.id;
      }
      const parent = params.parentRoot ? null : params.parent ? this.findGroup(params.parent) : undefined;
      if (params.parent && !parent) {
        return { code: 'invalid_payload', message: `Parent bone not found: ${params.parent}` };
      }
      this.withUndo({ elements: true, outliner: true }, 'Update bone', () => {
        if (params.newName && params.newName !== target.name) {
          if (typeof target.rename === 'function') {
            target.rename(params.newName);
          } else {
            target.name = params.newName;
          }
        }
        if (params.pivot) assignVec3(target, 'origin', params.pivot);
        if (params.rotation) assignVec3(target, 'rotation', params.rotation);
        if (params.scale) assignVec3(target, 'scale', params.scale);
        if (params.parentRoot || params.parent !== undefined) {
          moveOutlinerNode(target, parent ?? null, outliner, this.log, 'bone');
        }
      });
      this.log.info('bone updated', { name: params.name, newName: params.newName, parent: params.parent });
      return null;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'bone update failed';
      this.log.error('bone update error', { message });
      return { code: 'unknown', message };
    }
  }

  deleteBone(params: DeleteBoneCommand): ToolError | null {
    try {
      const globals = readGlobals();
      const GroupCtor = globals.Group;
      const outliner = globals.Outliner;
      if (typeof GroupCtor === 'undefined') {
        return { code: 'not_implemented', message: 'Group API not available' };
      }
      const target = this.findGroupRef(params.name, params.id);
      if (!target) {
        const label = params.id ?? params.name ?? 'unknown';
        return { code: 'invalid_payload', message: `Bone not found: ${label}` };
      }
      this.withUndo({ elements: true, outliner: true }, 'Delete bone', () => {
        removeOutlinerNode(target, outliner);
      });
      this.log.info('bone deleted', { name: target?.name ?? params.name });
      return null;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'bone delete failed';
      this.log.error('bone delete error', { message });
      return { code: 'unknown', message };
    }
  }

  addCube(params: CubeCommand): ToolError | null {
    try {
      const globals = readGlobals();
      const CubeCtor = globals.Cube;
      const outliner = globals.Outliner;
      if (typeof CubeCtor === 'undefined') {
        return { code: 'not_implemented', message: 'Cube API not available' };
      }
      this.withUndo({ elements: true, outliner: true }, 'Add cube', () => {
        const parent = normalizeParent(this.findGroup(params.bone));
        const cube = new CubeCtor({
          name: params.name,
          from: params.from,
          to: params.to,
          uv_offset: params.uv,
          inflate: params.inflate,
          mirror_uv: params.mirror
        }).init?.();
        if (cube) {
          if (params.id) cube.bbmcpId = params.id;
          const attached = attachToOutliner(parent, outliner, cube, this.log, 'cube');
          if (!attached && outliner?.root?.push) {
            outliner.root.push(cube);
          }
        }
      });
      this.log.info('cube added', { name: params.name, bone: params.bone });
      return null;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'cube add failed';
      this.log.error('cube add error', { message });
      return { code: 'unknown', message };
    }
  }

  updateCube(params: UpdateCubeCommand): ToolError | null {
    try {
      const globals = readGlobals();
      const CubeCtor = globals.Cube;
      const outliner = globals.Outliner;
      if (typeof CubeCtor === 'undefined') {
        return { code: 'not_implemented', message: 'Cube API not available' };
      }
      const target = this.findCubeRef(params.name, params.id);
      if (!target) {
        const label = params.id ?? params.name ?? 'unknown';
        return { code: 'invalid_payload', message: `Cube not found: ${label}` };
      }
      if (params.id) {
        target.bbmcpId = params.id;
      }
      const parent = params.boneRoot ? null : params.bone ? this.findGroup(params.bone) : undefined;
      if (params.bone && !parent) {
        return { code: 'invalid_payload', message: `Bone not found: ${params.bone}` };
      }
      this.withUndo({ elements: true, outliner: true }, 'Update cube', () => {
        if (params.newName && params.newName !== target.name) {
          if (typeof target.rename === 'function') {
            target.rename(params.newName);
          } else {
            target.name = params.newName;
          }
        }
        if (params.from) assignVec3(target, 'from', params.from);
        if (params.to) assignVec3(target, 'to', params.to);
        if (params.uv) assignVec2(target, 'uv_offset', params.uv);
        if (typeof params.inflate === 'number') target.inflate = params.inflate;
        if (typeof params.mirror === 'boolean') {
          target.mirror_uv = params.mirror;
          if (typeof target.mirror === 'boolean') target.mirror = params.mirror;
        }
        if (params.boneRoot || params.bone !== undefined) {
          moveOutlinerNode(target, parent ?? null, outliner, this.log, 'cube');
        }
      });
      this.log.info('cube updated', { name: params.name, newName: params.newName, bone: params.bone });
      return null;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'cube update failed';
      this.log.error('cube update error', { message });
      return { code: 'unknown', message };
    }
  }

  deleteCube(params: DeleteCubeCommand): ToolError | null {
    try {
      const globals = readGlobals();
      const CubeCtor = globals.Cube;
      const outliner = globals.Outliner;
      if (typeof CubeCtor === 'undefined') {
        return { code: 'not_implemented', message: 'Cube API not available' };
      }
      const target = this.findCubeRef(params.name, params.id);
      if (!target) {
        const label = params.id ?? params.name ?? 'unknown';
        return { code: 'invalid_payload', message: `Cube not found: ${label}` };
      }
      this.withUndo({ elements: true, outliner: true }, 'Delete cube', () => {
        removeOutlinerNode(target, outliner);
      });
      this.log.info('cube deleted', { name: target?.name ?? params.name });
      return null;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'cube delete failed';
      this.log.error('cube delete error', { message });
      return { code: 'unknown', message };
    }
  }

  createAnimation(params: AnimationCommand): ToolError | null {
    try {
      const { Animation: AnimationCtor } = readGlobals();
      if (typeof AnimationCtor === 'undefined') {
        return { code: 'not_implemented', message: 'Animation API not available' };
      }
      this.withUndo({ animations: true }, 'Create animation', () => {
        const anim = new AnimationCtor({
          name: params.name,
          length: params.length,
          loop: params.loop ? 'loop' : 'once',
          snapping: params.fps
        });
        if (params.id) anim.bbmcpId = params.id;
        anim.add?.(true);
      });
      this.log.info('animation created', { name: params.name });
      return null;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'animation create failed';
      this.log.error('animation create error', { message });
      return { code: 'unknown', message };
    }
  }

  updateAnimation(params: UpdateAnimationCommand): ToolError | null {
    try {
      const animations = getAnimations();
      const target = this.findAnimationRef(params.name, params.id, animations);
      if (!target) {
        const label = params.id ?? params.name ?? 'unknown';
        return { code: 'invalid_payload', message: `Animation clip not found: ${label}` };
      }
      if (params.id) target.bbmcpId = params.id;
      this.withUndo({ animations: true }, 'Update animation', () => {
        if (params.newName && params.newName !== target.name) {
          if (typeof target.rename === 'function') {
            target.rename(params.newName);
          } else {
            target.name = params.newName;
          }
        }
        if (typeof params.length === 'number') {
          assignAnimationLength(target, params.length);
        }
        if (typeof params.loop === 'boolean') {
          if (typeof target.loop === 'string') {
            target.loop = params.loop ? 'loop' : 'once';
          } else {
            target.loop = params.loop;
          }
        }
        if (typeof params.fps === 'number') {
          if (typeof target.snapping !== 'undefined') {
            target.snapping = params.fps;
          } else {
            target.fps = params.fps;
          }
        }
      });
      this.log.info('animation updated', { name: params.name, newName: params.newName });
      return null;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'animation update failed';
      this.log.error('animation update error', { message });
      return { code: 'unknown', message };
    }
  }

  deleteAnimation(params: DeleteAnimationCommand): ToolError | null {
    try {
      const animations = getAnimations();
      const target = this.findAnimationRef(params.name, params.id, animations);
      if (!target) {
        const label = params.id ?? params.name ?? 'unknown';
        return { code: 'invalid_payload', message: `Animation clip not found: ${label}` };
      }
      this.withUndo({ animations: true }, 'Delete animation', () => {
        if (typeof target.remove === 'function') {
          target.remove();
          return;
        }
        if (typeof target.delete === 'function') {
          target.delete();
          return;
        }
        const list = animations;
        if (Array.isArray(list)) {
          const idx = list.indexOf(target);
          if (idx >= 0) list.splice(idx, 1);
        }
      });
      this.log.info('animation deleted', { name: target?.name ?? params.name });
      return null;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'animation delete failed';
      this.log.error('animation delete error', { message });
      return { code: 'unknown', message };
    }
  }

  setKeyframes(params: KeyframeCommand): ToolError | null {
    try {
      const { Animator: AnimatorCtor } = readGlobals();
      if (typeof AnimatorCtor === 'undefined') {
        return { code: 'not_implemented', message: 'Animator API not available' };
      }
      this.withUndo({ animations: true, keyframes: [] }, 'Set keyframes', () => {
        const animations = getAnimations();
        const clip = this.findAnimationRef(params.clip, params.clipId, animations);
        if (!clip) {
          const label = params.clipId ?? params.clip;
          throw new Error(`Animation clip not found: ${label}`);
        }
        if (clip) {
          const animator = clip.animators?.[params.bone] || new AnimatorCtor(params.bone, clip);
          clip.animators ??= {};
          clip.animators[params.bone] = animator;
          params.keys.forEach((k) => {
            const kf = animator?.createKeyframe?.(params.channel, k.time);
            if (kf?.set) {
              kf.set('data_points', k.value);
              if (k.interp) kf.set('interpolation', k.interp);
            } else if (kf) {
              kf.data_points = k.value;
              if (k.interp) kf.interpolation = k.interp;
            }
          });
        }
      });
      this.log.info('keyframes set', { clip: params.clip, bone: params.bone, count: params.keys.length });
      return null;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'keyframe set failed';
      this.log.error('keyframe set error', { message });
      if (message.includes('Animation clip not found')) {
        return { code: 'invalid_payload', message };
      }
      return { code: 'unknown', message };
    }
  }

  renderPreview(params: RenderPreviewPayload): { result?: RenderPreviewResult; error?: ToolError } {
    const globals = readGlobals();
    const previewRegistry = globals.Preview;
    const outputKind: RenderPreviewOutputKind =
      params.output ?? (params.mode === 'turntable' ? 'sequence' : 'single');
    if (params.mode === 'fixed' && outputKind !== 'single') {
      return {
        error: {
          code: 'invalid_payload',
          message: 'fixed mode only supports single output',
          fix: 'Set output="single" or use mode="turntable" for a sequence.'
        }
      };
    }
    if (params.mode === 'turntable' && outputKind !== 'sequence') {
      return {
        error: {
          code: 'invalid_payload',
          message: 'turntable mode only supports sequence output',
          fix: 'Set output="sequence" or use mode="fixed" for a single frame.'
        }
      };
    }
    const preview = previewRegistry?.selected ?? previewRegistry?.all?.find?.((p: any) => p?.canvas) ?? null;
    const canvas = (preview?.canvas ??
      preview?.renderer?.domElement ??
      document?.querySelector?.('canvas')) as HTMLCanvasElement | null;
    if (!canvas || !canvas.toDataURL) {
      return { error: { code: 'not_implemented', message: 'preview canvas not available' } };
    }
    if (!canvas.width || !canvas.height) {
      return { error: { code: 'not_implemented', message: 'preview canvas has no size' } };
    }
    const controls = preview?.controls ?? null;
    const camera = preview?.camera ?? null;
    if (params.angle && !controls) {
      return {
        error: {
          code: 'not_implemented',
          message: 'preview controls not available for angle',
          fix: 'Open a preview viewport and retry.'
        }
      };
    }
    if (params.mode === 'turntable' && !controls) {
      return {
        error: {
          code: 'not_implemented',
          message: 'turntable preview controls not available',
          fix: 'Open a preview viewport and retry.'
        }
      };
    }

    const state = snapshotCamera(camera, controls);
    const animationState = snapshotAnimation();
    try {
      if (typeof params.timeSeconds === 'number' && !params.clip) {
        return { error: { code: 'invalid_payload', message: 'clip is required when timeSeconds is set' } };
      }
      if (params.clip) {
        if (typeof params.timeSeconds === 'number' && params.timeSeconds < 0) {
          return { error: { code: 'invalid_payload', message: 'timeSeconds must be >= 0' } };
        }
        const applied = applyAnimationState(params.clip, params.timeSeconds ?? 0);
        if (!applied.ok) {
          return { error: applied.error };
        }
      }

        if (params.mode === 'turntable' && params.angle) {
          return {
            error: {
              code: 'invalid_payload',
              message: 'angle is only supported for fixed previews',
              fix: 'Remove angle or switch to mode="fixed".'
            }
          };
        }
        if (params.mode === 'fixed' && params.angle) {
          applyAngle(controls, camera, normalizeAngle(params.angle));
        }

        const renderFrame = () => {
          controls?.update?.();
          preview?.render?.();
        };

        if (outputKind === 'single') {
          renderFrame();
          const dataUrl = canvas.toDataURL('image/png');
          const parsed = parseDataUrl(dataUrl);
          if (!parsed.ok) {
            return { error: { code: 'io_error', message: parsed.message } };
          }
          const size = { width: canvas.width, height: canvas.height };
          this.log.info('preview captured', { kind: outputKind });
          return {
            result: {
              kind: outputKind,
              frameCount: 1,
              image: { ...parsed.value, ...size }
            }
          };
        }

        if (params.mode !== 'turntable') {
          return { error: { code: 'invalid_payload', message: 'fixed mode only supports single output' } };
        }

      const fps = params.fps ?? DEFAULT_TURNTABLE_FPS;
      const durationSeconds = params.durationSeconds ?? DEFAULT_TURNTABLE_SECONDS;
      if (!Number.isFinite(fps) || fps <= 0 || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
        return { error: { code: 'invalid_payload', message: 'fps and durationSeconds must be > 0' } };
      }
      const frameCount = Math.max(1, Math.round(durationSeconds * fps));
      const step = (Math.PI * 2) / frameCount;

        const frames: RenderPreviewResult['frames'] = [];
        const size = { width: canvas.width, height: canvas.height };
        for (let i = 0; i < frameCount; i += 1) {
          if (i > 0) controls.rotateLeft?.(step);
          renderFrame();
          const dataUrl = canvas.toDataURL('image/png');
          const parsed = parseDataUrl(dataUrl);
          if (!parsed.ok) {
            return { error: { code: 'io_error', message: parsed.message } };
          }
          frames.push({ index: i + 1, ...parsed.value, ...size });
        }
        this.log.info('preview sequence captured', { frames: frameCount });
        return {
          result: {
            kind: outputKind,
            frameCount,
            frames
          }
        };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'render preview failed';
      this.log.error('preview error', { message });
      return { error: { code: 'unknown', message } };
    } finally {
      restoreCamera(camera, controls, state);
      restoreAnimation(animationState);
      controls?.update?.();
      preview?.render?.();
    }
  }

  writeFile(path: string, contents: string): ToolError | null {
    try {
      const blockbench = (globalThis as any).Blockbench;
      if (!blockbench?.writeFile) {
        return { code: 'not_implemented', message: 'Blockbench.writeFile not available' };
      }
      blockbench.writeFile(path, { content: contents, savetype: 'text' });
      return null;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'write failed';
      this.log.error('write file error', { message });
      return { code: 'io_error', message };
    }
  }

  listTextures(): TextureStat[] {
    const { Texture: TextureCtor } = readGlobals();
    const textures = TextureCtor?.all ?? [];
    if (!Array.isArray(textures)) return [];
    return textures.map((tex: any) => ({
      id: readTextureId(tex),
      name: tex?.name ?? tex?.id ?? 'texture',
      width: tex?.width ?? tex?.img?.naturalWidth ?? 0,
      height: tex?.height ?? tex?.img?.naturalHeight ?? 0,
      path: tex?.path ?? tex?.source
    }));
  }

  private findGroup(name?: string): any {
    const outliner = (globalThis as any).Outliner;
    if (!name) return null;
    const toArray = (value: any): any[] => {
      if (!value) return [];
      if (Array.isArray(value)) return value;
      return [value];
    };
    const search = (nodes: any): any | null => {
      for (const n of toArray(nodes)) {
        if (n?.name === name && isGroupNode(n)) return n;
        const children = Array.isArray(n?.children) ? n.children : [];
        if (children.length > 0) {
          const found = search(children);
          if (found) return found;
        }
      }
      return null;
    };
    return search(outliner?.root ?? []);
  }

  private findGroupRef(name?: string, id?: string): any {
    if (id) {
      const byId = this.findOutlinerNode((node) => isGroupNode(node) && readNodeId(node) === id);
      if (byId) return byId;
    }
    if (name) return this.findGroup(name);
    return null;
  }

  private findCube(name?: string): any {
    const outliner = (globalThis as any).Outliner;
    if (!name) return null;
    const toArray = (value: any): any[] => {
      if (!value) return [];
      if (Array.isArray(value)) return value;
      return [value];
    };
    const search = (nodes: any): any | null => {
      for (const n of toArray(nodes)) {
        if (n?.name === name && isCubeNode(n)) return n;
        const children = Array.isArray(n?.children) ? n.children : [];
        if (children.length > 0) {
          const found = search(children);
          if (found) return found;
        }
      }
      return null;
    };
    return search(outliner?.root ?? []);
  }

  private findCubeRef(name?: string, id?: string): any {
    if (id) {
      const byId = this.findOutlinerNode((node) => isCubeNode(node) && readNodeId(node) === id);
      if (byId) return byId;
    }
    if (name) return this.findCube(name);
    return null;
  }

  private findTextureRef(name?: string, id?: string): any {
    const { Texture: TextureCtor } = readGlobals();
    const textures = TextureCtor?.all ?? [];
    if (!Array.isArray(textures)) return null;
    if (id) {
      const byId = textures.find((tex: any) => readTextureId(tex) === id);
      if (byId) return byId;
    }
    if (name) return textures.find((tex: any) => tex?.name === name || tex?.id === name) ?? null;
    return null;
  }

  private findAnimationRef(name?: string, id?: string, list?: any[]): any {
    const animations = list ?? getAnimations();
    if (id) {
      const byId = animations.find((anim) => readAnimationId(anim) === id);
      if (byId) return byId;
    }
    if (name) return animations.find((anim) => anim?.name === name) ?? null;
    return null;
  }

  private findOutlinerNode(match: (node: any) => boolean): any {
    const outliner = (globalThis as any).Outliner;
    const toArray = (value: any): any[] => {
      if (!value) return [];
      if (Array.isArray(value)) return value;
      return [value];
    };
    const search = (nodes: any): any | null => {
      for (const n of toArray(nodes)) {
        if (match(n)) return n;
        const children = Array.isArray(n?.children) ? n.children : [];
        if (children.length > 0) {
          const found = search(children);
          if (found) return found;
        }
      }
      return null;
    };
    return search(outliner?.root ?? []);
  }

  private withUndo(aspects: any, editName: string, fn: () => void) {
    const globals = readGlobals();
    const blockbench = globals.Blockbench;
    const undo = globals.Undo;
    const normalized = normalizeEditAspects(aspects);
    if (typeof blockbench?.edit === 'function') {
      blockbench.edit(normalized, fn);
      return;
    } else if (undo?.initEdit && undo?.finishEdit) {
      undo.initEdit(normalized);
      fn();
      undo.finishEdit(editName);
    } else {
      fn();
    }
  }
}

function getAnimations(): any[] {
  const global = globalThis as any;
  const animationGlobal = (globalThis as any).Animation;
  if (Array.isArray(global.Animations)) return global.Animations;
  if (Array.isArray(animationGlobal?.all)) return animationGlobal.all;
  return [];
}

type CameraSnapshot = {
  position: { x: number; y: number; z: number } | null;
  quaternion: { x: number; y: number; z: number; w: number } | null;
  target: { x: number; y: number; z: number } | null;
  zoom: number | null;
};

function snapshotCamera(camera: any, controls: any): CameraSnapshot {
  return {
    position: camera?.position
      ? { x: camera.position.x, y: camera.position.y, z: camera.position.z }
      : null,
    quaternion: camera?.quaternion
      ? { x: camera.quaternion.x, y: camera.quaternion.y, z: camera.quaternion.z, w: camera.quaternion.w }
      : null,
    target: controls?.target ? { x: controls.target.x, y: controls.target.y, z: controls.target.z } : null,
    zoom: typeof camera?.zoom === 'number' ? camera.zoom : null
  };
}

function restoreCamera(camera: any, controls: any, state: CameraSnapshot) {
  if (camera?.position && state.position) {
    if (typeof camera.position.set === 'function') {
      camera.position.set(state.position.x, state.position.y, state.position.z);
    } else {
      camera.position.x = state.position.x;
      camera.position.y = state.position.y;
      camera.position.z = state.position.z;
    }
  }
  if (camera?.quaternion && state.quaternion) {
    if (typeof camera.quaternion.set === 'function') {
      camera.quaternion.set(state.quaternion.x, state.quaternion.y, state.quaternion.z, state.quaternion.w);
    } else {
      camera.quaternion.x = state.quaternion.x;
      camera.quaternion.y = state.quaternion.y;
      camera.quaternion.z = state.quaternion.z;
      camera.quaternion.w = state.quaternion.w;
    }
  }
  if (controls?.target && state.target) {
    if (typeof controls.target.set === 'function') {
      controls.target.set(state.target.x, state.target.y, state.target.z);
    } else {
      controls.target.x = state.target.x;
      controls.target.y = state.target.y;
      controls.target.z = state.target.z;
    }
  }
  if (typeof state.zoom === 'number' && typeof camera?.zoom === 'number') {
    camera.zoom = state.zoom;
    camera.updateProjectionMatrix?.();
  }
}

type AnimationSnapshot = {
  selectedName: string | null;
  timeSeconds: number | null;
};

function snapshotAnimation(): AnimationSnapshot {
  const animationGlobal = (globalThis as any).Animation;
  const selected = animationGlobal?.selected ?? (globalThis as any)?.Animation?.selected;
  const selectedName = selected?.name ?? null;
  const timeSeconds =
    typeof selected?.time === 'number'
      ? selected.time
      : typeof (globalThis as any)?.Animator?.time === 'number'
        ? (globalThis as any).Animator.time
        : null;
  return { selectedName, timeSeconds };
}

function applyAnimationState(clipName: string | undefined, timeSeconds: number): { ok: true } | { ok: false; error: ToolError } {
  if (!clipName) return { ok: true };
  const animations = getAnimations();
  const clip = animations.find((a) => a.name === clipName);
  if (!clip) {
    return { ok: false, error: { code: 'invalid_payload', message: `animation clip not found: ${clipName}` } };
  }
  const maxTime = Number(clip?.length ?? clip?.animation_length ?? clip?.duration ?? NaN);
  const clampedTime = Number.isFinite(maxTime) && maxTime > 0 ? Math.min(Math.max(timeSeconds, 0), maxTime) : timeSeconds;
  if (typeof clip.select === 'function') {
    clip.select();
  } else if ((globalThis as any).Animation?.selected) {
    (globalThis as any).Animation.selected = clip;
  }
  if (Number.isFinite(clampedTime)) {
    if (typeof clip.setTime === 'function') {
      clip.setTime(clampedTime);
    } else if (typeof (globalThis as any).Animator?.setTime === 'function') {
      (globalThis as any).Animator.setTime(clampedTime);
    } else if (typeof (globalThis as any).Animator?.preview === 'function') {
      (globalThis as any).Animator.preview(clampedTime);
    } else if (typeof clip.time === 'number') {
      clip.time = clampedTime;
    }
  }
  return { ok: true };
}

function restoreAnimation(snapshot: AnimationSnapshot) {
  if (!snapshot.selectedName) return;
  const animations = getAnimations();
  const clip = animations.find((a) => a.name === snapshot.selectedName);
  if (!clip) return;
  if (typeof clip.select === 'function') {
    clip.select();
  } else if ((globalThis as any).Animation?.selected) {
    (globalThis as any).Animation.selected = clip;
  }
  if (typeof snapshot.timeSeconds === 'number') {
    if (typeof clip.setTime === 'function') {
      clip.setTime(snapshot.timeSeconds);
    } else if (typeof (globalThis as any).Animator?.setTime === 'function') {
      (globalThis as any).Animator.setTime(snapshot.timeSeconds);
    } else if (typeof (globalThis as any).Animator?.preview === 'function') {
      (globalThis as any).Animator.preview(snapshot.timeSeconds);
    } else if (typeof clip.time === 'number') {
      clip.time = snapshot.timeSeconds;
    }
  }
}

function applyRoll(camera: any, radians: number) {
  if (!camera) return;
  if (typeof camera.rotateZ === 'function') {
    camera.rotateZ(radians);
    return;
  }
  if (camera.rotation && typeof camera.rotation.z === 'number') {
    camera.rotation.z += radians;
    return;
  }
  if (camera.quaternion && typeof camera.quaternion.setFromAxisAngle === 'function') {
    const axis = { x: 0, y: 0, z: 1 };
    camera.quaternion.setFromAxisAngle(axis, radians);
  }
}

type AngleTuple = [number, number, number];

const normalizeAngle = (angle: [number, number] | [number, number, number]): AngleTuple => {
  const [pitch, yaw, roll] = angle;
  return [pitch, yaw, roll ?? 0];
};

const applyAngle = (controls: any, camera: any, angle: AngleTuple) => {
  if (!controls) return;
  const [pitch, yaw, roll] = angle;
  if (Number.isFinite(pitch)) controls.rotateUp?.(pitch * DEG_TO_RAD);
  if (Number.isFinite(yaw)) controls.rotateLeft?.(yaw * DEG_TO_RAD);
  if (Number.isFinite(roll)) applyRoll(camera, roll * DEG_TO_RAD);
};

function normalizeEditAspects(aspects: any) {
  if (!aspects || typeof aspects !== 'object') return aspects;
  const normalized = { ...aspects };
  const arrayKeys = ['elements', 'outliner', 'textures', 'animations', 'keyframes'];
  arrayKeys.forEach((key) => {
    if (normalized[key] === true) normalized[key] = [];
  });
  return normalized;
}

function isGroupNode(node: any): boolean {
  if (!node) return false;
  const groupCtor = (globalThis as any).Group;
  if (groupCtor && node instanceof groupCtor) return true;
  return Array.isArray(node.children);
}

function isCubeNode(node: any): boolean {
  if (!node) return false;
  const cubeCtor = (globalThis as any).Cube;
  if (cubeCtor && node instanceof cubeCtor) return true;
  return node.from !== undefined && node.to !== undefined;
}

function readNodeId(node: any): string | null {
  if (!node) return null;
  const raw = node.bbmcpId ?? node.uuid ?? node.id ?? node.uid ?? node._uuid ?? null;
  return raw ? String(raw) : null;
}

function readTextureId(tex: any): string | null {
  if (!tex) return null;
  const raw = tex.bbmcpId ?? tex.uuid ?? tex.id ?? tex.uid ?? tex._uuid ?? null;
  return raw ? String(raw) : null;
}

function readAnimationId(anim: any): string | null {
  if (!anim) return null;
  const raw = anim.bbmcpId ?? anim.uuid ?? anim.id ?? anim.uid ?? anim._uuid ?? null;
  return raw ? String(raw) : null;
}

function assignVec3(target: any, key: string, value: [number, number, number]) {
  if (!target) return;
  const current = target[key];
  if (current && typeof current.set === 'function') {
    current.set(value[0], value[1], value[2]);
    return;
  }
  if (Array.isArray(current)) {
    target[key] = [...value];
    return;
  }
  if (current && typeof current === 'object') {
    current.x = value[0];
    current.y = value[1];
    current.z = value[2];
    return;
  }
  target[key] = [...value];
}

function assignVec2(target: any, key: string, value: [number, number]) {
  if (!target) return;
  const current = target[key];
  if (current && typeof current.set === 'function') {
    current.set(value[0], value[1]);
    return;
  }
  if (Array.isArray(current)) {
    target[key] = [...value];
    return;
  }
  if (current && typeof current === 'object') {
    current.x = value[0];
    current.y = value[1];
    return;
  }
  target[key] = [...value];
}

function assignAnimationLength(target: any, value: number) {
  if (!target) return;
  if (typeof target.length === 'number') {
    target.length = value;
  }
  if (typeof target.animation_length === 'number') {
    target.animation_length = value;
  }
  if (typeof target.duration === 'number') {
    target.duration = value;
  }
}

function getTextureDataUri(tex: any): string | null {
  if (!tex) return null;
  if (typeof tex.getDataUrl === 'function') {
    return tex.getDataUrl();
  }
  if (typeof tex.getBase64 === 'function') {
    return tex.getBase64();
  }
  if (typeof tex.toDataURL === 'function') {
    return tex.toDataURL('image/png');
  }
  const canvas = tex.canvas;
  if (canvas && typeof canvas.toDataURL === 'function') {
    return canvas.toDataURL('image/png');
  }
  const img = tex.img;
  const doc = (globalThis as any).document;
  if (img && doc?.createElement) {
    const temp = doc.createElement('canvas') as HTMLCanvasElement | null;
    if (!temp) return null;
    const width = img.naturalWidth ?? img.width ?? 0;
    const height = img.naturalHeight ?? img.height ?? 0;
    if (!width || !height) return null;
    temp.width = width;
    temp.height = height;
    const ctx = temp.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0);
    return temp.toDataURL('image/png');
  }
  return null;
}

function moveOutlinerNode(node: any, parent: any, outliner: any, log: Logger, kind: 'bone' | 'cube'): boolean {
  if (!node) return false;
  if (parent === node) return false;
  const currentParent = node.parent ?? null;
  if (parent === currentParent || (!parent && !currentParent)) return true;
  detachFromOutliner(node, outliner);
  return attachToOutliner(parent, outliner, node, log, kind);
}

function removeOutlinerNode(node: any, outliner: any): boolean {
  if (!node) return false;
  if (typeof node.remove === 'function') {
    node.remove();
    return true;
  }
  if (typeof node.delete === 'function') {
    node.delete();
    return true;
  }
  return detachFromOutliner(node, outliner);
}

function detachFromOutliner(node: any, outliner: any): boolean {
  if (!node) return false;
  const parent = node.parent ?? null;
  const removed =
    removeNodeFromCollection(parent?.children, node) ||
    removeNodeFromCollection(outliner?.root, node) ||
    removeNodeFromCollection(outliner?.root?.children, node);
  if (node && 'parent' in node) {
    node.parent = null;
  }
  return removed;
}

function removeNodeFromCollection(collection: any, node: any): boolean {
  if (!Array.isArray(collection)) return false;
  const idx = collection.indexOf(node);
  if (idx < 0) return false;
  collection.splice(idx, 1);
  return true;
}

function normalizeParent(parent: any) {
  if (!parent) return null;
  if (Array.isArray(parent.children)) return parent;
  if (parent.children === undefined) {
    parent.children = [];
    return parent;
  }
  return parent.children && Array.isArray(parent.children) ? parent : null;
}

function attachToOutliner(
  parent: any,
  outliner: any,
  node: any,
  log: Logger,
  kind: 'bone' | 'cube'
): boolean {
  if (!parent && isNodeInOutlinerRoot(outliner, node)) return true;

  if (parent && isNodeInParent(parent, node)) return true;
  if (parent && typeof node?.addTo === 'function') {
    try {
      node.addTo(parent);
      if (isNodeInParent(parent, node)) return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.warn(`${kind} addTo parent failed; fallback to root`, { message });
    }
  }

  const root = outliner?.root;
  if (Array.isArray(root)) {
    if (!root.includes(node)) root.push(node);
    return true;
  }
  if (root && Array.isArray(root.children)) {
    if (!root.children.includes(node)) root.children.push(node);
    return true;
  }
  if (outliner && !root) {
    outliner.root = [node];
    return true;
  }
  return false;
}

function isNodeInParent(parent: any, node: any): boolean {
  if (!parent || !node) return false;
  return Array.isArray(parent.children) && parent.children.includes(node);
}

function isNodeInOutlinerRoot(outliner: any, node: any): boolean {
  if (!outliner || !node) return false;
  const root = outliner.root;
  if (Array.isArray(root) && root.includes(node)) return true;
  return Array.isArray(root?.children) && root.children.includes(node);
}

function hasUnsavedChanges(blockbench: any): boolean {
  try {
    if (typeof blockbench?.hasUnsavedChanges === 'function') {
      const result = blockbench.hasUnsavedChanges();
      if (typeof result === 'boolean') return result;
    }
    const project = blockbench?.project ?? (globalThis as any).Project ?? null;
    if (project) {
      if (typeof project.saved === 'boolean') return !project.saved;
      if (typeof project.isSaved === 'boolean') return !project.isSaved;
      if (typeof project.dirty === 'boolean') return project.dirty;
      if (typeof project.isDirty === 'boolean') return project.isDirty;
      if (typeof project.unsaved === 'boolean') return project.unsaved;
      if (typeof project.hasUnsavedChanges === 'function') {
        return Boolean(project.hasUnsavedChanges());
      }
    }
  } catch {
    return false;
  }
  return false;
}

function markProjectSaved(blockbench: any): void {
  try {
    const project = blockbench?.project ?? (globalThis as any).Project ?? null;
    if (!project) return;
    if (typeof project.markSaved === 'function') {
      project.markSaved();
    }
    if (typeof project.saved === 'boolean') project.saved = true;
    if (typeof project.isSaved === 'boolean') project.isSaved = true;
    if (typeof project.dirty === 'boolean') project.dirty = false;
    if (typeof project.isDirty === 'boolean') project.isDirty = false;
    if (typeof project.unsaved === 'boolean') project.unsaved = false;
  } catch {
    // Best-effort: some Blockbench builds may not expose these fields.
  }
}

function tryAutoConfirmProjectDialog(
  projectName: string,
  options?: { dialog?: Record<string, unknown>; confirmDialog?: boolean }
): { ok: true } | { ok: false; error: ToolError } {
  const dialogApi = (globalThis as any).Dialog;
  const dialog = dialogApi?.open;
  if (!dialog || typeof dialog.getFormResult !== 'function') {
    return { ok: true };
  }
  const current = dialog.getFormResult() ?? {};
  const allowed = new Set(Object.keys(current));
  const values: Record<string, unknown> = { ...current };
  if (options?.dialog) {
    for (const [key, value] of Object.entries(options.dialog)) {
      if (allowed.has(key)) values[key] = value;
    }
  }
  if (allowed.has('name') && !('name' in (options?.dialog ?? {}))) {
    values.name = projectName;
  } else if (allowed.has('project_name') && !('project_name' in (options?.dialog ?? {}))) {
    values.project_name = projectName;
  }
  if (typeof dialog.setFormValues === 'function') {
    dialog.setFormValues(values, true);
  }
  if (options?.confirmDialog !== false && typeof dialog.confirm === 'function') {
    dialog.confirm();
  }
  if (dialogApi?.open === dialog) {
    const remaining = dialog.getFormResult?.() ?? {};
    const missing = Object.entries(remaining)
      .filter(([, value]) => value === '' || value === null || value === undefined)
      .map(([key]) => key);
    return {
      ok: false,
      error: {
        code: 'invalid_state',
        message: 'Project dialog requires input. Provide create_project.dialog values and set confirmDialog=true.',
        details: { fields: remaining, missing }
      }
    };
  }
  return { ok: true };
}
