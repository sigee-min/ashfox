import type { InspectRequest, ParseInspectRequestResult } from './types';

export const parseMeasurement = (
  value: Readonly<Record<string, unknown>>
): ParseInspectRequestResult => {
  const fail = (path: string, expected: string): ParseInspectRequestResult => ({
    ok: false, error: { code: 'invalid_request', path, expected }
  });
  const keys = ['kind', 'expectedRevision', 'expectedWorkspaceHash', 'expectedBuildKey'];
  if (value.kind === 'nodes') keys.push('offset', 'limit');
  else keys.push('nodeId');
  if (value.kind === 'measurement') keys.push('scope', 'groundY', 'tolerance');
  const unknown = Object.keys(value).find((key) => !keys.includes(key));
  if (unknown) return fail(unknown, 'no additional properties');
  for (const key of value.kind === 'nodes' ? ['expectedRevision'] : ['expectedRevision', 'nodeId']) {
    if (typeof value[key] !== 'string' || value[key].length === 0 ||
      value[key].length > 512 || value[key].trim() !== value[key]) return fail(key, 'non-empty text <= 512 characters');
  }
  for (const key of ['expectedWorkspaceHash', 'expectedBuildKey']) {
    if (typeof value[key] !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(value[key])) {
      return fail(key, 'sha256 digest');
    }
  }
  const version = { expectedRevision: value.expectedRevision as string,
    expectedWorkspaceHash: value.expectedWorkspaceHash as string,
    expectedBuildKey: value.expectedBuildKey as string };
  if (value.kind === 'nodes') {
    if (typeof value.offset !== 'number' || !Number.isSafeInteger(value.offset) || value.offset < 0) return fail('offset', 'non-negative safe integer');
    if (typeof value.limit !== 'number' || !Number.isSafeInteger(value.limit) || value.limit < 1 || value.limit > 32) return fail('limit', 'integer from 1 to 32');
    return { ok: true, request: { kind: 'nodes', ...version, offset: value.offset, limit: value.limit } };
  }
  const guard = { ...version, nodeId: value.nodeId as string };
  if (value.kind === 'surface') return { ok: true, request: { kind: 'surface', ...guard } };
  if (value.scope !== 'node' && value.scope !== 'subtree') return fail('scope', 'node or subtree');
  if (typeof value.groundY !== 'number' || !Number.isFinite(value.groundY)) return fail('groundY', 'finite model-space Y');
  if (typeof value.tolerance !== 'number' || !Number.isFinite(value.tolerance) || value.tolerance < 0) {
    return fail('tolerance', 'finite non-negative model-unit tolerance');
  }
  const request: InspectRequest = { kind: 'measurement', ...guard, scope: value.scope,
    groundY: value.groundY, tolerance: value.tolerance };
  return { ok: true, request };
};
