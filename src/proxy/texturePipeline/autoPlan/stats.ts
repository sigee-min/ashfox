import { CUBE_FACE_DIRECTIONS, type Cube } from '../../../domain/model';
import { getFaceDimensions } from '../../../domain/uv/policy';
import type { CubeStat } from './types';

export const collectCubeStats = (
  cubes: Cube[]
): { totalArea: number; maxFaceWidth: number; maxFaceHeight: number; cubes: CubeStat[] } => {
  let totalArea = 0;
  let maxFaceWidth = 0;
  let maxFaceHeight = 0;
  const cubeStats: CubeStat[] = [];
  for (const cube of cubes) {
    let area = 0;
    for (const face of CUBE_FACE_DIRECTIONS) {
      const dims = getFaceDimensions(cube, face);
      const faceArea = Math.max(0, dims.width) * Math.max(0, dims.height);
      area += faceArea;
      totalArea += faceArea;
      if (dims.width > maxFaceWidth) maxFaceWidth = dims.width;
      if (dims.height > maxFaceHeight) maxFaceHeight = dims.height;
    }
    cubeStats.push({ cube, area });
  }
  return { totalArea, maxFaceWidth, maxFaceHeight, cubes: cubeStats };
};

