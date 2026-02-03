import { Logger } from '../logging';
import { TextureSpec } from '../spec';
import { Limits, ToolError, ToolResponse } from '../types';
import type { DomPort } from '../ports/dom';
import { ToolService } from '../usecases/ToolService';
import { buildMeta, MetaOptions } from './meta';
import { resolveTextureSpecSize } from './texture/specSize';
import { renderTextureSpec, type UvPaintRenderConfig } from './texture/textureRender';
import { errFromDomain } from '../shared/tooling/toolResponse';
import { TextureUsage } from '../domain/model';
import { buildUvPaintConfig } from './texture/uvPaintConfig';
import { checkTextureCoverage } from './texture/applyCoverage';
import type { ApplyReport } from './texture/applyReport';
import { recordApplyError, recordTextureCoverage } from './texture/applyReport';
import { readTextureBase } from './texture/textureBaseReader';
import { checkTextureSize } from './texture/textureSizeCheck';
import {
  TEXTURE_CONTENT_UNCHANGED,
  TEXTURE_MODE_UNSUPPORTED,
  TEXTURE_UPDATE_TARGET_REQUIRED
} from '../shared/messages';

export type { ApplyReport } from './texture/applyReport';
export { createApplyReport } from './texture/applyReport';

export const applyTextureSpecSteps = async (
  service: ToolService,
  dom: DomPort,
  limits: Limits,
  textures: TextureSpec[],
  report: ApplyReport,
  meta: MetaOptions,
  log?: Logger,
  usage?: TextureUsage,
  ifRevision?: string
): Promise<ToolResponse<ApplyReport>> => {
  return await service.runWithoutRevisionGuardAsync(async () => {
    for (const texture of textures) {
      const label = texture.name ?? texture.targetName ?? texture.targetId ?? 'texture';
      const mode = texture.mode ?? 'create';
      const detectNoChange = texture.detectNoChange === true;
      log?.info('applyTextureSpec ops', { texture: label, mode, ops: summarizeOps(texture.ops) });
      const size = resolveTextureSpecSize(texture);
      const uvPaintRes = buildUvPaintConfig({ texture, limits, usage, size });
      if (!uvPaintRes.ok) {
        return withReportError(uvPaintRes.error, report, 'uv_paint', label, meta, service);
      }
      const uvPaintConfig = uvPaintRes.config;
      const uvPaintApplied = uvPaintRes.uvPaintApplied;
      if (mode === 'create') {
        const createRes = await applyCreateTexture({
          service,
          dom,
          limits,
          texture,
          report,
          meta,
          label,
          size,
          uvPaintConfig,
          uvPaintApplied,
          ifRevision
        });
        if (!createRes.ok) return createRes;
        continue;
      }
      if (mode !== 'update') {
        return withReportError(
          { code: 'invalid_payload', message: TEXTURE_MODE_UNSUPPORTED(mode) },
          report,
          'texture_update',
          label,
          meta,
          service
        );
      }
      if (!texture.targetId && !texture.targetName) {
        return withReportError(
          { code: 'invalid_payload', message: TEXTURE_UPDATE_TARGET_REQUIRED },
          report,
          'texture_update',
          label,
          meta,
          service
        );
      }
      const updateRes = await applyUpdateTexture({
        service,
        dom,
        limits,
        texture,
        report,
        meta,
        label,
        size,
        uvPaintConfig,
        detectNoChange,
        log,
        ifRevision
      });
      if (!updateRes.ok) return updateRes;
    }
    return { ok: true, data: report };
  });
};

const withReportError = (
  error: ToolError,
  report: ApplyReport,
  step: string,
  item: string | undefined,
  meta: MetaOptions,
  service: ToolService
): ToolResponse<ApplyReport> => {
  const nextReport = recordApplyError(report, step, item, error.message);
  const details: Record<string, unknown> = { ...(error.details ?? {}), report: nextReport, ...buildMeta(meta, service) };
  return errFromDomain({ ...error, details });
};

