import { compareText } from '../../stableOrder';
import type { ExportFormatProfile } from '../adapter/contract';
import {
  adaptProjectForExport,
  canonicalProjectFromExportAdapter,
  type ExportAdaptedDocument,
  type ExportAdapterInput,
} from '../adapter';
import { validateProjectDocument } from '../../validation';
import { validateFormatProfile } from '../targetCheck/validate';
import { createValidationContext } from '../../validation/context';
import type { InvariantFinding, ValidationReport } from '../../validation/contract';
import type { AssetProject } from '../../project/asset';
import { ProjectExportError } from '../contract';
import type { ExportPreset } from '../compatibility';
import { exportPresetForProfile } from '../compatibility/target';
import { snapshotExportTargetDocument } from './profileSnapshot';
import { snapshotAssetProject } from './projectSnapshot';

export interface ExportTargetValidation {
  profileId: ExportFormatProfile['id'];
  errorMessage: string;
}

export interface ValidatedExportTarget<TProfileId extends ExportFormatProfile['id']> {
  document: ExportAdaptedDocument;
  profile: Extract<ExportFormatProfile, { id: TProfileId }>;
  findings: readonly InvariantFinding[];
}

/**
 * Validate one delivery target without compiling or materializing artifact
 * bytes. The returned report is a read-only preflight for application
 * inspection; exporters still perform their own sealed validation before
 * emitting a bundle.
 */
const validateAdaptedExportTarget = (adapted: ExportAdaptedDocument): ValidationReport => {
  const snapshot = snapshotExportTargetDocument(
    adapted,
    'Export target preflight could not snapshot the target contract.',
  );
  const canonicalReport = validateProjectDocument(canonicalProjectFromExportAdapter(snapshot));
  const adapterContext = createValidationContext();
  validateFormatProfile(snapshot, adapterContext.add);
  const findings = [...canonicalReport.findings, ...adapterContext.findings].sort(
    (left, right) => compareText(left.path, right.path) || compareText(left.code, right.code),
  );
  return {
    valid: !findings.some((finding) => finding.severity === 'error'),
    findings,
  };
};

/** Preflight one immutable asset project for a delivery target. */
export function validateAssetProjectExportTarget(
  project: AssetProject,
  adapter: ExportAdapterInput,
): ValidationReport {
  if (arguments.length !== 2)
    throw new TypeError(
      'validateAssetProjectExportTarget expects an AssetProject and adapter input.',
    );
  const snapshot = snapshotAssetProject(project);
  const adapted = adaptProjectForExport(snapshot.document, adapter);
  return validateAdaptedExportTarget(adapted);
}

const validatedTargetPreset = new WeakMap<object, ExportPreset>();

const validationTargetData = (value: ExportTargetValidation): ExportTargetValidation => {
  if (
    typeof value !== 'object' ||
    value === null ||
    Object.getPrototypeOf(value) !== Object.prototype
  )
    throw new TypeError('Export validation target must be one exact plain data object.');
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== 2 ||
    keys.some((key) => typeof key !== 'string') ||
    !keys.includes('profileId') ||
    !keys.includes('errorMessage')
  ) {
    throw new TypeError('Export validation target must contain exactly two current fields.');
  }
  const profileId = Object.getOwnPropertyDescriptor(value, 'profileId');
  const errorMessage = Object.getOwnPropertyDescriptor(value, 'errorMessage');
  if (
    profileId === undefined ||
    !profileId.enumerable ||
    !('value' in profileId) ||
    errorMessage === undefined ||
    !errorMessage.enumerable ||
    !('value' in errorMessage) ||
    typeof errorMessage.value !== 'string'
  )
    throw new TypeError('Export validation target must contain own enumerable data fields.');
  return Object.freeze({
    profileId: profileId.value as ExportFormatProfile['id'],
    errorMessage: errorMessage.value,
  });
};

export const assertValidatedExportTargetDocument = (
  document: ExportAdaptedDocument,
  expected: ExportPreset | readonly ExportPreset[],
): void => {
  const actual = validatedTargetPreset.get(document);
  const allowed = Array.isArray(expected) ? expected : [expected];
  if (actual === undefined || !allowed.includes(actual))
    throw new TypeError('Target builder requires its exact sealed validated export document.');
};

export const validateExportTarget = <TProfileId extends ExportFormatProfile['id']>(
  document: ExportAdaptedDocument,
  target: ExportTargetValidation & { profileId: TProfileId },
): ValidatedExportTarget<TProfileId> => {
  const requested = validationTargetData(target);
  const report = validateAdaptedExportTarget(document);
  const snapshot = snapshotExportTargetDocument(document, requested.errorMessage);
  const findings = report.findings;
  const valid = !findings.some((finding) => finding.severity === 'error');
  const preset = exportPresetForProfile(snapshot.formatProfile);
  if (!valid || snapshot.formatProfile.id !== requested.profileId || preset === null) {
    throw new ProjectExportError(requested.errorMessage, findings);
  }
  validatedTargetPreset.set(snapshot, preset);
  return {
    document: snapshot,
    profile: snapshot.formatProfile as Extract<ExportFormatProfile, { id: TProfileId }>,
    findings,
  };
};
