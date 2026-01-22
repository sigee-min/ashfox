import { CubeFaceDirection, TextureUsageResult } from '../ports/editor';
import { TrackedCube } from '../session';
import { ToolError, ToolResponse } from '../types';

export type UvFaceMap = Partial<Record<CubeFaceDirection, [number, number, number, number]>>;

export type UvAssignmentSpec = {
  cubeId?: string;
  cubeName?: string;
  cubeIds?: string[];
  cubeNames?: string[];
  faces: UvFaceMap;
};

export type UvAssignmentUpdate = {
  cubeId?: string;
  cubeName: string;
  faces: UvFaceMap;
};

export type UvApplyPlan = {
  updates: UvAssignmentUpdate[];
  cubeCount: number;
  faceCount: number;
  usage: TextureUsageResult;
  touchedTextures: Array<{ id?: string; name: string }>;
};

type FaceRef = {
  face: { face: CubeFaceDirection; uv?: [number, number, number, number] };
  texture: { id?: string; name: string };
};

export const buildUvApplyPlan = (
  usage: TextureUsageResult,
  cubes: TrackedCube[],
  assignments: UvAssignmentSpec[],
  textureResolution?: { width: number; height: number }
): ToolResponse<UvApplyPlan> => {
  if (!Array.isArray(assignments) || assignments.length === 0) {
    return fail('invalid_payload', 'assignments must be a non-empty array.');
  }
  const cubeById = new Map<string, TrackedCube>();
  const cubeByName = new Map<string, TrackedCube>();
  const duplicateNames = new Set<string>();
  cubes.forEach((cube) => {
    if (cube.id) cubeById.set(cube.id, cube);
    if (cubeByName.has(cube.name)) {
      duplicateNames.add(cube.name);
    } else {
      cubeByName.set(cube.name, cube);
    }
  });
  const patchedUsage = cloneUsage(usage);
  const usageIndex = buildUsageIndex(patchedUsage);
  const updatesByCube = new Map<string, UvAssignmentUpdate>();
  const seenFaces = new Map<string, [number, number, number, number]>();
  const touchedTextures = new Map<string, { id?: string; name: string }>();
  let faceCount = 0;

  for (const assignment of assignments) {
    if (!assignment || typeof assignment !== 'object') {
      return fail('invalid_payload', 'assignment must be an object.');
    }
    const targets = resolveAssignmentTargets(assignment, cubeById, cubeByName, duplicateNames);
    if (!targets.ok) return targets;
    const faceEntries = Object.entries(assignment.faces ?? {});
    if (faceEntries.length === 0) {
      return fail('invalid_payload', 'faces must include at least one mapping.');
    }
    for (const target of targets.data) {
      const cubeKey = target.id ? `id:${target.id}` : `name:${target.name}`;
      const update = updatesByCube.get(cubeKey) ?? {
        cubeId: target.id ?? undefined,
        cubeName: target.name,
        faces: {}
      };
      for (const [faceKey, uv] of faceEntries) {
        const faceDir = faceKey as CubeFaceDirection;
        if (!VALID_FACES.has(faceDir)) {
          return fail('invalid_payload', `Invalid face: ${faceKey}.`);
        }
        if (!Array.isArray(uv) || uv.length !== 4 || !uv.every((value) => Number.isFinite(value))) {
          return fail('invalid_payload', `UV for ${faceKey} must be [x1,y1,x2,y2] with finite numbers.`);
        }
        if (textureResolution) {
          const boundsErr = validateUvBounds(uv, textureResolution);
          if (boundsErr) return boundsErr;
        }
        const faceRef = resolveUsageFaceRef(usageIndex, target, faceDir);
        if (!faceRef) {
          return fail(
            'invalid_state',
            `UV target ${target.name} (${faceDir}) is not bound to a texture. Assign the texture first.`
          );
        }
        const faceKeyRef = `${cubeKey}:${faceDir}`;
        const existing = seenFaces.get(faceKeyRef);
        if (existing) {
          const same =
            existing[0] === uv[0] && existing[1] === uv[1] && existing[2] === uv[2] && existing[3] === uv[3];
          if (!same) {
            return fail('invalid_payload', `Conflicting UV assignments for ${target.name} (${faceDir}).`);
          }
        } else {
          seenFaces.set(faceKeyRef, uv);
          faceCount += 1;
        }
        faceRef.face.uv = [uv[0], uv[1], uv[2], uv[3]];
        touchedTextures.set(textureKey(faceRef.texture), faceRef.texture);
        update.faces[faceDir] = [uv[0], uv[1], uv[2], uv[3]];
      }
      updatesByCube.set(cubeKey, update);
    }
  }

  return {
    ok: true,
    data: {
      updates: Array.from(updatesByCube.values()),
      cubeCount: updatesByCube.size,
      faceCount,
      usage: patchedUsage,
      touchedTextures: Array.from(touchedTextures.values())
    }
  };
};

