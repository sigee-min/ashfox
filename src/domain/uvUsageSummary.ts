import type { TextureUsage } from './model';
import { expandTextureTargets, isIssueTarget, type TextureTargetSet } from './uvTargets';

export type UvUsageSummary = {
  matchedFaces: number;
  matchedUvFaces: number;
  missingUvFaces: number;
};

const hasTargets = (targets: TextureTargetSet | undefined): boolean =>
  Boolean(targets && (targets.ids.size > 0 || targets.names.size > 0));

export const summarizeUvUsage = (
  usage: TextureUsage,
  targets?: TextureTargetSet
): UvUsageSummary => {
  const useTargets = hasTargets(targets);
  const expanded = useTargets && targets ? expandTextureTargets(usage, targets) : null;
  let matchedFaces = 0;
  let matchedUvFaces = 0;
  let missingUvFaces = 0;
  usage.textures.forEach((entry) => {
    if (expanded && !isIssueTarget({ textureId: entry.id, textureName: entry.name }, expanded)) {
      return;
    }
    entry.cubes.forEach((cube) => {
      cube.faces.forEach((face) => {
        matchedFaces += 1;
        if (face.uv) {
          matchedUvFaces += 1;
        } else {
          missingUvFaces += 1;
        }
      });
    });
  });
  return { matchedFaces, matchedUvFaces, missingUvFaces };
};
