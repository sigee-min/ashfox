import type { ToolError, ToolErrorResponse } from '../types';
import type { ToolService } from '../usecases/ToolService';
import type { MetaOptions } from './meta';
import { withErrorMeta } from './meta';

export const usecaseError = (
  result: { ok: false; error: ToolError },
  meta: MetaOptions,
  service: ToolService
): ToolErrorResponse => withErrorMeta(result.error, meta, service);

export const errorWithMeta = (error: ToolError, meta: MetaOptions, service: ToolService): ToolErrorResponse =>
  withErrorMeta(error, meta, service);
