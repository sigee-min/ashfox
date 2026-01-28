import { CUBE_FACE_DIRECTIONS, type Cube, type TextureUsage } from '../../domain/model';
import type { UvAssignmentSpec, UvFaceMap } from '../../domain/uvApply';
import { buildUvApplyPlan } from '../../domain/uvApply';
import type { AtlasPlan } from '../../domain/uvAtlas';
import { buildUvAtlasPlan } from '../../domain/uvAtlas';
import { computeTextureUsageId } from '../../domain/textureUsage';
import { expandTextureTargets, type TextureTargetSet } from '../../domain/uvTargets';
import type { UvPolicyConfig } from '../../domain/uvPolicy';
import { getFaceDimensions } from '../../domain/uvPolicy';
import type { TexturePipelinePlan, TexturePlanDetail } from '../../spec';
import type { ToolResponse } from '../../types';
import { toDomainCube } from '../../usecases/domainMappers';
import { isUsecaseError, usecaseError } from '../guardHelpers';
import { loadProjectState } from '../projectState';
import { guardUvForUsage } from '../uvGuard';
import { cacheUvUsage, loadUvContext } from '../uvContext';
import type { TexturePipelineContext } from './steps';
import { applyTextureSpecs } from './textureFlow';
import { TEXTURE_AUTO_UV_NO_TEXTURES, TEXTURE_PLAN_NO_CUBES } from '../../shared/messages';

type CubeStat = { cube: Cube; area: number };

type PlanLayout = {
  resolution: { width: number; height: number };
  textureCount: number;
  ppuTarget: number;
  ppuUsed: number;
};

type TextureGroup = {
  name: string;
  cubes: Cube[];
  area: number;
};

const DETAIL_PIXELS_PER_BLOCK: Record<TexturePlanDetail, number> = {
  low: 16,
  medium: 32,
  high: 64
};

const MIN_RESOLUTION = 16;
const PACK_EFFICIENCY = 0.75;
const ATLAS_RETRY_LIMIT = 3;

