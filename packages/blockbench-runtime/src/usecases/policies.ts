import type { FormatOverrides } from '../domain/formats';

export type SnapshotPolicy = 'session' | 'live' | 'hybrid';

export interface ToolPolicies {
  formatOverrides?: FormatOverrides;
  snapshotPolicy?: SnapshotPolicy;
  autoDiscardUnsaved?: boolean;
  autoAttachActiveProject?: boolean;
  autoIncludeState?: boolean;
  autoIncludeDiff?: boolean;
  requireRevision?: boolean;
  autoRetryRevision?: boolean;
  autoCreateProjectTexture?: boolean;
  animationTimePolicy?: {
    timeEpsilon?: number;
    triggerDedupeByValue?: boolean;
  };
  uvPolicy?: {
    modelUnitsPerBlock?: number;
    pixelsPerBlock?: number;
    scaleTolerance?: number;
    tinyThreshold?: number;
    autoMaxResolution?: number;
    autoMaxRetries?: number;
  };
}
