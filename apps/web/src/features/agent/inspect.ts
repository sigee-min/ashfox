import type {
  AssetProject,
  CommandReceipt,
  ValidationReport
} from '@ashfox/engine-core';

import type {
  ProjectAssets
} from '../../application/projectAssets';
import {
  inspectCommand
} from './inspect/inspectCommand';
import {
  inspectFinding
} from './inspect/inspectFinding';
import {
  inspectExportTarget
} from './inspect/inspectExportTarget';
import {
  inspectOverview
} from './inspect/inspectOverview';
import {
  inspectWorkspace
} from './inspect/inspectWorkspace';
import type {
  VisualReviewReceipt
} from '../../application/review';
import type {
  InspectRequest,
  InspectResult
} from './types';
import { inspectMeasurement } from './inspect/inspectMeasurement';

export const inspectProject = (
  project: AssetProject,
  selectedNodeId: string | null,
  report: ValidationReport,
  request?: InspectRequest,
  _activity: readonly CommandReceipt[] = [],
  _assets: ProjectAssets = {},
  visualReviews: readonly VisualReviewReceipt[] = [],
  operationOwner: string | null = null
): InspectResult => {
  const document = project.document;
  if (!request) {
    return inspectOverview(
      project,
      selectedNodeId,
      report,
      visualReviews,
      operationOwner
    );
  }

  switch (request.kind) {
    case 'measurement':
    case 'surface':
    case 'nodes':
      return inspectMeasurement(project, request);
    case 'command':
      return inspectCommand(document, request.name);
    case 'finding':
      return inspectFinding(document, report, request.path);
    case 'export-target':
      return inspectExportTarget(project, request.adapter);
    case 'workspace':
      return inspectWorkspace(project, request);
    default:
      return {
        ok: false,
        revision: project.revision,
        error: {
          code: 'invalid_request',
          path: 'kind',
          expected: 'command, finding, export-target, workspace, measurement, surface, or nodes'
        }
      };
  }
};
