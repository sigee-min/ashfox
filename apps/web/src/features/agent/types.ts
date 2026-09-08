import { COMMAND_RECEIPT_SCHEMA_VERSION } from '@ashfox/engine-core';
import type {
  CommandSource,
  ExportAdapterInput,
  InvariantFinding,
  ProjectCommandOperation,
  WorkspaceChangeSet,
  WorkspaceDiagnostic,
  WorkspaceEntrySelector
} from '@ashfox/engine-core';
import {
  VISUAL_REVIEW_CAMERAS,
  VISUAL_REVIEW_ISSUES,
  type VisualReviewCheck,
  type VisualReviewCamera,
  type VisualReviewIssue,
  type VisualReviewObservation
} from '../../application/review';
import type {
  CameraMode
} from '../../rendering/cameraPresets';

export {
  VISUAL_REVIEW_CAMERAS,
  VISUAL_REVIEW_ISSUES
};
export type {
  VisualReviewCheck,
  VisualReviewCamera,
  VisualReviewIssue
};

export interface MeasurementGuard {
  readonly expectedRevision: string;
  readonly expectedWorkspaceHash: string;
  readonly expectedBuildKey: string;
  readonly nodeId: string;
}

export type ParseInspectRequestResult =
  | { readonly ok: true; readonly request?: InspectRequest }
  | { readonly ok: false; readonly error: InspectFailure['error'] };

export type InspectRequest =
  | (Omit<MeasurementGuard, 'nodeId'> & { readonly kind: 'nodes'; readonly offset: number;
      readonly limit: number })
  | (MeasurementGuard & { readonly kind: 'measurement'; readonly scope: 'node' | 'subtree';
      readonly groundY: number; readonly tolerance: number })
  | (MeasurementGuard & { readonly kind: 'surface' })
  | { kind: 'command'; name: string }
  | { kind: 'finding'; path: string }
  | { kind: 'export-target'; adapter: ExportAdapterInput }
  | {
      kind: 'workspace';
      catalog?: { readonly expectedWorkspaceHash: string; readonly offset: number; readonly limit: number };
      document?: { readonly expectedWorkspaceHash: string; readonly document: 'manifest' | 'lock';
        readonly offset: number; readonly maxCodeUnits: number };
      read?: {
        readonly expectedWorkspaceHash: string;
        readonly path: string;
        readonly offset: number;
        readonly maxCodeUnits: number;
      };
      candidate?: {
        readonly entry: WorkspaceEntrySelector;
        readonly changes: WorkspaceChangeSet;
      };
    };

export interface WorkspaceInspectData {
  readonly kind: 'workspace';
  readonly valid: boolean;
  readonly diagnostics: readonly WorkspaceDiagnostic[];
  readonly catalog?: {
    readonly workspaceHash: string;
    readonly files: readonly { readonly path: string; readonly contentHash: string;
      readonly codeUnits: number; readonly packageName: string;
      readonly source: 'workspace' | 'cas'; readonly kind: 'entry' | 'module' }[];
    readonly total: number; readonly offset: number; readonly nextOffset: number | null;
  };
  readonly documentChunk?: { readonly workspaceHash: string; readonly document: 'manifest' | 'lock';
    readonly offset: number; readonly content: string; readonly done: boolean; readonly totalCodeUnits: number };
  readonly sourceChunk?: {
    readonly workspaceHash: string;
    readonly path: string;
    readonly offset: number;
    readonly content: string;
    readonly done: boolean;
    readonly totalCodeUnits: number;
  };
  readonly previewToken?: string | null;
}

export interface InspectSuccess {
  ok: true;
  revision: string;
  data: unknown;
  truncated?: boolean;
}

export interface InspectFailure {
  ok: false;
  revision: string;
  error: {
    code: 'invalid_request' | 'not_found' | 'response_too_large' | 'stale_revision';
    path?: string;
    expected?: string;
  };
}

export type InspectResult = InspectSuccess | InspectFailure;

