import type { Cube, TextureUsage } from '../../../domain/model';
import type { AtlasPlan } from '../../../domain/uv/atlas';
import { buildUvAtlasPlan } from '../../../domain/uv/atlas';
import type { UvPolicyConfig } from '../../../domain/uv/policy';
import { buildUvAtlasMessages } from '../../../shared/messages';
import type { DomainResult } from '../../../domain/result';
import { ATLAS_RETRY_LIMIT, formatPpu } from './constants';

const uvAtlasMessages = buildUvAtlasMessages();

export const buildAtlasWithRetries = (args: {
  usage: TextureUsage;
  cubes: Cube[];
  resolution: { width: number; height: number };
  padding: number;
  policy: UvPolicyConfig;
  ppuTarget: number;
  notes: string[];
}): DomainResult<AtlasPlan> => {
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
      policy,
      messages: uvAtlasMessages
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
    policy: args.policy,
    messages: uvAtlasMessages
  });
  return fallback.ok ? fallback : fallback;
};

