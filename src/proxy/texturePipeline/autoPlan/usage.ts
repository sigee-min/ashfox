import { CUBE_FACE_DIRECTIONS, type TextureUsage } from '../../../domain/model';
import type { AtlasPlan } from '../../../domain/uv/atlas';
import type { UvAssignmentSpec, UvFaceMap } from '../../../domain/uv/apply';
import type { TextureGroup } from './types';

export const buildUsage = (groups: TextureGroup[], resolution: { width: number; height: number }): TextureUsage => ({
  textures: groups.map((group) => ({
    name: group.name,
    width: resolution.width,
    height: resolution.height,
    cubeCount: group.cubes.length,
    faceCount: group.cubes.length * CUBE_FACE_DIRECTIONS.length,
    cubes: group.cubes.map((cube) => ({
      id: cube.id,
      name: cube.name,
      faces: CUBE_FACE_DIRECTIONS.map((face) => ({ face }))
    }))
  }))
});

export const buildUvAssignments = (assignments: AtlasPlan['assignments']): UvAssignmentSpec[] => {
  const grouped = new Map<string, UvAssignmentSpec>();
  for (const assignment of assignments) {
    const key = assignment.cubeId ? `id:${assignment.cubeId}` : `name:${assignment.cubeName}`;
    const entry = grouped.get(key) ?? {
      cubeId: assignment.cubeId,
      cubeName: assignment.cubeName,
      faces: {}
    };
    (entry.faces as UvFaceMap)[assignment.face] = assignment.uv;
    grouped.set(key, entry);
  }
  return Array.from(grouped.values());
};

export const buildUsageTargets = (groups: TextureGroup[], resolution: { width: number; height: number }) => ({
  usage: buildUsage(groups, resolution),
  resolution
});

