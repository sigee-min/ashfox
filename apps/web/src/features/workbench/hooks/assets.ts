import type {
  AssetProject,
  ValidationReport
} from '@ashfox/engine-core';

import type {
  VisualReviewReceipt
} from '../../../application/review';
import type {
  StorageStatus
} from '../persistence/project';
import {
  presentCreationStatus,
  type CreationStatusViewModel
} from '../presentation/status';
import {
  presentExportAvailability,
  type ExportAvailabilityViewModel
} from '../exportAvailability';

interface UseAgentAssetPresentationInput {
  readonly project: AssetProject;
  readonly report: ValidationReport;
  readonly visualReviews: readonly VisualReviewReceipt[];
  readonly storageStatus: StorageStatus;
}

export interface AgentAssetPresentationController {
  readonly status: CreationStatusViewModel;
  readonly exportAvailability: ExportAvailabilityViewModel;
}

export const useAgentAssetPresentation = ({
  project,
  report,
  visualReviews,
  storageStatus
}: UseAgentAssetPresentationInput): AgentAssetPresentationController => {
  return {
    status: presentCreationStatus(
      project,
      report,
      visualReviews,
      storageStatus
    ),
    exportAvailability: presentExportAvailability(
      project,
      report,
      visualReviews
    )
  };
};
