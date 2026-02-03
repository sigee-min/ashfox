import type { DomainError, DomainResult } from '../result';
import type { Cube, CubeFaceDirection, TextureUsage } from '../model';
import { UvPolicyConfig, computeExpectedUvSize, getFaceDimensions } from './policy';
import type { UvAtlasMessages } from './atlas';

export type FaceRef = {
  cubeId?: string;
  cubeName: string;
  face: CubeFaceDirection;
};

export type Group = {
  key: string;
  width: number;
  height: number;
  faces: FaceRef[];
};

export const buildGroups = (
  entry: TextureUsage['textures'][number],
  cubeById: Map<string, Cube>,
  cubeByName: Map<string, Cube>,
  config: {
    width: number;
    height: number;
    padding: number;
    policy: UvPolicyConfig;
    baseResolution: { width: number; height: number };
    messages: UvAtlasMessages;
  }
): DomainResult<Group[]> => {
  const messages = config.messages;
  const groups = new Map<string, Group>();
  for (const cube of entry.cubes) {
    const target = cube.id ? cubeById.get(cube.id) : undefined;
    const resolved = target ?? cubeByName.get(cube.name);
    if (!resolved) {
      return fail('invalid_state', messages.cubeMissing(cube.name), {
        textureName: entry.name,
        cubeName: cube.name
      });
    }
    for (const face of cube.faces) {
      const dims = getFaceDimensions(resolved, face.face);
      const expected = computeExpectedUvSize(dims, config.baseResolution, config.policy);
      if (!expected) {
        return fail('invalid_state', messages.deriveSizeFailed(cube.name, face.face), {
          textureName: entry.name,
          cubeName: cube.name,
          face: face.face,
          dimensions: dims,
          resolution: config.baseResolution
        });
      }
      const width = Math.max(1, Math.round(expected.width));
      const height = Math.max(1, Math.round(expected.height));
      if (width > config.width || height > config.height) {
        return fail('invalid_state', messages.uvSizeExceeds(cube.name, face.face), {
          reason: 'uv_size_exceeds',
          textureName: entry.name,
          cubeName: cube.name,
          face: face.face,
          expected: { width, height },
          resolution: { width: config.width, height: config.height }
        });
      }
      const key = `${width}x${height}`;
      const group = groups.get(key) ?? { key, width, height, faces: [] };
      group.faces.push({ cubeId: cube.id, cubeName: cube.name, face: face.face });
      groups.set(key, group);
    }
  }
  return { ok: true, data: Array.from(groups.values()) };
};

const fail = (code: DomainError['code'], message: string, details?: Record<string, unknown>): DomainResult<never> => ({
  ok: false,
  error: { code, message, details }
});
