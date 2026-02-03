import type { Cube, CubeFaceDirection } from '../model';

export type UvPolicyConfig = {
  modelUnitsPerBlock: number;
  scaleTolerance: number;
  tinyThreshold: number;
};

export const DEFAULT_UV_POLICY: UvPolicyConfig = {
  modelUnitsPerBlock: 16,
  scaleTolerance: 0.1,
  tinyThreshold: 2
};

type FaceDimensions = {
  width: number;
  height: number;
};

const abs = (value: number) => Math.abs(value);

export const getFaceDimensions = (cube: Cube, face: CubeFaceDirection): FaceDimensions => {
  const sizeX = abs(cube.to[0] - cube.from[0]);
  const sizeY = abs(cube.to[1] - cube.from[1]);
  const sizeZ = abs(cube.to[2] - cube.from[2]);
  switch (face) {
    case 'north':
    case 'south':
      return { width: sizeX, height: sizeY };
    case 'east':
    case 'west':
      return { width: sizeZ, height: sizeY };
    case 'up':
    case 'down':
      return { width: sizeX, height: sizeZ };
  }
};

export const computeExpectedUvSize = (
  face: FaceDimensions,
  texture: { width: number; height: number },
  policy: UvPolicyConfig
): { width: number; height: number } | null => {
  if (policy.modelUnitsPerBlock <= 0) return null;
  if (texture.width <= 0 || texture.height <= 0) return null;
  const ppuX = texture.width / policy.modelUnitsPerBlock;
  const ppuY = texture.height / policy.modelUnitsPerBlock;
  const width = Math.round(face.width * ppuX);
  const height = Math.round(face.height * ppuY);
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
  if (width <= 0 || height <= 0) return null;
  if (width > texture.width || height > texture.height) return null;
  return { width, height };
};

export const shouldAutoFixUv = (
  actualUv: [number, number, number, number] | undefined,
  expected: { width: number; height: number },
  policy: UvPolicyConfig
): boolean => {
  if (!actualUv) return true;
  const [x1, y1, x2, y2] = actualUv;
  const actualWidth = abs(x2 - x1);
  const actualHeight = abs(y2 - y1);
  if (actualWidth <= policy.tinyThreshold || actualHeight <= policy.tinyThreshold) return true;
  if (expected.width <= 0 || expected.height <= 0) return false;
  const widthRatio = actualWidth / expected.width;
  const heightRatio = actualHeight / expected.height;
  const widthMismatch = Math.abs(1 - widthRatio) > policy.scaleTolerance;
  const heightMismatch = Math.abs(1 - heightRatio) > policy.scaleTolerance;
  return widthMismatch || heightMismatch;
};



