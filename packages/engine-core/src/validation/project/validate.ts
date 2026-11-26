import { compareText } from '../../stableOrder';
import { validateAnimations } from '../animation/validate';
import { createValidationContext } from '../context';
import { validateProjectDocumentContract } from '../document/contract';
import { validateSceneOcclusion } from '../scene/occlusion';
import { validateScene } from '../scene/validate';
import { validateTextures } from '../texture/validate';
import { validateDocument } from './authority';
import type { ValidationReport } from '../contract';

const sortedByPathAndCode = (
  findings: ValidationReport['findings'],
): ValidationReport['findings'] =>
  [...findings].sort(
    (left, right) => compareText(left.path, right.path) || compareText(left.code, right.code),
  );

const validateProjectDocumentWithCandidate = (value: unknown): ValidationReport => {
  const context = createValidationContext();
  if (validateProjectDocumentContract(value, context.add)) {
    validateDocument(value, context.add);
    validateScene(value, context.add, context.registerId);
    validateSceneOcclusion(value, context.add);
    validateTextures(value, context.add, context.registerId);
    validateAnimations(value, context.add, context.registerId);
  }

  const findings = sortedByPathAndCode(context.findings);
  return {
    valid: !findings.some((finding) => finding.severity === 'error'),
    findings,
  };
};

/** Validate one derived canonical document without consulting workspace source. */
export const validateProjectDocument = (value: unknown): ValidationReport =>
  validateProjectDocumentWithCandidate(value);
