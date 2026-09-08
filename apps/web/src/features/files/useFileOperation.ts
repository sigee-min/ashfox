'use client';

import {
  useCallback,
  useEffect,
  useReducer,
  useRef
} from 'react';

import type {
  OperationLease,
  OperationLeaseToken
} from '../../application/operationLease';
import {
  fileOperationReducer,
  INITIAL_FILE_OPERATION,
  type FileOperationKind,
  type FileOperationState
} from './fileOperationState';
import { mountFileOperation } from './operationMount';

interface FileOperationCompletion<TResult> {
  phase: 'succeeded' | 'cancelled';
  message: string;
  result?: TResult | null;
}

export interface FileOperationContext {
  signal: AbortSignal;
  reportProgress: (message: string) => void;
}

interface FileOperationSpec<T, TResult> {
  kind: FileOperationKind;
  pendingMessage: string;
  execute: (context: FileOperationContext) => T | Promise<T>;
  complete: (value: T) => FileOperationCompletion<TResult>;
  failureMessage: string;
  cancelledMessage?: string;
}

interface FileOperationController<TResult> {
  state: FileOperationState<TResult>;
  run: <T, TCompletion extends TResult = TResult>(
    spec: FileOperationSpec<T, TCompletion>,
    lease?: OperationLeaseToken
  ) => Promise<FileOperationRunResult<TCompletion>>;
  cancel: () => void;
}

export type FileOperationRunResult<TResult> =
  | {
      ok: true;
      operationId: number;
      result: TResult | null;
    }
  | {
      ok: false;
      operationId: number | null;
      code: 'busy' | 'cancelled' | 'failed';
      message: string;
    };

const errorMessage = (error: unknown, fallback: string): string =>
  error instanceof Error ? error.message : fallback;

export const useFileOperation = <TResult>(
  operationLease: OperationLease
): FileOperationController<TResult> => {
  const [state, dispatch] = useReducer(
    fileOperationReducer<TResult>,
    INITIAL_FILE_OPERATION
  );
  const serialRef = useRef(0);
  const mountedRef = useRef(true);
  const activeRef = useRef<{
    operationId: number;
    controller: AbortController;
    cancelledMessage: string;
  } | null>(null);

  useEffect(() => mountFileOperation(mountedRef, activeRef), []);

  const run = useCallback(
    async <T, TCompletion extends TResult = TResult>(
      spec: FileOperationSpec<T, TCompletion>,
      inheritedLease?: OperationLeaseToken
    ): Promise<FileOperationRunResult<TCompletion>> => {
      if (activeRef.current !== null) {
        return {
          ok: false,
          operationId: activeRef.current.operationId,
          code: 'busy',
          message: 'Another file operation is already running.'
        };
      }
      const ownsLease = inheritedLease === undefined;
      const lease =
        inheritedLease ??
        operationLease.tryAcquire(`file.${spec.kind}`);
      if (!lease || !operationLease.isActive(lease)) {
        return {
          ok: false,
          operationId: null,
          code: 'busy',
          message:
            `Another operation is still running (${operationLease.currentOwner() ?? 'unknown'}).`
        };
      }
      const operationId = serialRef.current + 1;
      serialRef.current = operationId;
      const controller = new AbortController();
      activeRef.current = {
        operationId,
        controller,
        cancelledMessage:
          spec.cancelledMessage ?? 'Operation cancelled'
      };
      dispatch({
        type: 'start',
        operationId,
        kind: spec.kind,
        message: spec.pendingMessage
      });
      try {
        const value = await spec.execute({
          signal: controller.signal,
          reportProgress: (message) => {
            if (mountedRef.current) {
              dispatch({ type: 'progress', operationId, message });
            }
          }
        });
        if (controller.signal.aborted) {
          throw new DOMException(
            'Operation cancelled.',
            'AbortError'
          );
        }
        const completion = spec.complete(value);
        if (mountedRef.current) {
          dispatch({
            type: 'settle',
            operationId,
            phase: completion.phase,
            message: completion.message,
            result: completion.result ?? null
          });
        }
        if (completion.phase === 'cancelled') {
          return {
            ok: false,
            operationId,
            code: 'cancelled',
            message: completion.message
          };
        }
        return {
          ok: true,
          operationId,
          result: completion.result ?? null
        };
      } catch (error: unknown) {
        const cancelled =
          controller.signal.aborted ||
          (error instanceof DOMException && error.name === 'AbortError');
        if (mountedRef.current) {
          dispatch({
            type: 'settle',
            operationId,
            phase: cancelled ? 'cancelled' : 'failed',
            message: cancelled
              ? spec.cancelledMessage ?? 'Operation cancelled'
              : errorMessage(error, spec.failureMessage),
            result: null
          });
        }
        return {
          ok: false,
          operationId,
          code: cancelled ? 'cancelled' : 'failed',
          message: cancelled
            ? spec.cancelledMessage ?? 'Operation cancelled'
            : errorMessage(error, spec.failureMessage)
        };
      } finally {
        if (activeRef.current?.operationId === operationId) {
          activeRef.current = null;
        }
        if (ownsLease) lease.release();
      }
    },
    [operationLease]
  );

  const cancel = useCallback((): void => {
    const active = activeRef.current;
    if (!active) return;
    activeRef.current = null;
    active.controller.abort();
    dispatch({
      type: 'settle',
      operationId: active.operationId,
      phase: 'cancelled',
      message: active.cancelledMessage,
      result: null
    });
  }, []);

  return { state, run, cancel };
};
