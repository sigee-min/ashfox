import type { TextureUsage } from '../../domain/model';
import type { TextureSpec, TexturePipelinePreset } from '../../spec';
import { resolveTextureUsageEntry } from '../../domain/textureUsage';
import { normalizeTextureSize } from '../../domain/textureUtils';
import type { UvRecoveryInfo } from '../uvRecovery';

type Size = { width: number; height: number };

export const adjustTextureSpecsForRecovery = (
  textures: TextureSpec[],
  usage: TextureUsage,
  recovery?: UvRecoveryInfo
): TextureSpec[] => {
  if (!shouldAdjust(recovery)) return textures;
  const recoverySize = resolveRecoverySize(recovery);
  let changed = false;
  const adjusted = textures.map((spec) => {
    const targetSize = resolveTargetSize(
      usage,
      {
        targetId: spec.targetId,
        targetName: spec.targetName,
        id: spec.id,
        name: spec.name
      },
      recovery,
      recoverySize
    );
    if (!targetSize) return spec;
    if (spec.width === targetSize.width && spec.height === targetSize.height) return spec;
    changed = true;
    return { ...spec, width: targetSize.width, height: targetSize.height };
  });
  return changed ? adjusted : textures;
};

export const adjustPresetSpecsForRecovery = (
  presets: TexturePipelinePreset[],
  usage: TextureUsage,
  recovery?: UvRecoveryInfo
): TexturePipelinePreset[] => {
  if (!shouldAdjust(recovery)) return presets;
  const recoverySize = resolveRecoverySize(recovery);
  let changed = false;
  const adjusted = presets.map((preset) => {
    const targetSize = resolveTargetSize(
      usage,
      {
        targetId: preset.targetId,
        targetName: preset.targetName,
        name: preset.name
      },
      recovery,
      recoverySize
    );
    if (!targetSize) return preset;
    if (preset.width === targetSize.width && preset.height === targetSize.height) return preset;
    changed = true;
    return { ...preset, width: targetSize.width, height: targetSize.height };
  });
  return changed ? adjusted : presets;
};

const shouldAdjust = (recovery?: UvRecoveryInfo): boolean =>
  Boolean(recovery && (recovery.method === 'plan' || recovery.method === 'auto_uv_atlas'));

const resolveTargetSize = (
  usage: TextureUsage,
  target: { targetId?: string; targetName?: string; id?: string; name?: string },
  recovery: UvRecoveryInfo | undefined,
  recoverySize: Size | null
): Size | null => {
  const entry = resolveTextureUsageEntry(usage, target);
  const entrySize = normalizeTextureSize(entry?.width, entry?.height);
  if (recovery?.method === 'auto_uv_atlas') {
    return recoverySize ?? entrySize ?? null;
  }
  return entrySize ?? recoverySize ?? null;
};

const resolveRecoverySize = (recovery?: UvRecoveryInfo): Size | null =>
  normalizeTextureSize(recovery?.resolution?.width, recovery?.resolution?.height);


