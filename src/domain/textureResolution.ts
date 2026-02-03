export type SquareResolution = {
  width: number;
  height: number;
  size: number;
  isSquare: boolean;
};

export const parseSquareResolution = (
  resolution?: { width?: number; height?: number }
): SquareResolution | null => {
  if (!resolution) return null;
  const width = Number(resolution.width ?? resolution.height);
  const height = Number(resolution.height ?? resolution.width);
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
  if (width <= 0 || height <= 0) return null;
  const size = Math.max(Math.trunc(width), Math.trunc(height));
  if (!Number.isFinite(size) || size <= 0) return null;
  return {
    width,
    height,
    size,
    isSquare: width === height
  };
};
