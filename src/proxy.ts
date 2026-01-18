import { Logger } from './logging';
import { ProjectStateDetail, RenderPreviewPayload, RenderPreviewResult, ToolError, ToolResponse } from './types';
import {
  ApplyAnimSpecPayload,
  ApplyModelSpecPayload,
  ApplyProjectSpecPayload,
  ApplyTextureSpecPayload,
  ProxyTool,
  AnimInterp,
  TextureImportSpec,
  TextureSpec,
  TextureOp
} from './spec';
import { ToolService } from './usecases/ToolService';
import { TextureSource } from './ports/editor';
import { UsecaseResult } from './usecases/result';
import { buildRenderPreviewContent, buildRenderPreviewStructured } from './mcp/content';
import { Limits } from './types';
import { buildRigTemplate } from './templates';
import { readBlockbenchGlobals } from './types/blockbench';

const MAX_KEYS = 4096;
const SUPPORTED_INTERP: AnimInterp[] = ['linear', 'step', 'catmullrom'];

export class ProxyRouter {
  private readonly service: ToolService;
  private readonly log: Logger;
  private readonly limits: Limits;
  private readonly includeStateByDefault: () => boolean;
  private readonly includeDiffByDefault: () => boolean;

  constructor(
    service: ToolService,
    log: Logger,
    limits: Limits,
    options?: { includeStateByDefault?: boolean | (() => boolean); includeDiffByDefault?: boolean | (() => boolean) }
  ) {
    this.service = service;
    this.log = log;
    this.limits = limits;
    const flag = options?.includeStateByDefault;
    this.includeStateByDefault = typeof flag === 'function' ? flag : () => Boolean(flag);
    const diffFlag = options?.includeDiffByDefault;
    this.includeDiffByDefault = typeof diffFlag === 'function' ? diffFlag : () => Boolean(diffFlag);
  }

  applyModelSpec(payload: ApplyModelSpecPayload): ToolResponse<unknown> {
    const v = validateModelSpec(payload, this.limits);
    if (!v.ok) return v;
    const includeState = resolveIncludeState(payload.includeState, this.includeStateByDefault);
    const meta: MetaOptions = {
      includeState,
      includeDiff: resolveIncludeDiff(payload.includeDiff, this.includeDiffByDefault),
      diffDetail: resolveDiffDetail(payload.diffDetail),
      ifRevision: payload.ifRevision
    };
    const revisionError = guardRevision(this.service, payload.ifRevision, meta);
    if (revisionError) return revisionError;
    return this.runWithoutRevisionGuard(() => {
      const report = createApplyReport();
      const result = applyModelSpecSteps(this.service, this.log, payload, report, meta);
      if (!result.ok) return result;
      return { ok: true, data: withMeta({ applied: true, report }, meta, this.service) };
    });
  }

  applyTextureSpec(payload: ApplyTextureSpecPayload): ToolResponse<unknown> {
    const v = validateTextureSpec(payload, this.limits);
    if (!v.ok) return v;
    const includeState = resolveIncludeState(payload.includeState, this.includeStateByDefault);
    const meta: MetaOptions = {
      includeState,
      includeDiff: resolveIncludeDiff(payload.includeDiff, this.includeDiffByDefault),
      diffDetail: resolveDiffDetail(payload.diffDetail),
      ifRevision: payload.ifRevision
    };
    const guard = guardRevision(this.service, payload.ifRevision, meta);
    if (guard) return guard;
    return this.runWithoutRevisionGuard(() => {
      const report = createApplyReport();
      const result = applyTextureSpecSteps(this.service, this.limits, payload.textures, report, meta);
      if (!result.ok) return result;
      this.log.info('applyTextureSpec applied', { textures: payload.textures.length });
      return { ok: true, data: withMeta({ applied: true, report }, meta, this.service) };
    });
  }

