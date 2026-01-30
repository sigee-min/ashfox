import type { TextureUsage, CubeFaceDirection } from '../../domain/model';
import type { FacePaintSpec, TexturePipelinePreset, UvPaintSpec } from '../../spec';
import type { ProjectState, ToolResponse } from '../../types';
import { resolveMaterialPreset } from '../../domain/materials';
import {
  FACE_PAINT_NO_TEXTURES,
  FACE_PAINT_TARGET_NOT_FOUND,
  FACE_PAINT_TEXTURE_SIZE_MISSING,
  FACE_PAINT_UV_MISSING
} from '../../shared/messages';
import type { TextureTargetSet } from '../../domain/uvTargets';

type FacePaintPresetResult = {
  presets: TexturePipelinePreset[];
  materials: string[];
  textures: string[];
};

type FacePaintTarget = {
  texture: TextureUsage['textures'][number];
  cubeIds?: string[];
  cubeNames?: string[];
  faces?: CubeFaceDirection[];
  matchedFaces: number;
  matchedUvFaces: number;
  missingUvFaces: number;
};

export type FacePaintUsageSummary = {
  targets: TextureTargetSet;
  matchedFaces: number;
  matchedUvFaces: number;
  missingUvFaces: number;
};

export const summarizeFacePaintUsage = (
  entries: FacePaintSpec[],
  usage: TextureUsage
): FacePaintUsageSummary => {
  const ids = new Set<string>();
  const names = new Set<string>();
  let matchedFaces = 0;
  let matchedUvFaces = 0;
  let missingUvFaces = 0;
  if (usage.textures.length === 0) {
    return { targets: { ids, names }, matchedFaces, matchedUvFaces, missingUvFaces };
  }
  for (const entry of entries) {
    const targets = resolveFacePaintTargets(entry, usage);
    for (const target of targets) {
      names.add(target.texture.name);
      if (target.texture.id) ids.add(target.texture.id);
      matchedFaces += target.matchedFaces;
      matchedUvFaces += target.matchedUvFaces;
      missingUvFaces += target.missingUvFaces;
    }
  }
  return {
    targets: { ids, names },
    matchedFaces,
    matchedUvFaces,
    missingUvFaces
  };
};

export const buildFacePaintPresets = (args: {
  entries: FacePaintSpec[];
  usage: TextureUsage;
  project: ProjectState;
}): ToolResponse<FacePaintPresetResult> => {
  if (args.usage.textures.length === 0) {
    return err('invalid_state', FACE_PAINT_NO_TEXTURES);
  }

  const sizes = buildTextureSizeMap(args.project);
  const presets: TexturePipelinePreset[] = [];
  const materials = new Set<string>();
  const textures = new Set<string>();

  for (const entry of args.entries) {
    const materialLabel = entry.material.trim();
    const targets = resolveFacePaintTargets(entry, args.usage);
    if (targets.length === 0) {
      return err('invalid_state', FACE_PAINT_TARGET_NOT_FOUND(materialLabel));
    }
    const usableTargets = targets.filter((target) => target.matchedUvFaces > 0);
    if (usableTargets.length === 0) {
      return err('invalid_state', FACE_PAINT_UV_MISSING(materialLabel));
    }
    const resolved = resolveMaterialPreset(materialLabel);
    const palette = entry.palette ?? resolved.palette;
    for (const target of usableTargets) {
      const textureName = target.texture.name;
      const size = sizes.get(textureName) ?? resolveFallbackSize(args.project);
      if (!size) {
        return err('invalid_state', FACE_PAINT_TEXTURE_SIZE_MISSING(textureName));
      }
      const uvPaint = buildUvPaintSpec(entry, target);
      presets.push({
        preset: resolved.preset,
        width: size.width,
        height: size.height,
        mode: 'update',
        targetName: textureName,
        ...(entry.seed !== undefined ? { seed: entry.seed } : {}),
        ...(palette ? { palette } : {}),
        ...(uvPaint ? { uvPaint } : {})
      });
      textures.add(textureName);
    }
    materials.add(materialLabel);
  }

  return {
    ok: true,
    data: {
      presets,
      materials: Array.from(materials),
      textures: Array.from(textures)
    }
  };
};