export const runAutoPlanStep = async (
  ctx: TexturePipelineContext,
  plan: TexturePipelinePlan,
  options: { planOnly: boolean; ifRevision?: string }
): Promise<ToolResponse<void>> => {
  const projectRes = loadProjectState(ctx.deps.service, ctx.pipeline.meta, 'full', { includeUsage: false });
  if (!projectRes.ok) return projectRes;
  const project = projectRes.data;
  const cubes = (project.cubes ?? []).map((cube) => toDomainCube(cube));
  if (cubes.length === 0) {
    return ctx.pipeline.error({ code: 'invalid_state', message: TEXTURE_PLAN_NO_CUBES });
  }

  const notes: string[] = [];
  const detail = resolveDetail(plan.detail);
  const padding = resolvePadding(plan.padding);
  const caps = ctx.deps.service.listCapabilities();
  const formatFlags = resolveFormatFlags(caps.formats, project.format ?? undefined);
  const allowSplit = resolveAllowSplit(plan.allowSplit, formatFlags, notes);
  const maxTextures = resolveMaxTextures(plan.maxTextures, allowSplit, notes);
  const policy = ctx.deps.service.getUvPolicy();
  const stats = collectCubeStats(cubes);

  const basePixelsPerBlock = DETAIL_PIXELS_PER_BLOCK[detail];
  const ppuTarget = basePixelsPerBlock / Math.max(1, policy.modelUnitsPerBlock);
  const resolutionOverride = resolveResolutionOverride(plan.resolution, caps.limits.maxTextureSize, notes);
  const layout = resolveLayout({
    ppuTarget,
    stats,
    maxTextures,
    allowSplit,
    maxSize: caps.limits.maxTextureSize,
    override: resolutionOverride,
    notes,
    cubeCount: stats.cubes.length
  });

  const existingNames = new Set((project.textures ?? []).map((tex) => tex.name));
  const textureNames = resolveTextureNames(plan.name ?? 'texture', layout.textureCount, existingNames, notes);
  const groups = splitTextureGroups(stats.cubes, textureNames);

  const usage = buildUsage(groups);
  const atlasRes = buildAtlasWithRetries({
    usage,
    cubes,
    resolution: layout.resolution,
    padding,
    policy,
    ppuTarget: layout.ppuUsed,
    notes
  });
  if (!atlasRes.ok) {
    return ctx.pipeline.error(atlasRes.error);
  }
  const atlas = atlasRes.data;

  const assignments = buildUvAssignments(atlas.assignments);
  const uvPlanRes = buildUvApplyPlan(usage, cubes, assignments, layout.resolution);
  if (!uvPlanRes.ok) {
    return ctx.pipeline.error(uvPlanRes.error);
  }

  const uvUsageId = computeTextureUsageId(uvPlanRes.data.usage);
  const planNotes = notes.length > 0 ? notes : undefined;

  ctx.steps.plan = {
    applied: !options.planOnly,
    detail,
    resolution: layout.resolution,
    textures: groups.map((group) => ({ name: group.name, cubeCount: group.cubes.length })),
    padding,
    ...(plan.paint ? { paint: plan.paint } : {}),
    ...(planNotes ? { notes: planNotes } : {}),
    autoUvAtlas: {
      applied: !options.planOnly,
      steps: atlas.steps,
      resolution: atlas.resolution,
      textures: atlas.textures
    }
  };

  if (options.planOnly) {
    return { ok: true, data: undefined };
  }

  const currentResolution = ctx.deps.service.getProjectTextureResolution();
  if (
    !currentResolution ||
    currentResolution.width !== layout.resolution.width ||
    currentResolution.height !== layout.resolution.height
  ) {
    const res = ctx.deps.service.setProjectTextureResolution({
      width: layout.resolution.width,
      height: layout.resolution.height,
      modifyUv: false,
      ifRevision: options.ifRevision
    });
    if (isUsecaseError(res)) return usecaseError(res, ctx.pipeline.meta, ctx.deps.service);
  }

  const textureSpecs = buildTextureSpecs(groups, layout.resolution, plan.paint?.background);
  if (textureSpecs.length > 0) {
    ctx.pipeline.require(
      await applyTextureSpecs({
        deps: ctx.deps,
        meta: ctx.pipeline.meta,
        textures: textureSpecs
      })
    );
  }

  for (const group of groups) {
    const cubeIds = group.cubes.map((cube) => cube.id).filter(Boolean) as string[];
    const cubeNames = group.cubes.map((cube) => cube.name);
    const res = ctx.deps.service.assignTexture({
      textureName: group.name,
      cubeIds: cubeIds.length > 0 ? cubeIds : undefined,
      cubeNames: cubeNames.length > 0 ? cubeNames : undefined,
      ifRevision: options.ifRevision
    });
    if (isUsecaseError(res)) return usecaseError(res, ctx.pipeline.meta, ctx.deps.service);
  }

  for (const update of uvPlanRes.data.updates) {
    const res = ctx.deps.service.setFaceUv({
      cubeId: update.cubeId,
      cubeName: update.cubeName,
      faces: update.faces,
      ifRevision: options.ifRevision
    });
    if (isUsecaseError(res)) return usecaseError(res, ctx.pipeline.meta, ctx.deps.service);
  }

  ctx.currentUvUsageId = uvUsageId;
  ctx.preflightUsage = uvPlanRes.data.usage;

  if (plan.paint?.preset) {
    const results = [];
    for (const group of groups) {
      const presetRes = ctx.deps.service.generateTexturePreset({
        preset: plan.paint.preset,
        width: layout.resolution.width,
        height: layout.resolution.height,
        uvUsageId,
        mode: 'update',
        targetName: group.name,
        seed: plan.paint.seed,
        palette: plan.paint.palette,
        ifRevision: options.ifRevision
      });
      if (isUsecaseError(presetRes)) return usecaseError(presetRes, ctx.pipeline.meta, ctx.deps.service);
      results.push(presetRes.value);
    }
    if (results.length > 0) {
      ctx.steps.presets = {
        applied: results.length,
        results,
        uvUsageId
      };
    }
  }

  return { ok: true, data: undefined };
};