export interface AgentReceiptEntityIds {
  ids: readonly string[];
  count: number;
  truncated: boolean;
}

export interface AgentCommandReceipt {
  schemaVersion: typeof COMMAND_RECEIPT_SCHEMA_VERSION;
  commandId: string;
  projectId: string;
  actorId: string;
  source: CommandSource;
  summary: string;
  beforeRevision: string;
  revision: string;
  completedAt: string;
  durationMs: number;
  effects: {
    created: AgentReceiptEntityIds;
    changed: AgentReceiptEntityIds;
    removed: AgentReceiptEntityIds;
    invalidated: readonly string[];
  };
  findings: readonly InvariantFinding[];
  findingsTruncated: boolean;
}

export interface RunSuccess {
  ok: true;
  revision: string;
  receipt: AgentCommandReceipt;
}

export interface RunFailure {
  ok: false;
  revision: string;
  error: {
    code: string;
    message?: string;
    path?: string;
    expected?: string;
  };
  findings?: readonly InvariantFinding[];
  findingsTruncated?: boolean;
}

export type RunResult = RunSuccess | RunFailure;

export interface AgentRunRequest {
  readonly requestId: string;
  readonly operations: readonly [ProjectCommandOperation];
}

export type PresentRequest =
  | {
      review: 'next';
    }
  | {
      review: 'preview';
      camera?: VisualReviewCamera;
      previewToken?: string;
    }
  | {
      review: 'accept';
      frameNonce: number;
      checkIds: readonly string[];
    }
  | {
      review: 'reject';
      frameNonce: number;
      issues: readonly VisualReviewIssue[];
      failedCheckIds: readonly string[];
    };

interface ViewPresentationRequestBase {
  mode: 'frame' | 'cycle';
  camera: CameraMode;
  clipId: string | null;
  timeSeconds: number;
  reviewChecks: readonly VisualReviewCheck[];
}

export type ViewPresentationRequest =
  | (ViewPresentationRequestBase & {
      review: 'next';
      purpose: 'delivery';
    })
  | (ViewPresentationRequestBase & {
      review: 'preview';
      purpose: 'preview';
    });

export type VisualReviewDecisionRequest = Extract<
  PresentRequest,
  { review: 'accept' | 'reject' }
>;

export type PresentSuccess = VisualReviewObservation;

export interface PresentFailure {
  ok: false;
  revision: string;
  error: {
    code:
      | 'invalid_request'
      | 'invalid_state'
      | 'not_found'
      | 'preview_unfaithful'
      | 'preview_unavailable'
      | 'render_timeout'
      | 'stale_revision';
    path?: string;
    expected?: string;
  };
}

export type PresentResult = PresentSuccess | PresentFailure;

export type AgentCaptureRequest = { kind: 'build' };

export interface CaptureArtifactMetadata {
  kind: AgentCaptureRequest['kind'];
  name: string;
  contentType: string;
  byteLength: number;
  contentHash: string;
  width?: number;
  height?: number;
  frameCount?: number;
  eventCount?: number;
  fps?: number;
}

export interface CaptureSuccess {
  ok: true;
  revision: string;
  artifact: CaptureArtifactMetadata;
}

export interface CaptureFailure {
  ok: false;
  revision: string;
  error: {
    code:
      | 'invalid_request'
      | 'busy'
      | 'cancelled'
      | 'invalid_state'
      | 'capture_failed'
      | 'stale_revision';
    message?: string;
    path?: string;
    expected?: string;
  };
}

export type CaptureResult = CaptureSuccess | CaptureFailure;

export interface AgentCommandPortApi {
  inspect(request?: InspectRequest): InspectResult;
  run(request: AgentRunRequest): Promise<RunResult>;
  present(request: PresentRequest): Promise<PresentResult>;
  capture(request: AgentCaptureRequest): Promise<CaptureResult>;
}

declare global {
  interface Window {
    ashfox?: AgentCommandPortApi;
  }
}
