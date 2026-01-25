import type { Logger } from '../../logging';
import type { DomPort } from '../../ports/dom';
import type { Limits } from '../../types';
import type { ToolService } from '../../usecases/ToolService';

export type ProxyPipelineDeps = {
  service: ToolService;
  dom: DomPort;
  log: Logger;
  limits: Limits;
  includeStateByDefault: () => boolean;
  includeDiffByDefault: () => boolean;
  runWithoutRevisionGuard: <T>(fn: () => Promise<T> | T) => Promise<T>;
};
