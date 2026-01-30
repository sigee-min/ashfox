import type { Limits, Snapshot, TextureStat, TextureUsage, ValidationFinding } from './model';
import { findUvOverlapIssues, formatUvFaceRect } from './uvOverlap';
import { findUvScaleIssues } from './uvScale';
import { UvPolicyConfig } from './uvPolicy';
import {
  VALIDATION_ANIMATION_TOO_LONG,
  VALIDATION_DUPLICATE_BONE,
  VALIDATION_DUPLICATE_CUBE,
  VALIDATION_CUBE_CONTAINMENT,
  VALIDATION_FACE_UV_OUT_OF_BOUNDS,
  VALIDATION_MAX_CUBES_EXCEEDED,
  VALIDATION_NO_BONES,
  VALIDATION_ORPHAN_CUBE,
  VALIDATION_TEXTURE_SIZE_MISMATCH,
  VALIDATION_TEXTURE_TOO_LARGE,
  VALIDATION_TEXTURE_UNASSIGNED,
  VALIDATION_TEXTURE_UNRESOLVED_REFS,
  VALIDATION_UV_OUT_OF_BOUNDS,
  VALIDATION_UV_OVERLAP,
  VALIDATION_UV_SCALE_MISMATCH,
  VALIDATION_UV_SCALE_MISMATCH_SUMMARY
} from '../shared/messages';

export interface ValidationContext {
  limits: Limits;
  textures?: TextureStat[];
  textureResolution?: { width: number; height: number };
  textureUsage?: TextureUsage;
  uvPolicy?: UvPolicyConfig;
}

export function validateSnapshot(state: Snapshot, context: ValidationContext): ValidationFinding[] {
  const findings: ValidationFinding[] = [];
  const { limits, textures, textureResolution, textureUsage } = context;

  const boneNames = new Set(state.bones.map((b) => b.name));
  if (state.bones.length === 0) {
    findings.push({ code: 'no_bones', message: VALIDATION_NO_BONES, severity: 'warning' });
  }

  state.cubes.forEach((c) => {
    if (!boneNames.has(c.bone)) {
      findings.push({
        code: 'orphan_cube',
        message: VALIDATION_ORPHAN_CUBE(c.name, c.bone),
        severity: 'error'
      });
    }
  });

  findDuplicates(state.bones.map((b) => b.name)).forEach((name) => {
    findings.push({ code: 'duplicate_bone', message: VALIDATION_DUPLICATE_BONE(name), severity: 'error' });
  });

  findDuplicates(state.cubes.map((c) => c.name)).forEach((name) => {
    findings.push({ code: 'duplicate_cube', message: VALIDATION_DUPLICATE_CUBE(name), severity: 'error' });
  });

  findCubeContainments(state.cubes).forEach((pair) => {
    findings.push({
      code: 'cube_containment',
      message: VALIDATION_CUBE_CONTAINMENT(pair.inner, pair.outer),
      severity: 'warning'
    });
  });

  if (state.cubes.length > limits.maxCubes) {
    findings.push({
      code: 'max_cubes_exceeded',
      message: VALIDATION_MAX_CUBES_EXCEEDED(state.cubes.length, limits.maxCubes),
      severity: 'error'
    });
  }

  state.animations.forEach((anim) => {
    if (anim.length > limits.maxAnimationSeconds) {
      findings.push({
        code: 'animation_too_long',
        message: VALIDATION_ANIMATION_TOO_LONG(anim.name, limits.maxAnimationSeconds),
        severity: 'error'
      });
    }
  });

  if (textures && textures.length > 0) {
    textures.forEach((tex) => {
      if (tex.width > limits.maxTextureSize || tex.height > limits.maxTextureSize) {
        findings.push({
          code: 'texture_too_large',
          message: VALIDATION_TEXTURE_TOO_LARGE(tex.name, limits.maxTextureSize),
          severity: 'error'
        });
      }
    });
  }

  if (textureResolution) {
    const { width, height } = textureResolution;
    if (textures && textures.length > 0) {
      textures.forEach((tex) => {
        if (tex.width !== width || tex.height !== height) {
          findings.push({
            code: 'texture_size_mismatch',
            message: VALIDATION_TEXTURE_SIZE_MISMATCH(tex.name, tex.width, tex.height, width, height),
            severity: 'warning'
          });
        }
      });
    }
    state.cubes.forEach((cube) => {
      if (!cube.uv) return;
      const [u, v] = cube.uv;
      if (u < 0 || v < 0 || u >= width || v >= height) {
        findings.push({
          code: 'uv_out_of_bounds',
          message: VALIDATION_UV_OUT_OF_BOUNDS(cube.name, u, v, width, height),
          severity: 'warning'
        });
      }
    });
    if (textureUsage) {
      const unresolvedCount = textureUsage.unresolved?.length ?? 0;
      if (unresolvedCount > 0) {
        findings.push({
          code: 'texture_unresolved_refs',
          message: VALIDATION_TEXTURE_UNRESOLVED_REFS(unresolvedCount),
          severity: 'warning'
        });
      }
      textureUsage.textures.forEach((entry) => {
        if (entry.faceCount === 0) {
          findings.push({
            code: 'texture_unassigned',
            message: VALIDATION_TEXTURE_UNASSIGNED(entry.name),
            severity: 'warning'
          });
        }
      });
      textureUsage.textures.forEach((entry) => {
        entry.cubes.forEach((cube) => {
          cube.faces.forEach((face) => {
            const uv = face.uv;
            if (!uv) return;
            const [x1, y1, x2, y2] = uv;
            if (x1 < 0 || y1 < 0 || x2 > width || y2 > height) {
              findings.push({
                code: 'face_uv_out_of_bounds',
                message: VALIDATION_FACE_UV_OUT_OF_BOUNDS(cube.name, face.face, width, height, x1, y1, x2, y2),
                severity: 'warning'
              });
            }
          });
        });
      });
      const overlaps = findUvOverlapIssues(textureUsage);
      overlaps.forEach((overlap) => {
        const example = overlap.example
          ? ` Example: ${formatUvFaceRect(overlap.example.a)} overlaps ${formatUvFaceRect(overlap.example.b)}.`
          : '';
        findings.push({
          code: 'uv_overlap',
          message: VALIDATION_UV_OVERLAP(overlap.textureName, overlap.conflictCount, example),
          severity: 'error'
        });
      });
      if (context.uvPolicy) {
        const scaleResult = findUvScaleIssues(textureUsage, state.cubes, { width, height }, context.uvPolicy);
        scaleResult.issues.forEach((issue) => {
          const example = issue.example
            ? ` Example: ${issue.example.cubeName} (${issue.example.face}) actual ${issue.example.actual.width}x${issue.example.actual.height} vs expected ${issue.example.expected.width}x${issue.example.expected.height}.`
            : '';
          findings.push({
            code: 'uv_scale_mismatch',
            message: VALIDATION_UV_SCALE_MISMATCH(issue.textureName, issue.mismatchCount, example),
            severity: 'error'
          });
        });
        if (scaleResult.mismatchedFaces > 0) {
          findings.push({
            code: 'uv_scale_mismatch_summary',
            message: VALIDATION_UV_SCALE_MISMATCH_SUMMARY(scaleResult.mismatchedFaces, scaleResult.totalFaces),
            severity: 'info'
          });
        }
      }
    }
  }

  return findings;
}