  applyAnimSpec(payload: ApplyAnimSpecPayload): ToolResponse<unknown> {
    const v = validateAnimSpec(payload);
    if (!v.ok) return v;
    const a = payload.animation;
    const includeState = resolveIncludeState(payload.includeState, this.includeStateByDefault);
    const meta: MetaOptions = {
      includeState,
      includeDiff: resolveIncludeDiff(payload.includeDiff, this.includeDiffByDefault),
      diffDetail: resolveDiffDetail(payload.diffDetail),
      ifRevision: payload.ifRevision
    };
    const guard = guardRevision(this.service, payload.ifRevision, meta);
    if (guard) return guard;
    return this.runWithoutRevisionGuard(() => {
      const report = createApplyReport();
      const result = applyAnimSpecSteps(this.service, a, report, meta);
      if (!result.ok) return result;
      this.log.info('applyAnimSpec applied', { clip: a.clip, channels: a.channels.length });
      return { ok: true, data: withMeta({ applied: true, report }, meta, this.service) };
    });
  }

  applyProjectSpec(payload: ApplyProjectSpecPayload): ToolResponse<unknown> {
    const v = validateProjectSpec(payload, this.limits);
    if (!v.ok) return v;
    const includeState = resolveIncludeState(payload.includeState, this.includeStateByDefault);
    const meta: MetaOptions = {
      includeState,
      includeDiff: resolveIncludeDiff(payload.includeDiff, this.includeDiffByDefault),
      diffDetail: resolveDiffDetail(payload.diffDetail),
      ifRevision: payload.ifRevision
    };
    const guard = guardRevision(this.service, payload.ifRevision, meta);
    if (guard) return guard;
    return this.runWithoutRevisionGuard(() => {
      const report = createApplyReport();
      const projectMode = resolveProjectMode(payload.projectMode);
      if (payload.model) {
        const action = resolveProjectAction(this.service, payload.model.format, projectMode, meta);
        if (!action.ok) return action;
        const modelPayload: ApplyModelSpecPayload = {
          model: payload.model,
          textures: payload.imports,
          ifRevision: payload.ifRevision
        };
        const modelRes = applyModelSpecSteps(this.service, this.log, modelPayload, report, meta, {
          createProject: action.data.action === 'create'
        });
        if (!modelRes.ok) return modelRes;
      } else {
        if (projectMode === 'create') {
          return err('invalid_payload', 'projectMode=create requires model');
        }
        const activeCheck = ensureActiveProject(this.service, meta);
        if (!activeCheck.ok) return activeCheck;
        if (payload.imports && payload.imports.length > 0) {
          const importRes = applyTextureImports(this.service, payload.imports, report, meta);
          if (!importRes.ok) return importRes;
        }
      }
      if (payload.textures && payload.textures.length > 0) {
        const texRes = applyTextureSpecSteps(this.service, this.limits, payload.textures, report, meta);
        if (!texRes.ok) return texRes;
      }
      if (payload.animation) {
        const animRes = applyAnimSpecSteps(this.service, payload.animation, report, meta);
        if (!animRes.ok) return animRes;
      }
      this.log.info('applyProjectSpec applied', {
        model: Boolean(payload.model),
        imports: payload.imports?.length ?? 0,
        textures: payload.textures?.length ?? 0,
        animation: Boolean(payload.animation)
      });
      return { ok: true, data: withMeta({ applied: true, report }, meta, this.service) };
    });
  }

