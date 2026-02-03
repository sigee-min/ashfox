import type { FacePaintSpec, TexturePipelinePlan } from '../../spec';
import type { ToolResponse } from '../../types';
import type { UvRecoveryInfo } from '../uvRecovery';
import { loadProjectState } from '../projectState';
import { ensurePreflightUsage, ensureUvUsageForTargetsInContext, runPresetStep, type TexturePipelineContext } from './steps';
import { buildFacePaintPresets, summarizeFacePaintUsage } from './facePaint';
import { adjustPresetSpecsForRecovery } from './sizeAdjust';

export type FacePaintWorkflowResult = {
  applied: number;
  materials: string[];
  textures: string[];
  textureIds: string[];
  uvUsageId?: string;
  recovery?: UvRecoveryInfo;
};

export const runFacePaintWorkflow = async (args: {
  ctx: TexturePipelineContext;
  entries: FacePaintSpec[];
  plan?: { existingPlan: TexturePipelinePlan | null; ifRevision?: string; reuseExistingTextures?: boolean };
  ifRevision?: string;
  resolutionOverride?: TexturePipelinePlan['resolution'];
  setProjectMeta?: boolean;
}): Promise<ToolResponse<FacePaintWorkflowResult>> => {
  if (args.entries.length === 0) {
    return {
      ok: true,
      data: { applied: 0, materials: [], textures: [], textureIds: [] }
    };
  }

  const usageReady = ensurePreflightUsage(args.ctx, 'before', { requireUsage: true });
  if (!usageReady.ok) return usageReady as ToolResponse<FacePaintWorkflowResult>;

  const summary = summarizeFacePaintUsage(args.entries, args.ctx.preflightUsage!);
  const resolved = await ensureUvUsageForTargetsInContext(args.ctx, {
    targets: summary.targets,
    requireUv: true,
    plan: args.plan ? { context: args.ctx, ...args.plan } : undefined,
    skipPreflight: true
  });
  if (!resolved.ok) return resolved;

  const projectRes = loadProjectState(args.ctx.deps.service, args.ctx.pipeline.meta, 'summary');
  if (!projectRes.ok) return projectRes;
  const caps = args.ctx.deps.service.listCapabilities();
  const formatFlags = caps.formats.find((format) => format.format === projectRes.data.format)?.flags ?? null;

  const facePaintPresets = buildFacePaintPresets({
    entries: args.entries,
    usage: resolved.data.usage,
    project: projectRes.data,
    resolutionOverride: args.resolutionOverride,
    formatFlags
  });
  if (!facePaintPresets.ok) return facePaintPresets;

  const presetCount = facePaintPresets.data.presets.length;
  if (presetCount > 0) {
    const adjustedPresets = adjustPresetSpecsForRecovery(
      facePaintPresets.data.presets,
      resolved.data.usage,
      resolved.data.recovery
    );
    const presetRes = runPresetStep(args.ctx, adjustedPresets, resolved.data.recovery, args.ifRevision);
    if (!presetRes.ok) return presetRes as ToolResponse<FacePaintWorkflowResult>;
    if (args.setProjectMeta !== false) {
      const metaRes = args.ctx.pipeline.wrap(
        args.ctx.deps.service.setProjectMeta({ meta: { facePaint: args.entries }, ifRevision: args.ifRevision })
      );
      if (!metaRes.ok) return metaRes;
    }
  }

  return {
    ok: true,
    data: {
      applied: presetCount,
      materials: facePaintPresets.data.materials,
      textures: facePaintPresets.data.textures,
      textureIds: facePaintPresets.data.textureIds,
      uvUsageId: resolved.data.uvUsageId,
      ...(resolved.data.recovery ? { recovery: resolved.data.recovery } : {})
    }
  };
};
