import type { TextureUsage } from '../../../domain/model';
import type { TexturePipelinePlan } from '../../../spec';
import { AUTO_PLAN_MAX_TEXTURES } from './constants';

export const buildAutoRecoverPlan = (args: {
  existingPlan?: TexturePipelinePlan | null;
  name?: string;
  usage?: TextureUsage;
  maxTextures?: number;
}): TexturePipelinePlan | null => {
  const name = args.name ?? args.usage?.textures[0]?.name;
  const hasExplicitPlan = Boolean(args.existingPlan);
  const base = hasExplicitPlan ? { ...args.existingPlan } : { name };
  if (!base.name && name) base.name = name;
  if (base.allowSplit === undefined) base.allowSplit = true;
  const desiredMax = args.maxTextures ?? AUTO_PLAN_MAX_TEXTURES;
  const maxTextures = base.maxTextures;
  if (!isFiniteNumber(maxTextures)) {
    base.maxTextures = desiredMax;
  } else {
    const currentMax = Math.max(1, Math.trunc(maxTextures));
    base.maxTextures = hasExplicitPlan ? currentMax : Math.max(currentMax, desiredMax);
  }
  return base;
};

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);