const resolveAssignmentTargets = (
  assignment: UvAssignmentSpec,
  cubeById: Map<string, TrackedCube>,
  cubeByName: Map<string, TrackedCube>,
  duplicateNames: Set<string>
): ToolResponse<TrackedCube[]> => {
  const ids = new Set<string>();
  const names = new Set<string>();
  if (assignment.cubeId) ids.add(assignment.cubeId);
  if (assignment.cubeName) names.add(assignment.cubeName);
  (assignment.cubeIds ?? []).forEach((id) => ids.add(id));
  (assignment.cubeNames ?? []).forEach((name) => names.add(name));
  if (ids.size === 0 && names.size === 0) {
    return fail('invalid_payload', 'assignment must include cubeId/cubeName or cubeIds/cubeNames.');
  }
  const targets: TrackedCube[] = [];
  for (const id of ids) {
    if (!cubeById.has(id)) {
      return fail('invalid_payload', `Cube not found for id: ${id}`);
    }
    const cube = cubeById.get(id);
    if (cube) targets.push(cube);
  }
  for (const name of names) {
    if (duplicateNames.has(name)) {
      return fail('invalid_payload', `Cube name "${name}" is duplicated. Use cubeId instead.`);
    }
    if (!cubeByName.has(name)) {
      return fail('invalid_payload', `Cube not found: ${name}`);
    }
    const cube = cubeByName.get(name);
    if (cube) targets.push(cube);
  }
  return { ok: true, data: dedupeCubes(targets) };
};

const dedupeCubes = (cubes: TrackedCube[]): TrackedCube[] => {
  const seen = new Set<string>();
  const out: TrackedCube[] = [];
  cubes.forEach((cube) => {
    const key = cube.id ? `id:${cube.id}` : `name:${cube.name}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(cube);
  });
  return out;
};

const buildUsageIndex = (usage: TextureUsageResult) => {
  const byId = new Map<string, Map<CubeFaceDirection, FaceRef>>();
  const byName = new Map<string, Map<CubeFaceDirection, FaceRef>>();
  usage.textures.forEach((texture) => {
    texture.cubes.forEach((cube) => {
      cube.faces.forEach((face) => {
        const ref: FaceRef = {
          face: face,
          texture: { id: texture.id ?? undefined, name: texture.name }
        };
        if (cube.id) {
          const map = byId.get(cube.id) ?? new Map<CubeFaceDirection, FaceRef>();
          map.set(face.face, ref);
          byId.set(cube.id, map);
        }
        if (cube.name) {
          const map = byName.get(cube.name) ?? new Map<CubeFaceDirection, FaceRef>();
          map.set(face.face, ref);
          byName.set(cube.name, map);
        }
      });
    });
  });
  return { byId, byName };
};

const resolveUsageFaceRef = (
  index: ReturnType<typeof buildUsageIndex>,
  cube: TrackedCube,
  face: CubeFaceDirection
): FaceRef | null => {
  if (cube.id) {
    const map = index.byId.get(cube.id);
    if (map && map.has(face)) return map.get(face) ?? null;
  }
  const map = index.byName.get(cube.name);
  if (map && map.has(face)) return map.get(face) ?? null;
  return null;
};

const cloneUsage = (usage: TextureUsageResult): TextureUsageResult => ({
  textures: usage.textures.map((entry) => ({
    id: entry.id,
    name: entry.name,
    cubeCount: entry.cubeCount,
    faceCount: entry.faceCount,
    cubes: entry.cubes.map((cube) => ({
      id: cube.id,
      name: cube.name,
      faces: cube.faces.map((face) => ({
        face: face.face,
        uv: face.uv ? [face.uv[0], face.uv[1], face.uv[2], face.uv[3]] : undefined
      }))
    }))
  })),
  unresolved: usage.unresolved
    ? usage.unresolved.map((entry) => ({
        textureRef: entry.textureRef,
        cubeId: entry.cubeId,
        cubeName: entry.cubeName,
        face: entry.face
      }))
    : undefined
});

const textureKey = (texture: { id?: string; name: string }): string => (texture.id ? `id:${texture.id}` : `name:${texture.name}`);

const VALID_FACES = new Set<CubeFaceDirection>(['north', 'south', 'east', 'west', 'up', 'down']);

const fail = (code: ToolError['code'], message: string): ToolResponse<never> => ({
  ok: false,
  error: { code, message }
});

const validateUvBounds = (
  uv: [number, number, number, number],
  resolution: { width: number; height: number }
): ToolResponse<never> | null => {
  const [x1, y1, x2, y2] = uv;
  if (x1 < 0 || y1 < 0 || x2 < 0 || y2 < 0) {
    return fail('invalid_payload', 'Face UV coordinates must be non-negative.');
  }
  if (x1 > resolution.width || x2 > resolution.width || y1 > resolution.height || y2 > resolution.height) {
    return fail(
      'invalid_payload',
      `Face UV is outside texture resolution ${resolution.width}x${resolution.height}.`
    );
  }
  if (x2 < x1 || y2 < y1) {
    return fail('invalid_payload', 'Face UV coordinates must satisfy x2 >= x1 and y2 >= y1.');
  }
  return null;
};
