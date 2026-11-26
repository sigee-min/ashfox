import { compareText } from '../../stableOrder';
import type { ExportAdaptedDocument } from '../adapter';
import { resourceToken } from '../../resourceToken';

const MINECRAFT_ANIMATION_NAME = /^animation\.[a-z0-9_.-]+$/;

export const minecraftActorAnimationNames = (
  document: ExportAdaptedDocument,
): ReadonlyMap<string, string> => {
  const profile = document.formatProfile;
  if (profile.id !== 'minecraft.bedrock' && profile.id !== 'minecraft.java.geckolib5') {
    return new Map();
  }
  const prefix = `animation.${resourceToken(profile.modelPath.split('/').join('.'), 'model')}`;
  const usedNames = new Set<string>();
  const names = new Map<string, string>();
  for (const clip of Object.values(document.animations).sort((left, right) =>
    compareText(left.id, right.id),
  )) {
    let name =
      MINECRAFT_ANIMATION_NAME.test(clip.name) && !usedNames.has(clip.name)
        ? clip.name
        : `${prefix}.${resourceToken(clip.name, 'clip')}`;
    if (usedNames.has(name)) {
      const base = `${name}.${resourceToken(clip.id, 'clip')}`;
      name = base;
      let ordinal = 2;
      while (usedNames.has(name)) {
        name = `${base}.${ordinal}`;
        ordinal += 1;
      }
    }
    usedNames.add(name);
    names.set(clip.id, name);
  }
  return names;
};