export const recoverTextureUsageWithPlan = async (
  ctx: TexturePipelineContext,
  args: {
    targets: TextureTargetSet;
    ifRevision?: string;
    detail?: TexturePlanDetail;
  }
): Promise<ToolResponse<{ usage: TextureUsage; uvUsageId: string; recovery: Record<string, unknown> }>> => {
  const contextRes = loadUvContext(ctx.deps.service, ctx.pipeline.meta, undefined, { cache: ctx.deps.cache?.uv });
  if (!contextRes.ok) return contextRes;
  const usage = contextRes.data.usage;
  const cubes = contextRes.data.cubes;
  const policy = contextRes.data.policy;
  const expandedTargets = expandTextureTargets(usage, args.targets);
  const targetUsage = buildTargetUsage(usage, expandedTargets);
  if (targetUsage.textures.length === 0) {
    return ctx.pipeline.error({ code: 'invalid_state', message: TEXTURE_AUTO_UV_NO_TEXTURES });
  }

  const stats = collectUsageStats(targetUsage, cubes);
  const notes: string[] = [];
  const caps = ctx.deps.service.listCapabilities();
  const textureCount = targetUsage.textures.length;
  const detail = resolveDetail(args.detail);
  const layout = resolveRecoveryLayout({
    stats,
    textureCount,
    policy,
    maxSize: caps.limits.maxTextureSize,
    currentResolution: contextRes.data.resolution,
    detail,
    notes
  });

  const atlasRes = buildAtlasWithRetries({
    usage: targetUsage,
    cubes,
    resolution: layout.resolution,
    padding: 0,
    policy,
    ppuTarget: layout.ppuUsed,
    notes
  });
  if (!atlasRes.ok) {
    return ctx.pipeline.error(atlasRes.error);
  }
  const atlas = atlasRes.data;

  const assignments = buildUvAssignments(atlas.assignments);
  const uvPlanRes = buildUvApplyPlan(usage, cubes, assignments, layout.resolution);
  if (!uvPlanRes.ok) {
    return ctx.pipeline.error(uvPlanRes.error);
  }

  const guardRes = guardUvForUsage(ctx.deps.service, ctx.pipeline.meta, {
    usage: uvPlanRes.data.usage,
    targets: expandedTargets,
    cubes,
    resolution: layout.resolution,
    policy
  });
  if (!guardRes.ok) return guardRes;

  const currentResolution = ctx.deps.service.getProjectTextureResolution();
  if (
    !currentResolution ||
    currentResolution.width !== layout.resolution.width ||
    currentResolution.height !== layout.resolution.height
  ) {
    const res = ctx.deps.service.setProjectTextureResolution({
      width: layout.resolution.width,
      height: layout.resolution.height,
      modifyUv: false,
      ifRevision: args.ifRevision
    });
    if (isUsecaseError(res)) return usecaseError(res, ctx.pipeline.meta, ctx.deps.service);
  }

  for (const update of uvPlanRes.data.updates) {
    const res = ctx.deps.service.setFaceUv({
      cubeId: update.cubeId,
      cubeName: update.cubeName,
      faces: update.faces,
      ifRevision: args.ifRevision
    });
    if (isUsecaseError(res)) return usecaseError(res, ctx.pipeline.meta, ctx.deps.service);
  }

  const uvUsageId = computeTextureUsageId(uvPlanRes.data.usage);
  cacheUvUsage(ctx.deps.cache?.uv, uvPlanRes.data.usage, uvUsageId);

  return {
    ok: true,
    data: {
      usage: uvPlanRes.data.usage,
      uvUsageId,
      recovery: {
        reason: 'plan',
        detail,
        textureCount,
        resolution: layout.resolution,
        ppuTarget: layout.ppuTarget,
        ppuUsed: layout.ppuUsed,
        ...(notes.length > 0 ? { notes } : {})
      }
    }
  };
};

const resolveDetail = (detail?: TexturePlanDetail): TexturePlanDetail => detail ?? 'medium';

const resolvePadding = (padding?: number): number => {
  if (!Number.isFinite(padding)) return 0;
  return Math.max(0, Math.trunc(padding as number));
};

const resolveAllowSplit = (
  allowSplit: boolean | undefined,
  flags: { singleTexture?: boolean; perTextureUvSize?: boolean },
  notes: string[]
): boolean => {
  if (flags.singleTexture) {
    notes.push('Active format requires a single texture; split disabled.');
    return false;
  }
  if (flags.perTextureUvSize) {
    notes.push('Active format uses per-texture UV sizes; split disabled.');
    return false;
  }
  return allowSplit !== false;
};

