import type { TexturePipelinePreset, TextureSpec } from '../../spec';

const normalizeName = (value: unknown): string | null =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;

const resolveTextureCreateName = (spec: TextureSpec): string | null => {
  const mode = spec.mode ?? 'create';
  if (mode !== 'create') return null;
  if (spec.targetId || spec.targetName) return null;
  return normalizeName(spec.name);
};

const resolveTextureUpdateTargetName = (spec: TextureSpec): string | null => {
  const mode = spec.mode ?? 'create';
  if (mode !== 'update') return null;
  if (!spec.targetName) return null;
  return normalizeName(spec.targetName);
};

const resolveTextureRenameName = (spec: TextureSpec): { name: string; targetName?: string | null } | null => {
  const mode = spec.mode ?? 'create';
  if (mode !== 'update') return null;
  const name = normalizeName(spec.name);
  if (!name) return null;
  return { name, targetName: normalizeName(spec.targetName) };
};

const resolvePresetCreateName = (spec: TexturePipelinePreset): string | null => {
  const mode = spec.mode ?? 'create';
  if (mode !== 'create') return null;
  if (spec.targetId || spec.targetName) return null;
  return normalizeName(spec.name);
};

const resolvePresetUpdateTargetName = (spec: TexturePipelinePreset): string | null => {
  const mode = spec.mode ?? 'create';
  if (mode !== 'update') return null;
  if (!spec.targetName) return null;
  return normalizeName(spec.targetName);
};

const resolvePresetRenameName = (
  spec: TexturePipelinePreset
): { name: string; targetName?: string | null } | null => {
  const mode = spec.mode ?? 'create';
  if (mode !== 'update') return null;
  const name = normalizeName(spec.name);
  if (!name) return null;
  return { name, targetName: normalizeName(spec.targetName) };
};

export const collectPlanCreateConflicts = (args: {
  textures?: TextureSpec[];
  presets?: TexturePipelinePreset[];
  planTextureNames: Set<string>;
}): string[] => {
  const conflicts = new Set<string>();
  const planNames = args.planTextureNames;
  if (planNames.size === 0) return [];

  for (const spec of args.textures ?? []) {
    const name = resolveTextureCreateName(spec);
    if (name && planNames.has(name)) conflicts.add(name);
    const updateTarget = resolveTextureUpdateTargetName(spec);
    if (updateTarget && planNames.has(updateTarget)) conflicts.add(updateTarget);
    const rename = resolveTextureRenameName(spec);
    if (rename && planNames.has(rename.name) && rename.targetName !== rename.name) {
      conflicts.add(rename.name);
    }
  }

  for (const spec of args.presets ?? []) {
    const name = resolvePresetCreateName(spec);
    if (name && planNames.has(name)) conflicts.add(name);
    const updateTarget = resolvePresetUpdateTargetName(spec);
    if (updateTarget && planNames.has(updateTarget)) conflicts.add(updateTarget);
    const rename = resolvePresetRenameName(spec);
    if (rename && planNames.has(rename.name) && rename.targetName !== rename.name) {
      conflicts.add(rename.name);
    }
  }

  return Array.from(conflicts);
};
