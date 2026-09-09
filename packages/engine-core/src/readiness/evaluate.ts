import type { ProjectDocument } from '../model';
import {
  validateProjectDocument,
  type InvariantFinding,
  type ValidationReport
} from '../validation';
import { evaluateAnimationReadiness } from './animation';
import { evaluateGeometryReadiness } from './geometry';
import type {
  ProductionReadinessReport
} from './contract';

const structuralBlockers = (
  report: ValidationReport
): readonly InvariantFinding[] =>
  report.findings.filter(
    (finding) =>
      finding.severity === 'error' || finding.severity === 'warning'
  );

const severityCount = (
  report: ValidationReport,
  severity: InvariantFinding['severity']
): number =>
  report.findings.filter(
    (finding) => finding.severity === severity
  ).length;

export const evaluateProductionReadiness = (
  document: ProjectDocument,
  validationReport: ValidationReport = validateProjectDocument(document),
  options: Readonly<{ requireIdle: boolean }> = { requireIdle: true }
): ProductionReadinessReport => {
  const geometry = evaluateGeometryReadiness(document);
  const animation = evaluateAnimationReadiness(
    document,
    geometry.visibleNodeIds,
    options.requireIdle
  );
  const findings = [
    ...geometry.findings,
    ...animation.findings
  ];
  const blockers = structuralBlockers(validationReport);
  return {
    structurallyValid: validationReport.valid,
    mechanicallyReady:
      validationReport.valid &&
      blockers.length === 0 &&
      findings.length === 0,
    counts: {
      structuralErrors: severityCount(validationReport, 'error'),
      structuralWarnings: severityCount(validationReport, 'warning'),
      ...geometry.counts,
      ...animation.counts
    },
    findings,
    firstBlockingFinding:
      blockers.find((finding) => finding.severity === 'error') ??
      findings[0] ??
      blockers[0] ??
      null
  };
};