const resolveMaxTextures = (maxTextures: number | undefined, allowSplit: boolean, notes: string[]): number => {
  const requested = Number.isFinite(maxTextures) ? Math.max(1, Math.trunc(maxTextures as number)) : allowSplit ? 2 : 1;
  if (!allowSplit) {
    if (requested > 1) {
      notes.push('maxTextures ignored because split is disabled.');
    }
    return 1;
  }
  return requested;
};

const resolveFormatFlags = (
  formats: Array<{ format: string; flags?: { singleTexture?: boolean; perTextureUvSize?: boolean } }>,
  activeFormat?: string
): { singleTexture?: boolean; perTextureUvSize?: boolean } => {
  if (!activeFormat) return {};
  const entry = formats.find((format) => format.format === activeFormat);
  return entry?.flags ?? {};
};

const resolveResolutionOverride = (
  resolution: TexturePipelinePlan['resolution'] | undefined,
  maxSize: number,
  notes: string[]
): { width: number; height: number } | null => {
  if (!resolution) return null;
  const width = Number(resolution.width ?? resolution.height);
  const height = Number(resolution.height ?? resolution.width);
  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) return null;
  const size = Math.max(Math.trunc(width), Math.trunc(height));
  if (width !== height) {
    notes.push(`Non-square resolution requested; using ${size}x${size}.`);
  }
  let clamped = Math.min(size, maxSize);
  if (clamped !== size) {
    notes.push(`Resolution clamped to max ${maxSize}.`);
  }
  if (clamped < MIN_RESOLUTION) {
    clamped = MIN_RESOLUTION;
    notes.push(`Resolution raised to minimum ${MIN_RESOLUTION}.`);
  }
  return { width: clamped, height: clamped };
};

const resolveRecoveryLayout = (args: {
  stats: { totalArea: number; maxFaceWidth: number; maxFaceHeight: number };
  textureCount: number;
  policy: UvPolicyConfig;
  maxSize: number;
  currentResolution?: { width: number; height: number };
  detail: TexturePlanDetail;
  notes: string[];
}): PlanLayout => {
  const { stats, textureCount, policy, maxSize, currentResolution, detail, notes } = args;
  const resolution = currentResolution
    ? normalizeRecoveryResolution(currentResolution, maxSize, notes)
    : deriveRecoveryResolution(stats, textureCount, policy, detail, maxSize, notes);
  const defaultPpu =
    policy.modelUnitsPerBlock > 0 ? resolution.width / policy.modelUnitsPerBlock : 0;
  const ppuTarget = Number.isFinite(defaultPpu) && defaultPpu > 0
    ? defaultPpu
    : DETAIL_PIXELS_PER_BLOCK[detail] / Math.max(1, policy.modelUnitsPerBlock);
  const ppuMax = computePpuMax(resolution, stats, textureCount);
  const ppuUsed = Math.min(ppuTarget, ppuMax);
  if (ppuUsed + 1e-6 < ppuTarget) {
    notes.push(
      `Texel density reduced (target ${formatPpu(ppuTarget)}px/unit, used ${formatPpu(ppuUsed)}px/unit).`
    );
  }
  return {
    resolution,
    textureCount,
    ppuTarget,
    ppuUsed
  };
};

const normalizeRecoveryResolution = (
  resolution: { width: number; height: number },
  maxSize: number,
  notes: string[]
): { width: number; height: number } => {
  const width = Math.trunc(resolution.width);
  const height = Math.trunc(resolution.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    notes.push(`Resolution missing; using ${MIN_RESOLUTION}x${MIN_RESOLUTION}.`);
    return { width: MIN_RESOLUTION, height: MIN_RESOLUTION };
  }
  let size = Math.max(width, height);
  if (width !== height) {
    notes.push(`Non-square resolution detected; using ${size}x${size}.`);
  }
  if (size > maxSize) {
    notes.push(`Resolution clamped to max ${maxSize}.`);
    size = maxSize;
  }
  if (size < MIN_RESOLUTION) {
    notes.push(`Resolution raised to minimum ${MIN_RESOLUTION}.`);
    size = MIN_RESOLUTION;
  }
  return { width: size, height: size };
};

