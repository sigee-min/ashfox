import { canonicalJsonString } from './canonicalJson';
import { sha256Digest } from './provenance/digest';

/** Canonical exact-corner digest across bigint proof, numeric scene, and
 * validation boundaries. Denominators are always serialized as integers. */
export const exactCornerDigest = (
  denominator: bigint | number | string,
  numerators: readonly (readonly string[])[],
): string =>
  sha256Digest(
    canonicalJsonString({
      denominator: denominator.toString(),
      numerators,
    }),
  );
