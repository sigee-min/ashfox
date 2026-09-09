'use client';

import {
  useCallback,
  type DragEvent
} from 'react';

import type {
  ExportAdapterInput,
  AssetProject
} from '@ashfox/engine-core';

import type {
  OperationLease,
  OperationLeaseToken
} from '../../application/operationLease';
import {
  createTargetArtifact,
  type TargetArtifactFile
} from './browserFileWorkflow';
import {
  createWorkspaceArtifact,
  parseWorkspaceFile
} from './workspace';
import {
  isArtifactCurrent,
  type ArtifactFile
} from './artifactFile';
import type { FileOperationState } from './fileOperationState';
import type { ProjectAssets } from '@ashfox/render-core/assets';
import {
  useFileOperation,
  type FileOperationRunResult
} from './useFileOperation';
import { createBuildGif } from '../capture/createBuildGif';
import {
  isGifCaptureFile,
  type GifCaptureFile
} from '../capture/gifCaptureFile';
import type { GifCaptureRequest } from '../capture/gifCaptureRequest';
import type {
  CaptureArtifactRequest
} from './capture';

interface UseProjectFileActionsInput {
  project: AssetProject;
  assets: ProjectAssets;
  onLoad: (project: AssetProject) => void;
  operationLease: OperationLease;
}

interface ProjectFileActions {
  operation: FileOperationState<ArtifactFile>;
  artifactFile: ArtifactFile | null;
  captureFile: GifCaptureFile | null;
  open: (file: File) => void;
  drop: (event: DragEvent<HTMLElement>) => void;
  save: () => void;
  exportTarget: (
    adapter: ExportAdapterInput,
    lease?: OperationLeaseToken
  ) => Promise<FileOperationRunResult<TargetArtifactFile>>;
  capture: (
    request: CaptureArtifactRequest,
    lease?: OperationLeaseToken
  ) => Promise<FileOperationRunResult<ArtifactFile>>;
  captureGif: (request: GifCaptureRequest) => void;
  cancel: () => void;
}

const adaptationNotice = (
  artifact: TargetArtifactFile
): string => {
  if (artifact.adaptationCount === 0) return '';
  const converted = artifact.adaptations.converted.length;
  const omitted = artifact.adaptations.omitted.length;
  return [
    converted === 0 ? null : `${converted} converted`,
    omitted === 0 ? null : `${omitted} omitted`
  ].filter((part): part is string => part !== null).join(' · ');
};

export const useProjectFileActions = ({
  project,
  assets,
  onLoad,
  operationLease
}: UseProjectFileActionsInput): ProjectFileActions => {
  const {
    state: operation,
    run,
    cancel
  } = useFileOperation<ArtifactFile>(operationLease);

  const open = useCallback((file: File): void => {
    let openedProject: AssetProject | null = null;
    void run({
      kind: 'open',
      pendingMessage: 'Reading workspace',
      execute: async () => {
        openedProject = await parseWorkspaceFile(file, project.entry);
        return openedProject;
      },
      complete: (opened) => {
        return {
          phase: 'succeeded',
          message: `Opened ${opened.document.name}`
        };
      },
      failureMessage: 'Workspace open failed'
    }).then((result) => {
      if (result.ok && openedProject !== null) onLoad(openedProject);
    });
  }, [onLoad, project.entry, run]);

  const drop = useCallback((event: DragEvent<HTMLElement>): void => {
    event.preventDefault();
    const file = event.dataTransfer.files[0];
    if (!file) return;
    let openedProject: AssetProject | null = null;
    void run({
      kind: 'drop',
      pendingMessage: 'Reading dropped workspace',
      execute: async () => {
        openedProject = await parseWorkspaceFile(file, project.entry);
        return openedProject;
      },
      complete: (opened) => {
        return {
          phase: 'succeeded',
          message: `Opened ${opened.document.name}`
        };
      },
      failureMessage: 'Dropped workspace failed'
    }).then((result) => {
      if (result.ok && openedProject !== null) onLoad(openedProject);
    });
  }, [onLoad, project.entry, run]);

  const save = useCallback((): void => {
    void run({
      kind: 'save',
      pendingMessage: 'Preparing workspace',
      execute: () => createWorkspaceArtifact(project),
      complete: (artifact) => ({
        phase: 'succeeded',
        message: `Ready · ${artifact.name}`,
        result: artifact
      }),
      failureMessage: 'Workspace download failed'
    });
  }, [project, run]);

  const exportTarget = useCallback((
    adapter: ExportAdapterInput,
    lease?: OperationLeaseToken
  ) => {
    return run<TargetArtifactFile, TargetArtifactFile>({
      kind: 'export',
      pendingMessage: `Building ${adapter.target} export`,
      execute: () => createTargetArtifact(project, assets, adapter),
      complete: (artifact) => {
        const adaptations = adaptationNotice(artifact);
        return {
          phase: 'succeeded',
          message:
            `Ready · ${artifact.name} · ${artifact.sourceFileCount} file${artifact.sourceFileCount === 1 ? '' : 's'}` +
            (adaptations.length === 0 ? '' : ` · ${adaptations}`),
          result: artifact
        };
      },
      failureMessage: 'Target export failed'
    }, lease);
  }, [assets, project, run]);

  const capture = useCallback(
    (
      request: CaptureArtifactRequest,
      lease?: OperationLeaseToken
    ): Promise<FileOperationRunResult<ArtifactFile>> =>
      run<ArtifactFile>({
        kind: 'capture',
        pendingMessage: 'Preparing build replay GIF',
        execute: ({ signal, reportProgress }) =>
          createBuildGif(project, assets, request, {
            signal,
            onProgress: (completed, total) => {
              reportProgress(`Captured ${completed}/${total} frames`);
            }
          }),
        complete: (capture) => ({
          phase: 'succeeded',
          message: 'Build replay ready',
          result: capture
        }),
        failureMessage: 'Build replay failed',
        cancelledMessage: 'Capture cancelled'
      }, lease),
    [assets, project, run]
  );

  const captureGif = useCallback(
    (request: GifCaptureRequest): void => {
      void capture(request);
    },
    [capture]
  );

  const artifactFile =
    operation.phase === 'succeeded' &&
    operation.result !== null &&
    isArtifactCurrent(project, operation.result)
      ? operation.result
      : null;

  return {
    operation,
    artifactFile,
    captureFile:
      operation.kind === 'capture' &&
      isGifCaptureFile(artifactFile)
        ? artifactFile
        : null,
    open,
    drop,
    save,
    exportTarget,
    capture,
    captureGif,
    cancel
  };
};