const deriveRecoveryResolution = (
  stats: { totalArea: number; maxFaceWidth: number; maxFaceHeight: number },
  textureCount: number,
  policy: UvPolicyConfig,
  detail: TexturePlanDetail,
  maxSize: number,
  notes: string[]
): { width: number; height: number } => {
  const basePixelsPerBlock = DETAIL_PIXELS_PER_BLOCK[detail];
  const ppuTarget = basePixelsPerBlock / Math.max(1, policy.modelUnitsPerBlock);
  const required = computeRequiredResolution(ppuTarget, stats, textureCount);
  const rounded = roundUpResolution(required);
  let size = Math.min(Math.max(rounded, MIN_RESOLUTION), maxSize);
  if (size !== rounded) {
    notes.push(`Resolution clamped to ${size}x${size}.`);
  }
  return { width: size, height: size };
};

const resolveLayout = (args: {
  ppuTarget: number;
  stats: { totalArea: number; maxFaceWidth: number; maxFaceHeight: number; cubes: CubeStat[] };
  maxTextures: number;
  allowSplit: boolean;
  maxSize: number;
  override: { width: number; height: number } | null;
  notes: string[];
  cubeCount: number;
}): PlanLayout => {
  const { ppuTarget, stats, maxTextures, allowSplit, maxSize, override, notes, cubeCount } = args;
  let textureCount = 1;
  let resolution = override ? { ...override } : { width: MIN_RESOLUTION, height: MIN_RESOLUTION };

  if (override) {
    textureCount = allowSplit ? pickTextureCount(override, ppuTarget, stats, maxTextures) : 1;
  } else {
    textureCount = 1;
    for (let count = 1; count <= maxTextures; count += 1) {
      const required = computeRequiredResolution(ppuTarget, stats, count);
      const rounded = roundUpResolution(required);
      if (rounded <= maxSize) {
        textureCount = count;
        resolution = { width: rounded, height: rounded };
        break;
      }
    }
    if (resolution.width < MIN_RESOLUTION || resolution.height < MIN_RESOLUTION) {
      resolution = { width: MIN_RESOLUTION, height: MIN_RESOLUTION };
    }
    if (resolution.width > maxSize || resolution.height > maxSize) {
      resolution = { width: maxSize, height: maxSize };
      notes.push(`Resolution limited to max ${maxSize}.`);
      textureCount = maxTextures;
    }
  }

  if (textureCount > cubeCount) {
    const reduced = Math.max(1, cubeCount);
    if (reduced !== textureCount) {
      notes.push(`Texture count reduced to ${reduced} (not enough cubes to split).`);
      textureCount = reduced;
    }
  }

  if (textureCount > 1) {
    notes.push(`Split across ${textureCount} textures to preserve texel density.`);
  }

  const ppuMax = computePpuMax(resolution, stats, textureCount);
  const ppuUsed = Math.min(ppuTarget, ppuMax);
  if (ppuUsed + 1e-6 < ppuTarget) {
    notes.push(
      `Texel density reduced (target ${formatPpu(ppuTarget)}px/unit, used ${formatPpu(ppuUsed)}px/unit).`
    );
  }

  return { resolution, textureCount, ppuTarget, ppuUsed };
};

const pickTextureCount = (
  resolution: { width: number; height: number },
  ppuTarget: number,
  stats: { totalArea: number; maxFaceWidth: number; maxFaceHeight: number },
  maxTextures: number
): number => {
  for (let count = 1; count <= maxTextures; count += 1) {
    const ppuMax = computePpuMax(resolution, stats, count);
    if (ppuTarget <= ppuMax + 1e-6) {
      return count;
    }
  }
  return maxTextures;
};

const computeRequiredResolution = (
  ppuTarget: number,
  stats: { totalArea: number; maxFaceWidth: number; maxFaceHeight: number },
  textureCount: number
): number => {
  const area = stats.totalArea > 0 ? stats.totalArea * ppuTarget * ppuTarget : 0;
  const perTexture = textureCount > 0 ? area / textureCount : area;
  const areaSize = perTexture > 0 ? Math.sqrt(perTexture / PACK_EFFICIENCY) : MIN_RESOLUTION;
  const faceSize = Math.max(stats.maxFaceWidth * ppuTarget, stats.maxFaceHeight * ppuTarget, MIN_RESOLUTION);
  return Math.max(areaSize, faceSize);
};

