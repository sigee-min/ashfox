import type { CubeNode } from '../../model';
import { exactCornerDigest } from '../../exactGeometry';
import type { FindingSink } from '../contract';
import { EPSILON } from '../shared/value';

type OrientedCube = Extract<CubeNode, { geometryMode: 'oriented-box' }>;

export const validateOrientedCubeAuthority = (
  cube: OrientedCube,
  path: string,
  add: FindingSink,
): void => {
  if (
    cube.transform.rotation.some((value) => Math.abs(value) > EPSILON) ||
    cube.transform.pivot.some((value) => Math.abs(value) > EPSILON)
  )
    add({
      code: 'cube.invalid_bounds',
      severity: 'error',
      message: 'Oriented geometry owns its rotation and pivot; node transform must be zero.',
      path: `${path}.transform`,
      entityIds: [cube.id],
    });
  const exact = cube.orientedBox;
  const serializedCorners = exact.cornerNumerators.map((corner) => corner.join(','));
  const exactCharacterCount = exact.cornerNumerators.reduce(
    (sum, corner) => sum + corner.reduce((inner, entry) => inner + entry.length, 0),
    0,
  );
  const cornerDigest = exactCornerDigest(exact.cornerDenominator, exact.cornerNumerators);
  if (
    !Number.isSafeInteger(exact.cornerDenominator) ||
    exact.cornerDenominator <= 0 ||
    exact.cornerNumerators.length !== 8 ||
    new Set(serializedCorners).size !== 8 ||
    exactCharacterCount > 1024 ||
    exact.cornerNumerators.some(
      (corner) => corner.length !== 3 || corner.some((entry) => !/^-?\d+$/.test(entry)),
    ) ||
    cornerDigest !== exact.cornerDigest
  )
    add({
      code: 'cube.invalid_bounds',
      severity: 'error',
      message: 'Oriented exact corners or their digest are invalid.',
      path: `${path}.orientedBox.cornerDigest`,
      entityIds: [cube.id],
    });
  if (
    cube.inflate !== 0 ||
    cube.mirror ||
    cube.boxUv ||
    cube.transform.scale.some((value) => Math.abs(value - 1) > EPSILON)
  )
    add({
      code: 'cube.invalid_bounds',
      severity: 'error',
      message: 'Oriented compiler geometry forbids inflate, mirror, box UV, and scale.',
      path: `${path}.geometryMode`,
      entityIds: [cube.id],
    });
};