const resolveFacePaintTargets = (entry: FacePaintSpec, usage: TextureUsage): FacePaintTarget[] => {
  const cubeIdSet = new Set(entry.cubeIds ?? []);
  const cubeNameSet = new Set(entry.cubeNames ?? []);
  const faceSet = entry.faces ? new Set(entry.faces) : null;
  const hasCubeFilter = cubeIdSet.size > 0 || cubeNameSet.size > 0;
  const targets: FacePaintTarget[] = [];

  for (const texture of usage.textures) {
    const matchedCubes: Array<{ id?: string; name: string; faces: CubeFaceDirection[] }> = [];
    let matchedFaces = 0;
    let matchedUvFaces = 0;
    let missingUvFaces = 0;
    for (const cube of texture.cubes) {
      const cubeMatch =
        !hasCubeFilter ||
        (cube.id && cubeIdSet.has(cube.id)) ||
        cubeNameSet.has(cube.name);
      if (!cubeMatch) continue;
      let cubeMatched = false;
      const faces: CubeFaceDirection[] = [];
      for (const face of cube.faces) {
        if (faceSet && !faceSet.has(face.face)) continue;
        cubeMatched = true;
        faces.push(face.face);
        if (face.uv) {
          matchedUvFaces += 1;
        } else {
          missingUvFaces += 1;
        }
      }
      if (cubeMatched) {
        matchedCubes.push({ id: cube.id, name: cube.name, faces });
      }
    }
    matchedFaces = matchedUvFaces + missingUvFaces;
    if (matchedFaces === 0) continue;
    const cubeIds = matchedCubes.map((cube) => cube.id).filter(Boolean) as string[];
    const cubeNames = matchedCubes.map((cube) => cube.name);
    targets.push({
      texture,
      cubeIds: cubeIds.length > 0 ? cubeIds : undefined,
      cubeNames: cubeNames.length > 0 ? cubeNames : undefined,
      faces: faceSet ? Array.from(faceSet) : undefined,
      matchedFaces,
      matchedUvFaces,
      missingUvFaces
    });
  }
  return targets;
};

const buildUvPaintSpec = (entry: FacePaintSpec, target: FacePaintTarget): UvPaintSpec | undefined => {
  const includeTarget = Boolean(target.cubeIds?.length || target.cubeNames?.length || target.faces?.length);
  return {
    scope: entry.scope ?? 'faces',
    mapping: entry.mapping ?? 'stretch',
    ...(entry.padding !== undefined ? { padding: entry.padding } : {}),
    ...(entry.anchor ? { anchor: entry.anchor } : {}),
    ...(includeTarget
      ? {
          target: {
            ...(target.cubeIds ? { cubeIds: target.cubeIds } : {}),
            ...(target.cubeNames ? { cubeNames: target.cubeNames } : {}),
            ...(target.faces ? { faces: target.faces } : {})
          }
        }
      : {})
  };
};

const buildTextureSizeMap = (project: ProjectState): Map<string, { width: number; height: number }> => {
  const fallback = project.textureResolution;
  const map = new Map<string, { width: number; height: number }>();
  const textures = project.textures ?? [];
  for (const tex of textures) {
    const width = resolveTextureSize(tex.width, fallback?.width);
    const height = resolveTextureSize(tex.height, fallback?.height);
    if (!width || !height) continue;
    map.set(tex.name, { width, height });
  }
  if (fallback && textures.length === 0) {
    map.set('texture', { width: fallback.width, height: fallback.height });
  }
  return map;
};

const resolveFallbackSize = (project: ProjectState): { width: number; height: number } | null => {
  const fallback = project.textureResolution;
  if (!fallback) return null;
  if (!Number.isFinite(fallback.width) || !Number.isFinite(fallback.height)) return null;
  if (fallback.width <= 0 || fallback.height <= 0) return null;
  return { width: fallback.width, height: fallback.height };
};

const resolveTextureSize = (value?: number, fallback?: number): number | null => {
  const resolved = Number.isFinite(value) && (value as number) > 0 ? Number(value) : null;
  if (resolved) return resolved;
  const fallbackResolved = Number.isFinite(fallback) && (fallback as number) > 0 ? Number(fallback) : null;
  return fallbackResolved;
};

const err = <T>(code: 'invalid_payload' | 'invalid_state', message: string): ToolResponse<T> => ({
  ok: false,
  error: { code, message }
});