const computePpuMax = (
  resolution: { width: number; height: number },
  stats: { totalArea: number; maxFaceWidth: number; maxFaceHeight: number },
  textureCount: number
): number => {
  const areaBound =
    stats.totalArea > 0
      ? Math.sqrt((resolution.width * resolution.height * textureCount * PACK_EFFICIENCY) / stats.totalArea)
      : Infinity;
  const widthBound = stats.maxFaceWidth > 0 ? resolution.width / stats.maxFaceWidth : Infinity;
  const heightBound = stats.maxFaceHeight > 0 ? resolution.height / stats.maxFaceHeight : Infinity;
  return Math.min(areaBound, widthBound, heightBound);
};

const roundUpResolution = (value: number): number => {
  if (!Number.isFinite(value) || value <= 0) return MIN_RESOLUTION;
  if (value <= MIN_RESOLUTION) return MIN_RESOLUTION;
  return Math.ceil(value / 32) * 32;
};

const collectCubeStats = (cubes: Cube[]): { totalArea: number; maxFaceWidth: number; maxFaceHeight: number; cubes: CubeStat[] } => {
  let totalArea = 0;
  let maxFaceWidth = 0;
  let maxFaceHeight = 0;
  const cubeStats: CubeStat[] = [];
  for (const cube of cubes) {
    let area = 0;
    for (const face of CUBE_FACE_DIRECTIONS) {
      const dims = getFaceDimensions(cube, face);
      const faceArea = Math.max(0, dims.width) * Math.max(0, dims.height);
      area += faceArea;
      totalArea += faceArea;
      if (dims.width > maxFaceWidth) maxFaceWidth = dims.width;
      if (dims.height > maxFaceHeight) maxFaceHeight = dims.height;
    }
    cubeStats.push({ cube, area });
  }
  return { totalArea, maxFaceWidth, maxFaceHeight, cubes: cubeStats };
};

const collectUsageStats = (
  usage: TextureUsage,
  cubes: Cube[]
): { totalArea: number; maxFaceWidth: number; maxFaceHeight: number } => {
  const cubeById = new Map<string, Cube>();
  const cubeByName = new Map<string, Cube>();
  cubes.forEach((cube) => {
    if (cube.id) cubeById.set(cube.id, cube);
    cubeByName.set(cube.name, cube);
  });
  let totalArea = 0;
  let maxFaceWidth = 0;
  let maxFaceHeight = 0;
  usage.textures.forEach((texture) => {
    texture.cubes.forEach((cubeRef) => {
      const resolved = cubeRef.id ? cubeById.get(cubeRef.id) : undefined;
      const cube = resolved ?? cubeByName.get(cubeRef.name);
      if (!cube) return;
      cubeRef.faces.forEach((face) => {
        const dims = getFaceDimensions(cube, face.face);
        const area = Math.max(0, dims.width) * Math.max(0, dims.height);
        totalArea += area;
        if (dims.width > maxFaceWidth) maxFaceWidth = dims.width;
        if (dims.height > maxFaceHeight) maxFaceHeight = dims.height;
      });
    });
  });
  return { totalArea, maxFaceWidth, maxFaceHeight };
};

const buildTargetUsage = (usage: TextureUsage, targets: TextureTargetSet): TextureUsage => {
  if (targets.ids.size === 0 && targets.names.size === 0) return usage;
  return {
    textures: usage.textures.filter(
      (entry) => (entry.id && targets.ids.has(entry.id)) || targets.names.has(entry.name)
    ),
    unresolved: usage.unresolved
  };
};

const resolveTextureNames = (
  baseName: string,
  textureCount: number,
  existingNames: Set<string>,
  notes: string[]
): string[] => {
  const names: string[] = [];
  const suffixBase = textureCount > 1 ? '_part' : '';
  for (let i = 0; i < textureCount; i += 1) {
    const base = textureCount > 1 ? `${baseName}${suffixBase}${i + 1}` : baseName;
    const name = ensureUniqueName(base, existingNames);
    if (name !== base) {
      notes.push(`Texture name "${base}" already exists; using "${name}".`);
    }
    names.push(name);
    existingNames.add(name);
  }
  return names;
};

