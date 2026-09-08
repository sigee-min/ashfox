import type { ProjectDocument } from '../document';
import type { Vec3 } from '../identity';
import { cubeGeometryPivot, cubeGeometryRotation, cubeUnrotatedBounds,
  type SceneNode } from '../scene';
import { canonicalRotatePoint } from '../transform';
import type { GeometryMeasurementRequest, MeasurementResult } from './contract';

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scaled = (a: Vec3, b: Vec3): Vec3 => [a[0] * b[0], a[1] * b[1], a[2] * b[2]];
const origin = (node: SceneNode): Vec3 => add(node.transform.pivot, node.transform.position);

const localCorners = (node: SceneNode): readonly Vec3[] => {
  if (node.kind === 'cube') {
    const bounds = cubeUnrotatedBounds(node);
    const pivot = cubeGeometryPivot(node);
    const points: Vec3[] = [];
    for (const x of [bounds.from[0] - node.inflate, bounds.to[0] + node.inflate]) {
      for (const y of [bounds.from[1] - node.inflate, bounds.to[1] + node.inflate]) {
        for (const z of [bounds.from[2] - node.inflate, bounds.to[2] + node.inflate]) {
          const point = sub([x, y, z], pivot);
          points.push(node.geometryMode === 'oriented-box'
            ? add(canonicalRotatePoint(point, cubeGeometryRotation(node)), pivot)
            : point);
        }
      }
    }
    return points;
  }
  if (node.kind !== 'plane') return [];
  const u = node.basis?.uAxis ?? [1, 0, 0];
  const v = node.basis?.vAxis ?? [0, 1, 0];
  const n = node.basis?.normal ?? [0, 0, 1];
  const points: Vec3[] = [];
  for (const x of [0, node.size[0]]) for (const y of [0, node.size[1]]) {
    const p = node.transform.pivot;
    const axis = (i: number): number => u[i]! * (x - p[0]) + v[i]! * (y - p[1]) - n[i]! * p[2];
    points.push([axis(0), axis(1), axis(2)]);
  }
  return points;
};

/** Measures the full primitive envelope, never alpha coverage or pair collision.
 * Canonical transforms follow the same pivot-relative hierarchy as the viewport. */
export const measureSceneGeometry = (
  document: ProjectDocument,
  request: GeometryMeasurementRequest
): MeasurementResult => {
  const fail = (reason: Extract<MeasurementResult, { ok: false }>['reason'],
    path = `scene.nodes.${request.nodeId}`): MeasurementResult => ({ ok: false, reason, path });
  if (Object.keys(request).some((key) => !['nodeId', 'scope', 'groundY', 'tolerance'].includes(key)) ||
    typeof request.nodeId !== 'string' || request.nodeId.length === 0 ||
    !Number.isFinite(request.groundY) || !Number.isFinite(request.tolerance) ||
    request.tolerance < 0 || !['node', 'subtree'].includes(request.scope)) {
    return fail('invalid_request', 'measurement');
  }
  const nodes = Object.values(document.scene.nodes);
  if (nodes.length > 4096) return fail('budget_exceeded', 'scene.nodes');
  if (!Object.prototype.hasOwnProperty.call(document.scene.nodes, request.nodeId)) return fail('not_found');
  let geometryCount = 0;
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const node of nodes) {
    if (node.kind !== 'cube' && node.kind !== 'plane') continue;
    if (request.scope === 'node' && node.id !== request.nodeId) continue;
    const chain: SceneNode[] = [];
    const seen = new Set<string>();
    let current: SceneNode | undefined = node;
    while (current) {
      if (seen.has(current.id)) return fail('invalid_geometry', `scene.nodes.${node.id}.parentId`);
      if (chain.length >= 128) return fail('budget_exceeded');
      seen.add(current.id);
      chain.push(current);
      if (current.parentId === null) break;
      const parentId: string = current.parentId;
      current = Object.prototype.hasOwnProperty.call(document.scene.nodes, parentId)
        ? document.scene.nodes[parentId] : undefined;
      if (!current || current.kind !== 'bone') return fail('invalid_geometry', `scene.nodes.${node.id}.parentId`);
    }
    if (!seen.has(request.nodeId)) continue;
    geometryCount += 1;
    for (const local of localCorners(node)) {
      let point = local;
      for (let index = 0; index < chain.length; index += 1) {
        const owner = chain[index]!;
        const parent = chain[index + 1];
        const translation = sub(origin(owner), parent ? origin(parent) : [0, 0, 0]);
        point = add(canonicalRotatePoint(scaled(point, owner.transform.scale),
          owner.transform.rotation), translation);
      }
      if (!point.every(Number.isFinite)) return fail('invalid_geometry');
      for (let axis = 0; axis < 3; axis += 1) {
        min[axis] = Math.min(min[axis]!, point[axis]!);
        max[axis] = Math.max(max[axis]!, point[axis]!);
      }
    }
  }
  if (geometryCount === 0) return fail('empty_geometry');
  const signedGap = min[1]! - request.groundY;
  return { ok: true, value: {
    schemaVersion: 1, nodeId: request.nodeId, scope: request.scope,
    pose: 'rest', space: 'model', envelope: 'full-primitives-including-hidden-and-alpha',
    geometryCount, bounds: { min, max },
    dimensions: sub(max, min),
    ground: { y: request.groundY, tolerance: request.tolerance, signedGap,
      relation: signedGap > request.tolerance ? 'above' :
        signedGap < -request.tolerance ? 'penetrating' : 'touching' }
  } };
};