const applyCreateTexture = async (args: {
  service: ToolService;
  dom: DomPort;
  limits: Limits;
  texture: TextureSpec;
  report: ApplyReport;
  meta: MetaOptions;
  label: string;
  size: { width?: number; height?: number };
  uvPaintConfig: UvPaintRenderConfig | undefined;
  uvPaintApplied: boolean;
  ifRevision?: string;
}): Promise<ToolResponse<ApplyReport>> => {
  const renderRes = renderTextureSpec(args.dom, args.texture, args.limits, undefined, args.uvPaintConfig);
  if (!renderRes.ok) {
    return withReportError(renderRes.error, args.report, 'render_texture', args.label, args.meta, args.service);
  }
  recordTextureCoverage(args.report, args.texture, renderRes.data, 'create', args.label);
  const coverageError = checkTextureCoverage({
    coverage: renderRes.data.coverage,
    texture: args.texture,
    label: args.label,
    paintCoverage: renderRes.data.paintCoverage,
    usePaintCoverage: args.uvPaintApplied
  });
  if (coverageError) {
    return withReportError(coverageError, args.report, 'texture_coverage', args.label, args.meta, args.service);
  }
  const res = args.service.importTexture({
    id: args.texture.id,
    name: args.texture.name ?? args.label,
    image: renderRes.data.canvas,
    width: args.size.width ?? renderRes.data.width,
    height: args.size.height ?? renderRes.data.height,
    ifRevision: args.ifRevision
  });
  if (!res.ok) return withReportError(res.error, args.report, 'texture_create', args.label, args.meta, args.service);
  const sizeError = checkTextureSize({
    service: args.service,
    texture: args.texture,
    label: args.label,
    expected: args.size
  });
  if (sizeError) {
    return withReportError(sizeError, args.report, 'texture_size_mismatch', args.label, args.meta, args.service);
  }
  args.report.applied.textures.push(args.texture.name ?? args.label);
  return { ok: true, data: args.report };
};

const applyUpdateTexture = async (args: {
  service: ToolService;
  dom: DomPort;
  limits: Limits;
  texture: TextureSpec;
  report: ApplyReport;
  meta: MetaOptions;
  label: string;
  size: { width?: number; height?: number };
  uvPaintConfig: UvPaintRenderConfig | undefined;
  detectNoChange: boolean;
  log?: Logger;
  ifRevision?: string;
}): Promise<ToolResponse<ApplyReport>> => {
  let base: { image: CanvasImageSource; width: number; height: number } | null = null;
  let baseDataUri: string | null = null;
  if (args.texture.useExisting) {
    const baseRes = await readTextureBase({
      service: args.service,
      dom: args.dom,
      texture: args.texture,
      label: args.label,
      detectNoChange: args.detectNoChange,
      log: args.log
    });
    if (!baseRes.ok) {
      return withReportError(baseRes.error, args.report, 'read_texture', args.label, args.meta, args.service);
    }
    base = baseRes.data.base;
    baseDataUri = baseRes.data.dataUri;
  }
  const renderRes = renderTextureSpec(args.dom, args.texture, args.limits, base ?? undefined, args.uvPaintConfig);
  if (!renderRes.ok) {
    return withReportError(renderRes.error, args.report, 'render_texture', args.label, args.meta, args.service);
  }
  recordTextureCoverage(args.report, args.texture, renderRes.data, 'update', args.label);
  if (args.detectNoChange && baseDataUri) {
    const renderedDataUri = renderRes.data.canvas.toDataURL('image/png');
    if (renderedDataUri === baseDataUri) {
      return withReportError(
        {
          code: 'no_change',
          message: TEXTURE_CONTENT_UNCHANGED,
          details: { reason: 'render_no_change', detectNoChange: true }
        },
        args.report,
        'texture_update',
        args.label,
        args.meta,
        args.service
      );
    }
  }
  const res = args.service.updateTexture({
    id: args.texture.targetId,
    name: args.texture.targetName,
    newName: args.texture.name,
    image: renderRes.data.canvas,
    width: args.size.width ?? renderRes.data.width,
    height: args.size.height ?? renderRes.data.height,
    ifRevision: args.ifRevision
  });
  if (!res.ok) return withReportError(res.error, args.report, 'texture_update', args.label, args.meta, args.service);
  const sizeError = checkTextureSize({
    service: args.service,
    texture: args.texture,
    label: args.label,
    expected: args.size
  });
  if (sizeError) {
    return withReportError(sizeError, args.report, 'texture_size_mismatch', args.label, args.meta, args.service);
  }
  args.report.applied.textures.push(
    args.texture.name ?? args.texture.targetName ?? args.texture.targetId ?? args.label
  );
  return { ok: true, data: args.report };
};
const summarizeOps = (ops: TextureSpec['ops'] | undefined) => {
  const list = Array.isArray(ops) ? ops : [];
  const counts = new Map<string, number>();
  list.forEach((op) => {
    counts.set(op.op, (counts.get(op.op) ?? 0) + 1);
  });
  return {
    total: list.length,
    byOp: Object.fromEntries(counts)
  };
};






