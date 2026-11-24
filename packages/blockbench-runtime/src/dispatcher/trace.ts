import type { Logger } from '../logging';
import type {
  ToolName,
  ToolPayloadMap,
  ToolResponse,
} from '@ashfox/blockbench-contracts/types/internal';
import { errorMessage } from '../logging';
import type { TraceRecorder } from '../trace/recorder';

export const recordTrace = <T>(
  traceRecorder: TraceRecorder | undefined,
  log: Logger,
  tool: ToolName,
  payload: ToolPayloadMap[ToolName],
  response: ToolResponse<T>,
): void => {
  if (!traceRecorder) return;
  try {
    const error = traceRecorder.record(tool, payload, response as ToolResponse<unknown>);
    if (error) {
      log.warn('trace log record failed', {
        tool,
        code: error.code,
        message: error.message,
      });
    }
  } catch (err) {
    const message = errorMessage(err, 'trace log record failed');
    log.warn('trace log record failed', { tool, message });
  }
};
