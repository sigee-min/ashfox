import type { Dispatcher, ProjectState, ProjectStateDetail, ToolError, ToolResponse, ToolPayloadMap } from '../types';
import type { ToolName, ProxyTool } from '../shared/toolConstants';
import { PROXY_TOOL_NAMES, TOOL_NAMES } from '../shared/toolConstants';
import { err } from '../shared/tooling/toolResponse';

export type TraceOp = ToolName | ProxyTool;

export type TraceRoute = 'tool' | 'proxy';

export type TraceCapture = {
  detail?: ProjectStateDetail;
  includeUsage?: boolean;
};

export type TraceStep = {
  op: TraceOp;
  payload?: unknown;
  route?: TraceRoute;
  captureState?: boolean | TraceCapture;
};

export type TraceCaptureResult =
  | { ok: true; state: ProjectState }
  | { ok: false; error: ToolError };

export type TraceStepResult = {
  op: TraceOp;
  response: ToolResponse<unknown>;
  capture?: TraceCaptureResult;
};

export type TraceRunResult = {
  ok: boolean;
  steps: TraceStepResult[];
  error?: ToolError;
};

export type TraceRunnerOptions = {
  stopOnError?: boolean;
  defaultCaptureState?: boolean | TraceCapture;
};

export type TraceProxyRunner = {
  handle: (tool: ProxyTool, payload: unknown) => Promise<ToolResponse<unknown>>;
};

type TraceRunnerDeps = {
  dispatcher: Dispatcher;
  proxy: TraceProxyRunner;
};

const isToolName = (op: string): op is ToolName => (TOOL_NAMES as readonly string[]).includes(op);

const isProxyTool = (op: string): op is ProxyTool => (PROXY_TOOL_NAMES as readonly string[]).includes(op);

const resolveRoute = (op: TraceOp, route?: TraceRoute): TraceRoute | null => {
  if (route === 'tool' || route === 'proxy') return route;
  if (isToolName(op)) return 'tool';
  if (isProxyTool(op)) return 'proxy';
  return null;
};

const resolveCapturePayload = (
  captureState?: boolean | TraceCapture,
  fallback?: boolean | TraceCapture
): ToolPayloadMap['get_project_state'] | null => {
  const capture = captureState ?? fallback;
  if (!capture) return null;
  if (capture === true) return { detail: 'summary' };
  return {
    detail: capture.detail ?? 'summary',
    ...(capture.includeUsage !== undefined ? { includeUsage: capture.includeUsage } : {})
  };
};

const runTool = (
  deps: TraceRunnerDeps,
  op: ToolName,
  payload?: unknown
): ToolResponse<unknown> => {
  const toolPayload = (payload ?? {}) as ToolPayloadMap[ToolName];
  return deps.dispatcher.handle(op, toolPayload);
};

const runProxy = async (
  deps: TraceRunnerDeps,
  op: ProxyTool,
  payload?: unknown
): Promise<ToolResponse<unknown>> => deps.proxy.handle(op, payload ?? {});

const captureState = (
  deps: TraceRunnerDeps,
  payload: ToolPayloadMap['get_project_state']
): TraceCaptureResult => {
  const res = deps.dispatcher.handle('get_project_state', payload);
  if (res.ok) return { ok: true, state: res.data.project };
  return { ok: false, error: res.error };
};

const getResponseError = (response: ToolResponse<unknown>): ToolError | undefined =>
  response.ok ? undefined : response.error;

export const runTrace = async (
  deps: TraceRunnerDeps,
  steps: TraceStep[],
  options: TraceRunnerOptions = {}
): Promise<TraceRunResult> => {
  const results: TraceStepResult[] = [];
  const stopOnError = options.stopOnError !== false;

  for (const step of steps) {
    const route = resolveRoute(step.op, step.route);
    let response: ToolResponse<unknown>;
    if (!route) {
      response = err('invalid_payload', `Unknown trace op: ${String(step.op)}`, {
        reason: 'unknown_op',
        op: String(step.op)
      });
    } else if (route === 'tool') {
      response = runTool(deps, step.op as ToolName, step.payload);
    } else {
      response = await runProxy(deps, step.op as ProxyTool, step.payload);
    }

    const capturePayload = resolveCapturePayload(step.captureState, options.defaultCaptureState);
    const capture = capturePayload ? captureState(deps, capturePayload) : undefined;
    const stepResult: TraceStepResult = { op: step.op, response, ...(capture ? { capture } : {}) };
    results.push(stepResult);

    if (stopOnError && !response.ok) {
      return { ok: false, steps: results, error: response.error };
    }
  }

  const errorStep = results.find((item) => !item.response.ok);
  const error = errorStep ? getResponseError(errorStep.response) : undefined;
  return {
    ok: !errorStep,
    steps: results,
    ...(error ? { error } : {})
  };
};




