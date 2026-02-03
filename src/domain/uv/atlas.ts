import type { DomainError, DomainResult } from '../result';
import type { Cube, CubeFaceDirection, TextureUsage } from '../model';
import { UvPolicyConfig } from './policy';
import { buildGroups } from './atlasGroups';
import { packGroups } from './atlasPacking';

export type UvAtlasMessages = {
  resolutionPositive: string;
  maxResolutionPositive: string;
  exceedsMax: string;
  cubeMissing: (name: string) => string;
  deriveSizeFailed: (cube: string, face: string) => string;
  uvSizeExceeds: (cube: string, face: string) => string;
  overflow: string;
};

export type AtlasRect = { x1: number; y1: number; x2: number; y2: number };

export type AtlasAssignment = {
  cubeId?: string;
  cubeName: string;
  face: CubeFaceDirection;
  uv: [number, number, number, number];
};

export type AtlasGroupPlan = {
  width: number;
  height: number;
  rect: [number, number, number, number];
  faceCount: number;
};

export type AtlasTexturePlan = {
  textureId?: string;
  textureName: string;
  groups: AtlasGroupPlan[];
};

export type AtlasPlan = {
  resolution: { width: number; height: number };
  steps: number;
  textures: AtlasTexturePlan[];
  assignments: AtlasAssignment[];
};

type BuildContext = {
  usage: TextureUsage;
  cubes: Cube[];
  resolution: { width: number; height: number };
  baseResolution?: { width: number; height: number };
  maxResolution: { width: number; height: number };
  padding: number;
  policy: UvPolicyConfig;
  messages: UvAtlasMessages;
};

export const buildUvAtlasPlan = (context: BuildContext): DomainResult<AtlasPlan> => {
  const messages = context.messages;
  const startWidth = Math.trunc(context.resolution.width);
  const startHeight = Math.trunc(context.resolution.height);
  if (!Number.isFinite(startWidth) || !Number.isFinite(startHeight) || startWidth <= 0 || startHeight <= 0) {
    return fail('invalid_payload', messages.resolutionPositive);
  }
  const baseWidth =
    typeof context.baseResolution?.width === 'number' && Number.isFinite(context.baseResolution.width)
      ? Math.trunc(context.baseResolution.width)
      : startWidth;
  const baseHeight =
    typeof context.baseResolution?.height === 'number' && Number.isFinite(context.baseResolution.height)
      ? Math.trunc(context.baseResolution.height)
      : startHeight;
  if (!Number.isFinite(baseWidth) || !Number.isFinite(baseHeight) || baseWidth <= 0 || baseHeight <= 0) {
    return fail('invalid_payload', messages.resolutionPositive);
  }
  const maxWidth = Math.trunc(context.maxResolution.width);
  const maxHeight = Math.trunc(context.maxResolution.height);
  if (!Number.isFinite(maxWidth) || !Number.isFinite(maxHeight) || maxWidth <= 0 || maxHeight <= 0) {
    return fail('invalid_payload', messages.maxResolutionPositive);
  }
  const padding = Math.max(0, Math.trunc(context.padding));
  const cubeById = new Map<string, Cube>();
  const cubeByName = new Map<string, Cube>();
  context.cubes.forEach((cube) => {
    if (cube.id) cubeById.set(cube.id, cube);
    cubeByName.set(cube.name, cube);
  });
  const baseResolution = { width: baseWidth, height: baseHeight };
  let width = startWidth;
  let height = startHeight;
  let steps = 0;
  while (true) {
    const planRes = buildPlanForResolution(context.usage, cubeById, cubeByName, {
      width,
      height,
      padding,
      policy: context.policy,
      baseResolution,
      messages
    });
    if (planRes.ok) {
      return {
        ok: true,
        data: {
          resolution: { width, height },
          steps,
          textures: planRes.data.textures,
          assignments: planRes.data.assignments
        }
      };
    }
    const reason = planRes.error.details?.reason;
    if (reason !== 'atlas_overflow') {
      return planRes;
    }
    const nextWidth = width * 2;
    const nextHeight = height * 2;
    if (nextWidth > maxWidth || nextHeight > maxHeight) {
      return fail('invalid_state', messages.exceedsMax, {
        width,
        height,
        nextWidth,
        nextHeight,
        maxWidth,
        maxHeight
      });
    }
    width = nextWidth;
    height = nextHeight;
    steps += 1;
  }
};

const buildPlanForResolution = (
  usage: TextureUsage,
  cubeById: Map<string, Cube>,
  cubeByName: Map<string, Cube>,
  config: {
    width: number;
    height: number;
    padding: number;
    policy: UvPolicyConfig;
    baseResolution: { width: number; height: number };
    messages: UvAtlasMessages;
  }
): DomainResult<{ textures: AtlasTexturePlan[]; assignments: AtlasAssignment[] }> => {
  const textures: AtlasTexturePlan[] = [];
  const assignments: AtlasAssignment[] = [];
  for (const entry of usage.textures) {
    if (entry.faceCount === 0) continue;
    const groupsRes = buildGroups(entry, cubeById, cubeByName, config);
    if (!groupsRes.ok) return groupsRes;
    const groups = groupsRes.data;
    const placementsRes = packGroups(groups, config.width, config.height, config.padding, config.messages);
    if (!placementsRes.ok) return placementsRes;
    const placements = placementsRes.data;
    const plans: AtlasGroupPlan[] = [];
    placements.forEach((placement) => {
      const rect: [number, number, number, number] = [
        placement.x,
        placement.y,
        placement.x + placement.group.width,
        placement.y + placement.group.height
      ];
      plans.push({
        width: placement.group.width,
        height: placement.group.height,
        rect,
        faceCount: placement.group.faces.length
      });
      placement.group.faces.forEach((face) => {
        assignments.push({
          cubeId: face.cubeId,
          cubeName: face.cubeName,
          face: face.face,
          uv: rect
        });
      });
    });
    textures.push({
      textureId: entry.id ?? undefined,
      textureName: entry.name,
      groups: plans
    });
  }
  return { ok: true, data: { textures, assignments } };
};

const fail = (code: DomainError['code'], message: string, details?: Record<string, unknown>): DomainResult<never> => ({
  ok: false,
  error: { code, message, details }
});