function findDuplicates(values: string[]): string[] {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  values.forEach((value) => {
    if (seen.has(value)) {
      dupes.add(value);
    } else {
      seen.add(value);
    }
  });
  return [...dupes];
}

type CubeBounds = {
  name: string;
  bone: string;
  min: [number, number, number];
  max: [number, number, number];
};

type CubeContainment = {
  inner: string;
  outer: string;
};

const EPSILON = 1e-6;

const findCubeContainments = (cubes: Snapshot['cubes']): CubeContainment[] => {
  const boundsByBone = new Map<string, CubeBounds[]>();
  cubes.forEach((cube) => {
    if (!isZeroRotation(cube.rotation)) return;
    const bounds = buildCubeBounds(cube);
    const list = boundsByBone.get(cube.bone) ?? [];
    list.push(bounds);
    boundsByBone.set(cube.bone, list);
  });

  const results: CubeContainment[] = [];
  const seen = new Set<string>();
  boundsByBone.forEach((entries) => {
    for (let i = 0; i < entries.length; i += 1) {
      const a = entries[i];
      for (let j = i + 1; j < entries.length; j += 1) {
        const b = entries[j];
        const aContainsB = containsBounds(a, b);
        const bContainsA = containsBounds(b, a);
        if (!aContainsB && !bContainsA) continue;
        if (aContainsB && bContainsA) {
          const inner = a.name <= b.name ? a.name : b.name;
          const outer = a.name <= b.name ? b.name : a.name;
          const key = `${inner}::${outer}`;
          if (seen.has(key)) continue;
          seen.add(key);
          results.push({ inner, outer });
          continue;
        }
        if (aContainsB) {
          const key = `${b.name}::${a.name}`;
          if (seen.has(key)) continue;
          seen.add(key);
          results.push({ inner: b.name, outer: a.name });
        } else if (bContainsA) {
          const key = `${a.name}::${b.name}`;
          if (seen.has(key)) continue;
          seen.add(key);
          results.push({ inner: a.name, outer: b.name });
        }
      }
    }
  });
  return results;
};

const buildCubeBounds = (cube: Snapshot['cubes'][number]): CubeBounds => {
  const inflate = Number.isFinite(cube.inflate) ? Number(cube.inflate) : 0;
  const min: [number, number, number] = [
    Math.min(cube.from[0], cube.to[0]) - inflate,
    Math.min(cube.from[1], cube.to[1]) - inflate,
    Math.min(cube.from[2], cube.to[2]) - inflate
  ];
  const max: [number, number, number] = [
    Math.max(cube.from[0], cube.to[0]) + inflate,
    Math.max(cube.from[1], cube.to[1]) + inflate,
    Math.max(cube.from[2], cube.to[2]) + inflate
  ];
  for (let i = 0; i < 3; i += 1) {
    if (min[i] > max[i]) {
      const swap = min[i];
      min[i] = max[i];
      max[i] = swap;
    }
  }
  return { name: cube.name, bone: cube.bone, min, max };
};

const containsBounds = (outer: CubeBounds, inner: CubeBounds): boolean =>
  outer.min[0] <= inner.min[0] + EPSILON &&
  outer.min[1] <= inner.min[1] + EPSILON &&
  outer.min[2] <= inner.min[2] + EPSILON &&
  outer.max[0] >= inner.max[0] - EPSILON &&
  outer.max[1] >= inner.max[1] - EPSILON &&
  outer.max[2] >= inner.max[2] - EPSILON;

const isZeroRotation = (rotation?: [number, number, number]): boolean =>
  !rotation || (rotation[0] === 0 && rotation[1] === 0 && rotation[2] === 0);
