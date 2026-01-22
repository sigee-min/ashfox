import { Limits, ValidateFinding } from '../types';
import { SessionState } from '../session';
import { TextureStat, TextureUsageResult } from '../ports/editor';
import { findUvOverlapIssues, formatUvFaceRect } from './uvOverlap';
import { findUvScaleIssues } from './uvScale';
import { UvPolicyConfig } from './uvPolicy';

export interface ValidationContext {
  limits: Limits;
  textures?: TextureStat[];
  textureResolution?: { width: number; height: number };
  textureUsage?: TextureUsageResult;
  uvPolicy?: UvPolicyConfig;
}

export function validateSnapshot(state: SessionState, context: ValidationContext): ValidateFinding[] {
  const findings: ValidateFinding[] = [];
  const { limits, textures, textureResolution, textureUsage } = context;

  const boneNames = new Set(state.bones.map((b) => b.name));
  if (state.bones.length === 0) {
    findings.push({ code: 'no_bones', message: 'No bones present in the project.', severity: 'warning' });
  }

  state.cubes.forEach((c) => {
    if (!boneNames.has(c.bone)) {
      findings.push({
        code: 'orphan_cube',
        message: `Cube "${c.name}" references missing bone "${c.bone}".`,
        severity: 'error'
      });
    }
  });

  findDuplicates(state.bones.map((b) => b.name)).forEach((name) => {
    findings.push({ code: 'duplicate_bone', message: `Duplicate bone name: ${name}`, severity: 'error' });
  });

  findDuplicates(state.cubes.map((c) => c.name)).forEach((name) => {
    findings.push({ code: 'duplicate_cube', message: `Duplicate cube name: ${name}`, severity: 'error' });
  });

  if (state.cubes.length > limits.maxCubes) {
    findings.push({
      code: 'max_cubes_exceeded',
      message: `Cube count (${state.cubes.length}) exceeds limit (${limits.maxCubes}).`,
      severity: 'error'
    });
  }

  state.animations.forEach((anim) => {
    if (anim.length > limits.maxAnimationSeconds) {
      findings.push({
        code: 'animation_too_long',
        message: `Animation "${anim.name}" exceeds max seconds (${limits.maxAnimationSeconds}).`,
        severity: 'error'
      });
    }
  });

  if (textures && textures.length > 0) {
    textures.forEach((tex) => {
      if (tex.width > limits.maxTextureSize || tex.height > limits.maxTextureSize) {
        findings.push({
          code: 'texture_too_large',
          message: `Texture "${tex.name}" exceeds max size (${limits.maxTextureSize}px).`,
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
            message: `Texture "${tex.name}" size ${tex.width}x${tex.height} does not match project textureResolution ${width}x${height}.`,
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
          message: `Cube "${cube.name}" UV ${u},${v} is outside texture resolution ${width}x${height}.`,
          severity: 'warning'
        });
      }
    });
    if (textureUsage) {
      const unresolvedCount = textureUsage.unresolved?.length ?? 0;
      if (unresolvedCount > 0) {
        findings.push({
          code: 'texture_unresolved_refs',
          message: `Unresolved texture references detected (${unresolvedCount}). Assign textures before rendering.`,
          severity: 'warning'
        });
      }
      textureUsage.textures.forEach((entry) => {
        if (entry.faceCount === 0) {
          findings.push({
            code: 'texture_unassigned',
            message: `Texture "${entry.name}" is not assigned to any cube faces.`,
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
                message: `Face UV for "${cube.name}" (${face.face}) is outside ${width}x${height}: [${x1},${y1},${x2},${y2}].`,
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
          message: `Texture "${overlap.textureName}" has overlapping UV rects (${overlap.conflictCount} conflict${overlap.conflictCount === 1 ? '' : 's'}).` +
            example,
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
            message: `Texture "${issue.textureName}" has UV scale mismatches (${issue.mismatchCount}).${example}`,
            severity: 'error'
          });
        });
        if (scaleResult.mismatchedFaces > 0) {
          findings.push({
            code: 'uv_scale_mismatch_summary',
            message: `UV scale mismatches detected (${scaleResult.mismatchedFaces}/${scaleResult.totalFaces} faces).`,
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
