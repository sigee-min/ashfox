import type { ModelCubeSpec } from '../../spec';
import type { Vec3 } from './types';

export const resolveCubeBounds = (cube: ModelCubeSpec): { from: Vec3; to: Vec3; explicit: boolean } | null => {
  if (cube.from && cube.to) {
    return { from: cube.from, to: cube.to, explicit: true };
  }
  if (cube.center && cube.size) {
    const half: Vec3 = [cube.size[0] / 2, cube.size[1] / 2, cube.size[2] / 2];
    return {
      from: [cube.center[0] - half[0], cube.center[1] - half[1], cube.center[2] - half[2]],
      to: [cube.center[0] + half[0], cube.center[1] + half[1], cube.center[2] + half[2]],
      explicit: true
    };
  }
  return null;
};
