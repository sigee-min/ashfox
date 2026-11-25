import { runJob, BuildFailure, readSingleSnapshot } from '@ashfox/asset-build';
import type { Prepared, SourceInput } from './contract';
import { resolveInputFile, sealObservation } from './prepare';
export const prepareWorker = async (
  file: string,
  input: SourceInput,
  signal: AbortSignal,
): Promise<Prepared> => {
  if (signal.aborted) throw new BuildFailure('observe.cancelled', 'Cancelled', 130);
  const sealed = sealObservation(input);
  const result = await runJob<Prepared>(file, { observe: sealed }, signal);
  if (signal.aborted) throw new BuildFailure('observe.cancelled', 'Cancelled', 130);
  if (input.file && readSingleSnapshot(resolveInputFile(input.file)).hash !== sealed.hash)
    throw new BuildFailure('observe.stale', 'Source changed during compilation', 2);
  return result;
};
