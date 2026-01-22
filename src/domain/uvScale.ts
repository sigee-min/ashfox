import { CubeFaceDirection, TextureUsageResult } from '../ports/editor';
import { TrackedCube } from '../session';
import { UvPolicyConfig, computeExpectedUvSize, getFaceDimensions } from './uvPolicy';

export type UvScaleIssue = {
  textureId?: string;
  textureName: string;
  mismatchCount: number;
  example?: {
    cubeName: string;
    face: CubeFaceDirection;
    actual: { width: number; height: number };
    expected: { width: number; height: number };
    uv: [number, number, number, number];
  };
};

export type UvScaleResult = {
  issues: UvScaleIssue[];
  totalFaces: number;
  mismatchedFaces: number;
};

export const findUvScaleIssues = (
  usage: TextureUsageResult,
  cubes: TrackedCube[],
  resolution: { width: number; height: number } | undefined,
  policy: UvPolicyConfig
): UvScaleResult => {
  if (!resolution) return { issues: [], totalFaces: 0, mismatchedFaces: 0 };
  const cubeById = new Map<string, TrackedCube>();
  const cubeByName = new Map<string, TrackedCube>();
  cubes.forEach((cube) => {
    if (cube.id) cubeById.set(cube.id, cube);
    cubeByName.set(cube.name, cube);
  });
  const issues: UvScaleIssue[] = [];
  let totalFaces = 0;
  let mismatchedFaces = 0;
  usage.textures.forEach((entry) => {
    let mismatchCount = 0;
    let example: UvScaleIssue['example'] | undefined;
    entry.cubes.forEach((cube) => {
      const resolved = cube.id ? cubeById.get(cube.id) : undefined;
      const target = resolved ?? cubeByName.get(cube.name);
      if (!target) return;
      cube.faces.forEach((face) => {
        const uv = face.uv;
        if (!uv) return;
        totalFaces += 1;
        const expected = computeExpectedUvSize(getFaceDimensions(target, face.face), resolution, policy);
        if (!expected) return;
        const actualWidth = Math.abs(uv[2] - uv[0]);
        const actualHeight = Math.abs(uv[3] - uv[1]);
        if (!isScaleMismatch(actualWidth, actualHeight, expected, policy)) return;
        mismatchCount += 1;
        mismatchedFaces += 1;
        if (!example) {
          example = {
            cubeName: cube.name,
            face: face.face,
            actual: { width: actualWidth, height: actualHeight },
            expected,
            uv
          };
        }
      });
    });
    if (mismatchCount > 0) {
      issues.push({
        textureId: entry.id ?? undefined,
        textureName: entry.name,
        mismatchCount,
        ...(example ? { example } : {})
      });
    }
  });
  return { issues, totalFaces, mismatchedFaces };
};

const isScaleMismatch = (
  actualWidth: number,
  actualHeight: number,
  expected: { width: number; height: number },
  policy: UvPolicyConfig
) => {
  if (actualWidth <= policy.tinyThreshold || actualHeight <= policy.tinyThreshold) return true;
  if (expected.width <= 0 || expected.height <= 0) return false;
  const widthRatio = actualWidth / expected.width;
  const heightRatio = actualHeight / expected.height;
  const widthMismatch = Math.abs(1 - widthRatio) > policy.scaleTolerance;
  const heightMismatch = Math.abs(1 - heightRatio) > policy.scaleTolerance;
  return widthMismatch || heightMismatch;
};