const ensureUniqueName = (base: string, existingNames: Set<string>): string => {
  if (!existingNames.has(base)) return base;
  let suffix = 2;
  let candidate = `${base}_${suffix}`;
  while (existingNames.has(candidate)) {
    suffix += 1;
    candidate = `${base}_${suffix}`;
  }
  return candidate;
};

const splitTextureGroups = (cubes: CubeStat[], names: string[]): TextureGroup[] => {
  const groups: TextureGroup[] = names.map((name) => ({ name, cubes: [], area: 0 }));
  const sorted = [...cubes].sort((a, b) => {
    if (b.area !== a.area) return b.area - a.area;
    return a.cube.name.localeCompare(b.cube.name);
  });
  sorted.forEach((entry) => {
    const target = groups.reduce((min, group) => (group.area < min.area ? group : min), groups[0]);
    target.cubes.push(entry.cube);
    target.area += entry.area;
  });
  return groups;
};

const buildUsage = (groups: TextureGroup[]): TextureUsage => ({
  textures: groups.map((group) => ({
    name: group.name,
    cubeCount: group.cubes.length,
    faceCount: group.cubes.length * CUBE_FACE_DIRECTIONS.length,
    cubes: group.cubes.map((cube) => ({
      id: cube.id,
      name: cube.name,
      faces: CUBE_FACE_DIRECTIONS.map((face) => ({ face }))
    }))
  }))
});

const buildUvAssignments = (assignments: AtlasPlan['assignments']): UvAssignmentSpec[] => {
  const grouped = new Map<string, UvAssignmentSpec>();
  for (const assignment of assignments) {
    const key = assignment.cubeId ? `id:${assignment.cubeId}` : `name:${assignment.cubeName}`;
    const entry = grouped.get(key) ?? {
      cubeId: assignment.cubeId,
      cubeName: assignment.cubeName,
      faces: {}
    };
    (entry.faces as UvFaceMap)[assignment.face] = assignment.uv;
    grouped.set(key, entry);
  }
  return Array.from(grouped.values());
};

const buildAtlasWithRetries = (args: {
  usage: TextureUsage;
  cubes: Cube[];
  resolution: { width: number; height: number };
  padding: number;
  policy: UvPolicyConfig;
  ppuTarget: number;
  notes: string[];
}): { ok: true; data: AtlasPlan } | { ok: false; error: { code: 'invalid_payload' | 'invalid_state'; message: string; details?: Record<string, unknown> } } => {
  let ppu = Math.max(0.001, args.ppuTarget);
  for (let attempt = 0; attempt < ATLAS_RETRY_LIMIT; attempt += 1) {
    const unitsPerBlock = Math.max(1, args.resolution.width / ppu);
    const policy: UvPolicyConfig = {
      ...args.policy,
      modelUnitsPerBlock: unitsPerBlock
    };
    const planRes = buildUvAtlasPlan({
      usage: args.usage,
      cubes: args.cubes,
      resolution: args.resolution,
      baseResolution: args.resolution,
      maxResolution: args.resolution,
      padding: args.padding,
      policy
    });
    if (planRes.ok) {
      if (attempt > 0) {
        args.notes.push(
          `Texel density adjusted after packing retries (final ${formatPpu(ppu)}px/unit).`
        );
      }
      return planRes;
    }
    const reason = typeof planRes.error.details?.reason === 'string' ? planRes.error.details?.reason : null;
    if (reason !== 'atlas_overflow' && reason !== 'uv_size_exceeds') {
      return planRes;
    }
    ppu *= 0.9;
  }
  const fallback = buildUvAtlasPlan({
    usage: args.usage,
    cubes: args.cubes,
    resolution: args.resolution,
    baseResolution: args.resolution,
    maxResolution: args.resolution,
    padding: args.padding,
    policy: args.policy
  });
  return fallback.ok ? fallback : fallback;
};

const buildTextureSpecs = (
  groups: TextureGroup[],
  resolution: { width: number; height: number },
  background?: string
): Array<{ mode: 'create'; name: string; width: number; height: number; background?: string }> =>
  groups.map((group) => ({
    mode: 'create',
    name: group.name,
    width: resolution.width,
    height: resolution.height,
    ...(background ? { background } : {})
  }));

const formatPpu = (value: number): string => {
  if (!Number.isFinite(value)) return '?';
  return Math.round(value * 100) / 100 + '';
};
