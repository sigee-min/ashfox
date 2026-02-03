import type { AutoPlanTextureSpec, TextureGroup } from './types';

export const buildTextureSpecs = (
  groups: TextureGroup[],
  resolution: { width: number; height: number },
  background?: string,
  options?: { existingNames?: Set<string>; reuseExisting?: boolean; allowExistingUpdate?: boolean }
): AutoPlanTextureSpec[] => {
  const reuseExisting = options?.reuseExisting === true;
  const allowExistingUpdate = options?.allowExistingUpdate === true;
  const existingNames = options?.existingNames;
  const specs: AutoPlanTextureSpec[] = [];
  for (const group of groups) {
    const name = group.name;
    const exists = reuseExisting && existingNames ? existingNames.has(name) : false;
    if (exists) {
      if (allowExistingUpdate) {
        specs.push({
          mode: 'update',
          targetName: name,
          width: resolution.width,
          height: resolution.height,
          ...(background ? { background } : {}),
          useExisting: true
        });
      }
      continue;
    }
    specs.push({
      mode: 'create',
      name,
      width: resolution.width,
      height: resolution.height,
      ...(background ? { background } : {})
    });
  }
  return specs;
};
