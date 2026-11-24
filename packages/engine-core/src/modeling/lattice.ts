import { isSurfacePixelDensity } from '../model';
import type { SurfacePixelDensity } from '../model';

export const assertDensity: (density: number) => asserts density is SurfacePixelDensity = (
  density,
) => {
  if (!isSurfacePixelDensity(density)) {
    throw new RangeError('surface pixel density must be 1, 2, 4, or 8');
  }
};

export const assertLatticeInteger = (value: number, field: string): void => {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${field} must be a safe lattice integer`);
  }
};

export const worldToLattice = (
  coordinate: number,
  density: SurfacePixelDensity,
  epsilon = 1e-9,
): number => {
  assertDensity(density);
  if (!Number.isFinite(coordinate)) {
    throw new RangeError('world coordinate must be finite');
  }
  const scaled = coordinate * density;
  const rounded = Math.round(scaled);
  if (Math.abs(scaled - rounded) > epsilon) {
    throw new RangeError(`world coordinate ${coordinate} is not aligned to density ${density}`);
  }
  assertLatticeInteger(rounded, 'scaled coordinate');
  return rounded;
};
