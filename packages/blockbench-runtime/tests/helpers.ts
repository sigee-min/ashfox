import type { Logger } from '../src/logging';
import type { Limits, ToolError } from '@ashfox/blockbench-contracts/types/internal';
import { DEFAULT_UV_POLICY } from '../src/domain/uv/policy';

export type UsecaseResult<T> = { ok: true; value: T } | { ok: false; error: ToolError };

export const ok = <T>(value: T): UsecaseResult<T> => ({ ok: true, value });

export const DEFAULT_LIMITS: Limits = {
  maxCubes: 2048,
  maxTextureSize: 256,
  maxAnimationSeconds: 120,
};

export const noopLog: Logger = {
  log: () => undefined,
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

export const registerAsync = (promise: Promise<unknown>) => {
  const g = globalThis as { __ashfox_test_promises?: Promise<unknown>[] };
  if (!Array.isArray(g.__ashfox_test_promises)) g.__ashfox_test_promises = [];
  g.__ashfox_test_promises.push(promise);
};

export const unsafePayload = <T>(value: unknown): T => value as T;
