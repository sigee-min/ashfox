import type { TexturePipelinePayload } from '../../spec';

export type ExplicitTextureRefs = {
  names: Set<string>;
  ids: Set<string>;
};

export type FacePaintTextureRefs = {
  names: string[];
  ids: string[];
};

export const collectExplicitTextureRefs = (
  textures: TexturePipelinePayload['textures'],
  presets: TexturePipelinePayload['presets']
): ExplicitTextureRefs => {
  const names = new Set<string>();
  const ids = new Set<string>();
  const addName = (value: unknown) => {
    if (typeof value !== 'string') return;
    const trimmed = value.trim();
    if (trimmed.length > 0) names.add(trimmed);
  };
  const addId = (value: unknown) => {
    if (typeof value !== 'string') return;
    const trimmed = value.trim();
    if (trimmed.length > 0) ids.add(trimmed);
  };

  for (const spec of textures ?? []) {
    const mode = spec.mode ?? 'create';
    addId(spec.id);
    if (mode === 'create') {
      addName(spec.name);
      continue;
    }
    addName(spec.targetName);
    addName(spec.name);
    addId(spec.targetId);
  }

  for (const preset of presets ?? []) {
    const mode = preset.mode ?? 'create';
    if (mode === 'create') {
      addName(preset.name);
      continue;
    }
    addName(preset.targetName);
    addName(preset.name);
    addId(preset.targetId);
  }

  return { names, ids };
};

export const resolveFacePaintConflicts = (
  facePaint: FacePaintTextureRefs,
  explicit: ExplicitTextureRefs
): string[] => {
  if (explicit.names.size === 0 && explicit.ids.size === 0) return [];
  const conflicts = new Set<string>();
  for (const name of facePaint.names) {
    if (explicit.names.has(name)) conflicts.add(name);
  }
  for (const id of facePaint.ids) {
    if (explicit.ids.has(id)) conflicts.add(`id:${id}`);
  }
  return Array.from(conflicts);
};
