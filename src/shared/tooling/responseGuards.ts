import type { ToolError, ToolErrorResponse, ToolResponse } from '../../types';
import type { UsecaseResult } from '../../usecases/result';

export const isUsecaseError = <T>(result: UsecaseResult<T>): result is { ok: false; error: ToolError } =>
  !result.ok;

export const isResponseError = <T>(response: ToolResponse<T>): response is ToolErrorResponse => !response.ok;