  handle(tool: ProxyTool, payload: unknown): ToolResponse<unknown> {
    try {
      switch (tool) {
        case 'apply_model_spec':
          return this.applyModelSpec(payload as ApplyModelSpecPayload);
        case 'apply_texture_spec':
          return this.applyTextureSpec(payload as ApplyTextureSpecPayload);
        case 'apply_anim_spec':
          return this.applyAnimSpec(payload as ApplyAnimSpecPayload);
        case 'apply_project_spec':
          return this.applyProjectSpec(payload as ApplyProjectSpecPayload);
        case 'render_preview':
          return attachRenderPreviewContent(
            toToolResponse(this.service.renderPreview(payload as RenderPreviewPayload))
          );
        case 'validate':
          return toToolResponse(this.service.validate());
        default:
          return { ok: false, error: { code: 'unknown', message: `Unknown proxy tool ${tool}` } };
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown error';
      this.log.error('proxy handle error', { tool, message });
      return { ok: false, error: { code: 'unknown', message } };
    }
  }

  private runWithoutRevisionGuard<T>(fn: () => T): T {
    const runner = (this.service as { runWithoutRevisionGuard?: (inner: () => T) => T }).runWithoutRevisionGuard;
    if (typeof runner === 'function') return runner.call(this.service, fn);
    return fn();
  }
}

function validateModelSpec(payload: ApplyModelSpecPayload, limits: Limits): ToolResponse<unknown> {
  if (!payload.model) return err('invalid_payload', 'model is required');
  const inputParts = payload.model.parts ?? [];
  if (!Array.isArray(inputParts)) return err('invalid_payload', 'parts must be an array');
  const rigTemplate = payload.model.rigTemplate ?? 'empty';
  if (!['empty', 'biped', 'quadruped', 'block_entity'].includes(rigTemplate)) {
    return err('invalid_payload', `unknown rigTemplate: ${rigTemplate}`);
  }
  const templatedParts = buildRigTemplate(rigTemplate, inputParts);
  const cubeCount = templatedParts.filter((part) => !isZeroSize(part.size)).length;
  if (inputParts.length === 0 && templatedParts.length === 0) {
    return err(
      'invalid_payload',
      'parts or rigTemplate must provide parts (set model.rigTemplate or supply model.parts with id/size/offset).'
    );
  }
  if (cubeCount > limits.maxCubes) return err('invalid_payload', `too many parts (>${limits.maxCubes})`);
  const ids = new Set<string>();
  for (const p of inputParts) {
    if (!p.id) return err('invalid_payload', 'part id required');
    if (ids.has(p.id)) return err('invalid_payload', `duplicate part id: ${p.id}`);
    ids.add(p.id);
    if (!Array.isArray(p.size) || p.size.length !== 3) return err('invalid_payload', `size invalid for ${p.id}`);
    if (!Array.isArray(p.offset) || p.offset.length !== 3) return err('invalid_payload', `offset invalid for ${p.id}`);
  }
  for (const p of templatedParts) {
    if (!Array.isArray(p.size) || p.size.length !== 3) return err('invalid_payload', `size invalid for ${p.id}`);
    if (!Array.isArray(p.offset) || p.offset.length !== 3) return err('invalid_payload', `offset invalid for ${p.id}`);
  }
  return { ok: true, data: { valid: true } };
}

function validateProjectSpec(payload: ApplyProjectSpecPayload, limits: Limits): ToolResponse<unknown> {
  if (!payload) return err('invalid_payload', 'payload is required');
  const hasModel = Boolean(payload.model);
  const hasImports = Array.isArray(payload.imports) && payload.imports.length > 0;
  const hasTextures = Array.isArray(payload.textures) && payload.textures.length > 0;
  const hasAnimation = Boolean(payload.animation);
  if (!hasModel && !hasImports && !hasTextures && !hasAnimation) {
    return err('invalid_payload', 'model, imports, textures, or animation is required');
  }
  if (payload.projectMode && !['auto', 'reuse', 'create'].includes(payload.projectMode)) {
    return err('invalid_payload', `invalid projectMode: ${payload.projectMode}`);
  }
  if (!hasModel && payload.projectMode === 'create') {
    return err('invalid_payload', 'projectMode=create requires model');
  }
  if (payload.imports && !Array.isArray(payload.imports)) {
    return err('invalid_payload', 'imports must be an array');
  }
  for (const tex of payload.imports ?? []) {
    if (!tex?.name) return err('invalid_payload', 'import texture name is required');
  }
  if (payload.model) {
    const res = validateModelSpec({ model: payload.model } as ApplyModelSpecPayload, limits);
    if (!res.ok) return res;
  }
  if (payload.textures) {
    const res = validateTextureSpec({ textures: payload.textures } as ApplyTextureSpecPayload, limits);
    if (!res.ok) return res;
  }
  if (payload.animation) {
    const res = validateAnimSpec({ animation: payload.animation } as ApplyAnimSpecPayload);
    if (!res.ok) return res;
  }
  return { ok: true, data: { valid: true } };
}

function validateAnimSpec(payload: ApplyAnimSpecPayload): ToolResponse<unknown> {
  if (!payload.animation) return err('invalid_payload', 'animation is required');
  const { channels, duration, clip } = payload.animation;
  if (!clip) return err('invalid_payload', 'clip name required');
  if (duration <= 0) return err('invalid_payload', 'duration must be > 0');
  if (!Array.isArray(channels) || channels.length === 0) return err('invalid_payload', 'channels required');
  let keyCount = 0;
  for (const ch of channels) {
    if (!ch.bone) return err('invalid_payload', 'channel bone required');
    if (!['rot', 'pos', 'scale'].includes(ch.channel)) return err('invalid_payload', 'channel type invalid');
    if (!Array.isArray(ch.keys) || ch.keys.length === 0) return err('invalid_payload', 'keys required');
    for (const k of ch.keys) {
      keyCount += 1;
      if (keyCount > MAX_KEYS) return err('invalid_payload', `too many keys (>${MAX_KEYS})`);
      if (!Array.isArray(k.value) || k.value.length !== 3) return err('invalid_payload', 'key value invalid');
      if (k.interp && !SUPPORTED_INTERP.includes(k.interp)) {
        return err('invalid_payload', `unsupported interp ${k.interp}`);
      }
    }
  }
  return { ok: true, data: { valid: true } };
}

type ApplyErrorEntry = {
  step: string;
  item?: string;
  message: string;
};

type ApplyReport = {
  applied: { bones: string[]; cubes: string[]; textures: string[]; animations: string[] };
  errors: ApplyErrorEntry[];
};

function createApplyReport(): ApplyReport {
  return { applied: { bones: [], cubes: [], textures: [], animations: [] }, errors: [] };
}

function withReportError(
  error: ToolError,
  report: ApplyReport,
  step: string,
  item: string | undefined,
  meta: MetaOptions,
  service: ToolService
): ToolResponse<unknown> {
  const nextReport = recordApplyError(report, step, item, error.message);
  const details: Record<string, unknown> = { ...(error.details ?? {}), report: nextReport, ...buildMeta(meta, service) };
  return { ok: false, error: { ...error, details } };
}

function recordApplyError(report: ApplyReport, step: string, item: string | undefined, message: string): ApplyReport {
  report.errors.push({ step, item, message });
  return report;
}

function applyTextureImports(
  service: ToolService,
  imports: TextureImportSpec[] | undefined,
  report: ApplyReport,
  meta: MetaOptions
): ToolResponse<ApplyReport> {
  for (const t of imports ?? []) {
    const res = service.importTexture({ id: t.id, name: t.name, dataUri: t.dataUri, path: t.path });
    if (!res.ok) return withReportError(res.error, report, 'import_texture', t.name, meta, service);
    report.applied.textures.push(t.name);
  }
  return { ok: true, data: report };
}

function applyModelSpecSteps(
  service: ToolService,
  log: Logger,
  payload: ApplyModelSpecPayload,
  report: ApplyReport,
  meta: MetaOptions,
  options?: { createProject?: boolean }
): ToolResponse<ApplyReport> {
  if (options?.createProject !== false) {
    const sessionInit = toToolResponse(
      service.createProject(payload.model.format, payload.model.name, { ifRevision: payload.ifRevision })
    );
    if (!sessionInit.ok) return withReportError(sessionInit.error, report, 'create_project', undefined, meta, service);
  }

  const importRes = applyTextureImports(service, payload.textures, report, meta);
  if (!importRes.ok) return importRes;

  const templatedParts = buildRigTemplate(payload.model.rigTemplate, payload.model.parts);
  for (const part of templatedParts) {
    const boneRes = service.addBone({
      id: part.id,
      name: part.id,
      parent: part.parent,
      pivot: part.pivot ?? [0, 0, 0]
    });
    if (!boneRes.ok) return withReportError(boneRes.error, report, 'add_bone', part.id, meta, service);
    report.applied.bones.push(part.id);
    if (isZeroSize(part.size)) continue;
    const from: [number, number, number] = [...part.offset];
    const to: [number, number, number] = [
      part.offset[0] + part.size[0],
      part.offset[1] + part.size[1],
      part.offset[2] + part.size[2]
    ];
    const cubeRes = service.addCube({
      id: part.id,
      name: part.id,
      from,
      to,
      bone: part.id,
      uv: part.uv,
      inflate: part.inflate,
      mirror: part.mirror
    });
    if (!cubeRes.ok) return withReportError(cubeRes.error, report, 'add_cube', part.id, meta, service);
    report.applied.cubes.push(part.id);
  }
  log.info('applyModelSpec applied', { parts: templatedParts.length });
  return { ok: true, data: report };
}

function applyTextureSpecSteps(
  service: ToolService,
  limits: Limits,
  textures: TextureSpec[],
  report: ApplyReport,
  meta: MetaOptions
): ToolResponse<ApplyReport> {
  for (const texture of textures) {
    const label = texture.name ?? texture.targetName ?? texture.targetId ?? 'texture';
    const mode = texture.mode ?? 'create';
    if (mode === 'create') {
      const renderRes = renderTextureSpec(texture, limits);
      if (!renderRes.ok) {
        return withReportError(renderRes.error, report, 'render_texture', label, meta, service);
      }
      const res = service.importTexture({
        id: texture.id,
        name: texture.name ?? label,
        dataUri: renderRes.data.dataUri
      });
      if (!res.ok) return withReportError(res.error, report, 'import_texture', label, meta, service);
      report.applied.textures.push(texture.name ?? label);
      continue;
    }
    if (mode !== 'update') {
      return withReportError(
        { code: 'invalid_payload', message: `unsupported texture mode: ${mode}` },
        report,
        'update_texture',
        label,
        meta,
        service
      );
    }
    if (!texture.targetId && !texture.targetName) {
      return withReportError(
        { code: 'invalid_payload', message: 'targetId or targetName is required for update' },
        report,
        'update_texture',
        label,
        meta,
        service
      );
    }
    let base: { image: CanvasImageSource; width: number; height: number } | null = null;
    if (texture.useExisting) {
      const baseRes = toToolResponse(service.readTexture({ id: texture.targetId, name: texture.targetName }));
      if (!baseRes.ok) return withReportError(baseRes.error, report, 'read_texture', label, meta, service);
      const resolved = resolveTextureBase(baseRes.data);
      if (!resolved.ok) return withReportError(resolved.error, report, 'read_texture', label, meta, service);
      base = resolved.data;
    }
    const renderRes = renderTextureSpec(texture, limits, base ?? undefined);
    if (!renderRes.ok) {
      return withReportError(renderRes.error, report, 'render_texture', label, meta, service);
    }
    const res = service.updateTexture({
      id: texture.targetId,
      name: texture.targetName,
      newName: texture.name,
      dataUri: renderRes.data.dataUri
    });
    if (!res.ok) return withReportError(res.error, report, 'update_texture', label, meta, service);
    report.applied.textures.push(texture.name ?? texture.targetName ?? texture.targetId ?? label);
  }
  return { ok: true, data: report };
}

function applyAnimSpecSteps(
  service: ToolService,
  animation: ApplyAnimSpecPayload['animation'],
  report: ApplyReport,
  meta: MetaOptions
): ToolResponse<ApplyReport> {
  const createRes = toToolResponse(
    service.createAnimationClip({
      name: animation.clip,
      length: animation.duration,
      loop: animation.loop,
      fps: animation.fps,
      ifRevision: meta.ifRevision
    })
  );
  if (!createRes.ok) return withReportError(createRes.error, report, 'create_animation_clip', animation.clip, meta, service);
  const clipId = createRes.data.id;
  for (const ch of animation.channels) {
    const res = toToolResponse(
      service.setKeyframes({
        clipId,
        clip: animation.clip,
        bone: ch.bone,
        channel: ch.channel,
        keys: ch.keys
      })
    );
    if (!res.ok) return withReportError(res.error, report, 'set_keyframes', ch.bone, meta, service);
  }
  report.applied.animations.push(animation.clip);
  return { ok: true, data: report };
}

function resolveProjectMode(mode: ApplyProjectSpecPayload['projectMode']): 'auto' | 'reuse' | 'create' {
  return mode ?? 'auto';
}

function resolveProjectAction(
  service: ToolService,
  format: ApplyModelSpecPayload['model']['format'],
  mode: 'auto' | 'reuse' | 'create',
  meta: MetaOptions
): ToolResponse<{ action: 'create' | 'reuse' }> {
  if (mode === 'create') return { ok: true, data: { action: 'create' } };
  const state = service.getProjectState({ detail: 'summary' });
  if (!state.ok || !state.value.project.active) {
    if (mode === 'reuse') {
      return withErrorMeta(
        { code: 'invalid_state', message: 'No active project to reuse.' },
        meta,
        service
      );
    }
    return { ok: true, data: { action: 'create' } };
  }
  const currentFormat = state.value.project.format;
  if (!currentFormat || currentFormat !== format) {
    if (mode === 'reuse') {
      return withErrorMeta(
        {
          code: 'invalid_state',
          message: `Active project format mismatch (${currentFormat ?? 'unknown'} != ${format}).`
        },
        meta,
        service
      );
    }
    return { ok: true, data: { action: 'create' } };
  }
  return { ok: true, data: { action: 'reuse' } };
}

function ensureActiveProject(service: ToolService, meta: MetaOptions): ToolResponse<{ ok: true }> {
  const state = service.getProjectState({ detail: 'summary' });
  if (state.ok && state.value.project.active) return { ok: true, data: { ok: true } };
  return withErrorMeta({ code: 'invalid_state', message: 'No active project to reuse.' }, meta, service);
}

function validateTextureSpec(payload: ApplyTextureSpecPayload, limits: Limits): ToolResponse<unknown> {
  if (!payload || !Array.isArray(payload.textures) || payload.textures.length === 0) {
    return err('invalid_payload', 'textures array is required');
  }
  for (const tex of payload.textures) {
    const label = tex?.name ?? tex?.targetName ?? tex?.targetId ?? 'texture';
    const mode = tex?.mode ?? 'create';
    if (mode !== 'create' && mode !== 'update') {
      return err('invalid_payload', `unsupported texture mode ${mode} (${label})`);
    }
    if (mode === 'create' && !tex?.name) {
      return err('invalid_payload', `texture name is required (${label})`);
    }
    if (mode === 'update' && !tex?.targetId && !tex?.targetName) {
      return err('invalid_payload', `targetId or targetName is required (${label})`);
    }
    if (!Number.isFinite(tex.width) || tex.width <= 0) {
      return err('invalid_payload', `texture width must be > 0 (${label})`);
    }
    if (!Number.isFinite(tex.height) || tex.height <= 0) {
      return err('invalid_payload', `texture height must be > 0 (${label})`);
    }
    if (Number.isFinite(tex.width) && Number.isFinite(tex.height)) {
      if (tex.width > limits.maxTextureSize || tex.height > limits.maxTextureSize) {
        return err('invalid_payload', `texture size exceeds max ${limits.maxTextureSize} (${label})`);
      }
    }
    if (tex.ops && !Array.isArray(tex.ops)) {
      return err('invalid_payload', `texture ops must be an array (${label})`);
    }
    const ops = Array.isArray(tex.ops) ? tex.ops : [];
    for (const op of ops) {
      if (!isTextureOp(op)) {
        return err('invalid_payload', `invalid texture op (${label})`);
      }
    }
  }
  return { ok: true, data: { valid: true } };
}

function renderTextureSpec(
  spec: TextureSpec,
  limits: Limits,
  base?: { image: CanvasImageSource; width: number; height: number }
): ToolResponse<{ dataUri: string }> {
  const label = spec?.name ?? spec?.targetName ?? spec?.targetId ?? 'texture';
  const width = Number.isFinite(spec.width) ? spec.width : base?.width;
  const height = Number.isFinite(spec.height) ? spec.height : base?.height;
  if (!Number.isFinite(width) || width <= 0) {
    return err('invalid_payload', `texture width must be > 0 (${label})`);
  }
  if (!Number.isFinite(height) || height <= 0) {
    return err('invalid_payload', `texture height must be > 0 (${label})`);
  }
  if (width > limits.maxTextureSize || height > limits.maxTextureSize) {
    return err('invalid_payload', `texture size exceeds max ${limits.maxTextureSize} (${label})`);
  }
  const doc = readBlockbenchGlobals().document;
  if (!doc?.createElement) {
    return err('not_implemented', 'document unavailable for texture rendering');
  }
  const canvas = doc.createElement('canvas') as HTMLCanvasElement | null;
  if (!canvas) return err('not_implemented', 'texture canvas not available');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return err('not_implemented', 'texture canvas context not available');
  ctx.imageSmoothingEnabled = false;
  if (spec.background) {
    ctx.fillStyle = spec.background;
    ctx.fillRect(0, 0, width, height);
  }
  if (base?.image) {
    ctx.drawImage(base.image, 0, 0, width, height);
  }
  for (const op of spec.ops ?? []) {
    const res = applyTextureOp(ctx, op);
    if (!res.ok) return res;
  }
  const dataUri = canvas.toDataURL('image/png');
  return { ok: true, data: { dataUri } };
}

function isTextureOp(op: unknown): op is TextureOp {
  if (!isRecord(op) || typeof op.op !== 'string') return false;
  switch (op.op) {
    case 'set_pixel':
      return isFiniteNumber(op.x) && isFiniteNumber(op.y) && typeof op.color === 'string';
    case 'fill_rect':
    case 'draw_rect':
      return (
        isFiniteNumber(op.x) &&
        isFiniteNumber(op.y) &&
        isFiniteNumber(op.width) &&
        isFiniteNumber(op.height) &&
        typeof op.color === 'string'
      );
    case 'draw_line':
      return (
        isFiniteNumber(op.x1) &&
        isFiniteNumber(op.y1) &&
        isFiniteNumber(op.x2) &&
        isFiniteNumber(op.y2) &&
        typeof op.color === 'string'
      );
    default:
      return false;
  }
}

function applyTextureOp(ctx: CanvasRenderingContext2D, op: TextureOp): ToolResponse<unknown> {
  switch (op.op) {
    case 'set_pixel': {
      ctx.fillStyle = op.color;
      ctx.fillRect(op.x, op.y, 1, 1);
      return { ok: true, data: { ok: true } };
    }
    case 'fill_rect': {
      ctx.fillStyle = op.color;
      ctx.fillRect(op.x, op.y, op.width, op.height);
      return { ok: true, data: { ok: true } };
    }
    case 'draw_rect': {
      ctx.strokeStyle = op.color;
      ctx.lineWidth = isFiniteNumber(op.lineWidth) && op.lineWidth > 0 ? op.lineWidth : 1;
      ctx.strokeRect(op.x, op.y, op.width, op.height);
      return { ok: true, data: { ok: true } };
    }
    case 'draw_line': {
      ctx.strokeStyle = op.color;
      ctx.lineWidth = isFiniteNumber(op.lineWidth) && op.lineWidth > 0 ? op.lineWidth : 1;
      ctx.beginPath();
      ctx.moveTo(op.x1, op.y1);
      ctx.lineTo(op.x2, op.y2);
      ctx.stroke();
      return { ok: true, data: { ok: true } };
    }
    default:
      return err('invalid_payload', `unsupported texture op: ${op.op}`);
  }
}

function isFiniteNumber(value: unknown): value is number {
  return Number.isFinite(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function err(code: 'invalid_payload' | 'not_implemented' | 'unknown', message: string): ToolResponse<unknown> {
  return { ok: false, error: { code, message } };
}

function toToolResponse<T>(result: UsecaseResult<T>): ToolResponse<T> {
  if (result.ok) return { ok: true, data: result.value };
  return { ok: false, error: result.error };
}

function attachRenderPreviewContent(
  response: ToolResponse<RenderPreviewResult>
): ToolResponse<RenderPreviewResult> {
  if (!response.ok) return response;
  const content = buildRenderPreviewContent(response.data);
  const structuredContent = buildRenderPreviewStructured(response.data);
  if (!content.length) {
    return { ...response, structuredContent };
  }
  return { ...response, content, structuredContent };
}

type MetaOptions = {
  includeState: boolean;
  includeDiff: boolean;
  diffDetail: ProjectStateDetail;
  ifRevision?: string;
};

function withMeta<T extends Record<string, unknown>>(
  data: T,
  meta: MetaOptions,
  service: ToolService
): T & { state?: unknown; diff?: unknown; revision?: string } {
  const extra = buildMeta(meta, service);
  if (Object.keys(extra).length === 0) return data;
  return {
    ...data,
    ...extra
  };
}

function resolveIncludeState(flag: boolean | undefined, fallback: () => boolean): boolean {
  if (flag !== undefined) return flag;
  return fallback();
}

function resolveIncludeDiff(flag: boolean | undefined, fallback: () => boolean): boolean {
  if (flag !== undefined) return flag;
  return fallback();
}

function resolveDiffDetail(detail: ProjectStateDetail | undefined): ProjectStateDetail {
  return detail ?? 'summary';
}

function buildMeta(meta: MetaOptions, service: ToolService): Record<string, unknown> {
  const details: Record<string, unknown> = {};
  const state = service.getProjectState({ detail: 'summary' });
  const project = state.ok ? state.value.project : null;
  if (project?.revision) {
    details.revision = project.revision;
  }
  if (meta.includeState) {
    details.state = project;
  }
  if (meta.includeDiff) {
    if (meta.ifRevision) {
      const diff = service.getProjectDiff({ sinceRevision: meta.ifRevision, detail: meta.diffDetail });
      details.diff = diff.ok ? diff.value.diff : null;
    } else {
      details.diff = null;
    }
  }
  return details;
}

function withErrorMeta(error: ToolError, meta: MetaOptions, service: ToolService): ToolResponse<unknown> {
  const extra = buildMeta(meta, service);
  if (Object.keys(extra).length === 0) return { ok: false, error };
  const details = { ...(error.details ?? {}), ...extra };
  return { ok: false, error: { ...error, details } };
}

function guardRevision(service: ToolService, expected: string | undefined, meta: MetaOptions): ToolResponse<unknown> | null {
  const serviceWithRevision = service as {
    isRevisionRequired?: () => boolean;
    getProjectState?: ToolService['getProjectState'];
  };
  const requiresRevision =
    typeof serviceWithRevision.isRevisionRequired === 'function' ? service.isRevisionRequired() : false;
  if (!requiresRevision) return null;
  if (typeof serviceWithRevision.getProjectState !== 'function') return null;
  const state = service.getProjectState({ detail: 'summary' });
  if (!expected) {
    if (!state.ok) return null;
    return withErrorMeta(
      {
        code: 'invalid_state',
        message: 'ifRevision is required. Call get_project_state before mutating.',
        details: { reason: 'missing_ifRevision' }
      },
      meta,
      service
    );
  }
  if (!state.ok) return withErrorMeta(state.error, meta, service);
  const currentRevision = state.value.project.revision;
  if (currentRevision !== expected) {
    return withErrorMeta(
      {
        code: 'invalid_state',
        message: 'Project revision mismatch. Refresh project state before retrying.',
        details: { expected, currentRevision }
      },
      meta,
      service
    );
  }
  return null;
}

function resolveTextureBase(
  source: TextureSource
): ToolResponse<{ image: CanvasImageSource; width: number; height: number }> {
  const image = source.image ?? loadImageFromDataUri(source.dataUri);
  if (!image) return err('not_implemented', 'Texture base image unavailable');
  const width = Number.isFinite(source.width) && source.width > 0 ? source.width : resolveImageDim(image, 'width');
  const height = Number.isFinite(source.height) && source.height > 0 ? source.height : resolveImageDim(image, 'height');
  if (!width || !height) return err('invalid_payload', 'Texture base size unavailable');
  return { ok: true, data: { image, width, height } };
}

function loadImageFromDataUri(dataUri?: string): CanvasImageSource | null {
  if (!dataUri) return null;
  const doc = readBlockbenchGlobals().document;
  if (!doc?.createElement) return null;
  const img = doc.createElement('img') as HTMLImageElement | null;
  if (!img) return null;
  img.src = dataUri;
  const width = img.naturalWidth ?? img.width ?? 0;
  const height = img.naturalHeight ?? img.height ?? 0;
  if (!img.complete || !width || !height) return null;
  return img;
}

function resolveImageDim(image: CanvasImageSource, key: 'width' | 'height'): number {
  const candidate = image as { width?: unknown; height?: unknown; naturalWidth?: unknown; naturalHeight?: unknown };
  const natural = key === 'width' ? candidate.naturalWidth : candidate.naturalHeight;
  const value = natural ?? candidate[key] ?? 0;
  return Number.isFinite(value) ? value : 0;
}

function isZeroSize(size: [number, number, number]) {
  return size[0] === 0 && size[1] === 0 && size[2] === 0;
}
