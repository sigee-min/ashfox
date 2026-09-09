import { exportCompatibilityFor } from '../compatibility/queries';
import type { AssetProject } from '../../project/asset';
import type { ExportAdapterInput } from '../adapter';
import {
  evaluateProductionReadiness,
  type ProductionReadinessReport
} from '../../readiness';
import type { GltfResolvedExportOptions } from '../targets/gltf/exporter';
import type { ExportBundle } from '../contract';
import {
  compileProjectBundle,
  compileProjectBundleResolved
} from './compile';

export class ProductionExportError extends Error {
  readonly code = 'export.production_not_ready' as const;

  constructor(readonly report: ProductionReadinessReport) {
    const finding = report.firstBlockingFinding;
    super(
      finding
        ? `Project is not production ready: ${finding.code} at ${finding.path}.`
        : 'Project is not production ready.'
    );
    this.name = 'ProductionExportError';
  }
}

const assertProductionReady = (project: AssetProject, adapter: ExportAdapterInput): void => {
  const report = evaluateProductionReadiness(project.document, undefined, {
    requireIdle: exportCompatibilityFor(adapter.target)?.animationSupport === 'actor'
  });
  if (!report.mechanicallyReady) {
    throw new ProductionExportError(report);
  }
};

export const exportProductionProject = (
  project: AssetProject,
  adapter: ExportAdapterInput
): ExportBundle => {
  assertProductionReady(project, adapter);
  return compileProjectBundle(project, adapter);
};

export const exportProductionProjectResolved = async (
  project: AssetProject,
  adapter: ExportAdapterInput,
  options: GltfResolvedExportOptions
): Promise<ExportBundle> => {
  assertProductionReady(project, adapter);
  return compileProjectBundleResolved(project, adapter, options);
};
