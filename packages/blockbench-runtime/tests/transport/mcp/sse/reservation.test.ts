import assert from 'node:assert/strict';

import { SessionStore } from '../../../../src/transport/mcp/session';
import { handleSseGet } from '../../../../src/transport/mcp/routerHttpHandlers';
import { MCP_MAX_SSE_CONNECTIONS_PER_SESSION } from '../../../../src/transport/limits';
import type { ResponsePlan, SseConnection } from '../../../../src/transport/mcp/types';

const sessions = new SessionStore();
const session = sessions.create('session-1', '2025-06-18');
const context = {
  sessions,
  getSessionFromHeaders: () => session,
  baseHeaders: () => ({}),
  jsonResponse: (status: number, body: unknown): ResponsePlan => ({
    kind: 'json',
    status,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }),
};
const request = {
  method: 'GET',
  url: '/mcp',
  headers: { accept: 'text/event-stream' },
};

const plans = Array.from({ length: 10 }, () => handleSseGet(context, request));
const granted = plans.filter(
  (plan): plan is Extract<ResponsePlan, { kind: 'sse' }> => plan.kind === 'sse',
);
assert.equal(granted.length, MCP_MAX_SSE_CONNECTIONS_PER_SESSION);
assert.equal(
  plans.filter((plan) => plan.kind === 'json' && plan.status === 429).length,
  10 - MCP_MAX_SSE_CONNECTIONS_PER_SESSION,
);
assert.equal(session.sseReservations, MCP_MAX_SSE_CONNECTIONS_PER_SESSION);

const cleanups: Array<() => void> = [];
for (const plan of granted) {
  const connection: SseConnection = {
    send: () => undefined,
    close: () => undefined,
    isClosed: () => false,
  };
  const cleanup = plan.onOpen?.(connection);
  if (typeof cleanup === 'function') cleanups.push(cleanup);
}
assert.equal(session.sseReservations, 0);
assert.equal(session.sseConnections.size, MCP_MAX_SSE_CONNECTIONS_PER_SESSION);

cleanups.pop()?.();
const cancelled = handleSseGet(context, request);
assert.equal(cancelled.kind, 'sse');
assert.equal(session.sseReservations, 1);
if (cancelled.kind === 'sse') cancelled.onCancel?.();
assert.equal(session.sseReservations, 0);

{
  const raceSessions = new SessionStore();
  const raceSession = raceSessions.create('race-session', '2025-06-18');
  const raceContext = {
    ...context,
    sessions: raceSessions,
    getSessionFromHeaders: () => raceSession,
  };
  const racePlan = handleSseGet(raceContext, request);
  assert.equal(racePlan.kind, 'sse');
  assert.equal(raceSession.sseReservations, 1);
  raceSessions.close(raceSession);

  let closeCalls = 0;
  const ghostConnection: SseConnection = {
    send: () => undefined,
    close: () => {
      closeCalls += 1;
    },
    isClosed: () => closeCalls > 0,
  };
  if (racePlan.kind === 'sse') racePlan.onOpen?.(ghostConnection);
  assert.equal(closeCalls, 1);
  assert.equal(raceSession.sseConnections.size, 0);
  assert.equal(raceSession.sseReservations, 0);
  assert.equal(raceSessions.get(raceSession.id), null);
}

{
  const pruneSessions = new SessionStore();
  const pruneSession = pruneSessions.create('prune-session', '2025-06-18');
  const pruneContext = {
    ...context,
    sessions: pruneSessions,
    getSessionFromHeaders: () => pruneSession,
  };
  const prunePlan = handleSseGet(pruneContext, request);
  assert.equal(prunePlan.kind, 'sse');
  if (prunePlan.kind === 'sse') prunePlan.onCancel?.();
  pruneSession.lastSeenAt = 0;
  assert.equal(pruneSessions.pruneStale(1, 10), 1);
  assert.equal(pruneSessions.get(pruneSession.id), null);
}

{
  const globallyBounded = new SessionStore(10, 2, 2);
  const first = globallyBounded.create('global-1', '2025-06-18');
  const second = globallyBounded.create('global-2', '2025-06-18');
  assert.equal(globallyBounded.reserveSse(first), true);
  assert.equal(globallyBounded.reserveSse(second), true);
  assert.equal(globallyBounded.reserveSse(first), false);
  assert.equal(globallyBounded.sseReservationCount, 2);
  globallyBounded.releaseSseReservation(first);
  globallyBounded.releaseSseReservation(second);
  assert.equal(globallyBounded.sseReservationCount, 0);
}
