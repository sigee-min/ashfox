import type { ToolResponse } from '../../../types';
import { isResponseError } from '../../../shared/tooling/responseGuards';

export const runPipelineBatch = <TEntry, TResult>(
  entries: TEntry[],
  runner: (entry: TEntry) => ToolResponse<TResult>
): ToolResponse<TResult[]> => {
  const results: TResult[] = [];
  for (const entry of entries) {
    const res = runner(entry);
    if (isResponseError(res)) return res;
    results.push(res.data);
  }
  return { ok: true, data: results };
};

