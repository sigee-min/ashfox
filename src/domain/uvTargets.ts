export type TextureTargetSet = { ids: Set<string>; names: Set<string> };

type TargetLike = {
  id?: string;
  targetId?: string;
  name?: string;
  targetName?: string;
};

export const collectTextureTargets = (entries: TargetLike[]): TextureTargetSet => {
  const ids = new Set<string>();
  const names = new Set<string>();
  entries.forEach((entry) => {
    if (entry.targetId) ids.add(entry.targetId);
    if (entry.id) ids.add(entry.id);
    if (entry.targetName) names.add(entry.targetName);
    if (entry.name) names.add(entry.name);
  });
  return { ids, names };
};

export const collectSingleTarget = (entry: TargetLike): TextureTargetSet =>
  collectTextureTargets([entry]);

export const isIssueTarget = (
  issue: { textureId?: string; textureName: string },
  targets: TextureTargetSet
): boolean => {
  if (issue.textureId && targets.ids.has(issue.textureId)) return true;
  return targets.names.has(issue.textureName);
};
