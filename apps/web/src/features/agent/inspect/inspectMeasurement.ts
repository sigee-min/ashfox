import { inspectNodeSurface, measureSceneGeometry, type AssetProject } from '@ashfox/engine-core';
import { boundedSuccess } from '../boundedResult';
import type { InspectRequest, InspectResult } from '../types';
import { DETAIL_INSPECT_LIMIT } from './inspectResult';

export const inspectMeasurement = (
  project: AssetProject,
  request: Extract<InspectRequest, { kind: 'measurement' | 'surface' | 'nodes' }>
): InspectResult => {
  const guards = { expectedRevision: project.revision,
    expectedWorkspaceHash: project.build.workspaceHash, expectedBuildKey: project.build.buildKey };
  for (const key of Object.keys(guards) as (keyof typeof guards)[]) {
    if (request[key] !== guards[key]) return { ok: false, revision: project.revision,
      error: { code: 'stale_revision', path: key, expected: guards[key] } };
  }
  let evidence: unknown;
  if (request.kind === 'nodes') {
    const nodes = Object.values(project.document.scene.nodes).sort((a, b) =>
      a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    if (request.offset > nodes.length) return { ok: false, revision: project.revision,
      error: { code: 'invalid_request', path: 'offset', expected: `offset <= ${nodes.length}` } };
    const end = Math.min(nodes.length, request.offset + request.limit);
    evidence = { nodes: nodes.slice(request.offset, end).map((node) => ({
      id: node.id, name: node.name, kind: node.kind, parentId: node.parentId,
      visible: node.visible })), total: nodes.length, offset: request.offset,
      nextOffset: end < nodes.length ? end : null };
  } else if (request.kind === 'surface') {
    evidence = inspectNodeSurface(project.document, request.nodeId);
    if (evidence === null) return { ok: false, revision: project.revision,
      error: { code: 'not_found', path: 'nodeId', expected: 'cube or plane node id' } };
  } else {
    const result = measureSceneGeometry(project.document, { nodeId: request.nodeId,
      scope: request.scope, groundY: request.groundY, tolerance: request.tolerance });
    if (!result.ok) return { ok: false, revision: project.revision,
      error: { code: result.reason === 'not_found' ? 'not_found' : 'invalid_request',
        path: result.path, expected: result.reason } };
    evidence = result.value;
  }
  return boundedSuccess(project.revision, { kind: request.kind, schemaVersion: 1,
    build: project.build, evidence }, DETAIL_INSPECT_LIMIT);
};
