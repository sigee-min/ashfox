import { deepFreeze } from '../../../immutable';
import { createGeometryLayout } from './canonicalLayout';
import { lowerAssetFrameToBoneTransform } from './frameLower';
import type { SourceSpan } from '../../../project/source/contract';
import type { EntityId, UvRect, Vec3 } from '../../../model/identity';
import type { CubeFace, CubeFaces, PlaneFaces, SceneNode } from '../../../model/scene';
import type { InstantiatedAssetIr, InstantiatedBone, InstantiatedComponentInstance,
  InstantiatedGeometryNode, InstantiatedSocketConnection } from './ir';
import type { AssetTexturePlan } from './texture/contract';
import {
  CUBE_FACES, INTEGER_BOUNDARY, MAX_SAFE, NUMBER_BOUNDARY, compare, exactNumber,
  exactToVector2, exactToVector3, exactVector, addExact, boolean, canonical, cubeUv,
  directionOf, freeze, positiveIntegral, propertyMap, report, signedAxis,
  surfacePlan, transformFor, type CanonicalGeometryIssue, type Context, type GeometryRecord,
  type PropertyEntry, visibleFor
} from './geometrySupport';

export type { CanonicalGeometryIssue } from './geometrySupport';

export interface CanonicalGeometryProduct {
  readonly nodes: readonly SceneNode[];
  readonly roots: readonly EntityId[];
}

const firstSpan = (ir: InstantiatedAssetIr): SourceSpan | undefined =>
  ir.instances[0]?.span ?? ir.bones[0]?.span ?? ir.surfaces[0]?.span ?? ir.connections[0]?.span;

const lowerCube = (
  record: GeometryRecord,
  parentId: string,
  ir: InstantiatedAssetIr,
  plans: ReadonlyMap<string, AssetTexturePlan>,
  context: Context
): SceneNode | null => {
  const node = record.node;
  const properties = propertyMap(node, new Set([
    'origin', 'size', 'position', 'rotation', 'pivot', 'visible', 'inflate', 'mirror'
  ]), ['origin', 'size'], context);
  const origin = exactVector(properties.get('origin'), 'vec3<unit>', context, node.sourcePath, node.span);
  const size = exactVector(properties.get('size'), 'vec3<unit>', context, node.sourcePath, node.span);
  if (origin === null || size === null || !positiveIntegral(size)) {
    if (size !== null && !positiveIntegral(size)) report(context, node.sourcePath,
      properties.get('size')?.span ?? node.span, 'asset.geometry-size',
      'Cube size must contain positive integral unit components.');
    return null;
  }
  let to: readonly [ReturnType<typeof addExact>, ReturnType<typeof addExact>, ReturnType<typeof addExact>];
  try {
    to = [addExact(origin[0]!, size[0]!), addExact(origin[1]!, size[1]!),
      addExact(origin[2]!, size[2]!)];
  } catch {
    report(context, node.sourcePath, properties.get('size')?.span ?? node.span,
      'asset.geometry-size', 'Cube bounds exceed the exact arithmetic budget.');
    return null;
  }
  const originNumbers = exactToVector3(origin, NUMBER_BOUNDARY, context, node.sourcePath,
    properties.get('origin')?.span ?? node.span);
  const toNumbers = exactToVector3(to, NUMBER_BOUNDARY, context, node.sourcePath,
    properties.get('size')?.span ?? node.span);
  const sizeNumbers = exactToVector3(size, INTEGER_BOUNDARY, context, node.sourcePath,
    properties.get('size')?.span ?? node.span);
  const transform = transformFor(properties, context, node.sourcePath, node.span, true);
  const inflateExact = properties.has('inflate') ? exactNumber(properties.get('inflate'), 'unit',
    context, node.sourcePath, node.span) : null;
  const inflate = properties.has('inflate') && inflateExact !== null
    ? canonical(inflateExact, NUMBER_BOUNDARY, context, node.sourcePath, properties.get('inflate')!.span)
    : properties.has('inflate') ? null : 0;
  const mirror = boolean(properties.get('mirror'), false, context, node.sourcePath);
  const surface = surfacePlan(node, ir, plans, context, 'box');
  if (originNumbers === null || toNumbers === null || sizeNumbers === null || transform === null ||
      inflate === null || mirror === null || surface === null) return null;
  const expectedWidth = 2n * size[0]!.numerator + 2n * size[2]!.numerator;
  const expectedHeight = size[1]!.numerator + size[2]!.numerator;
  const chartMatches = expectedWidth <= BigInt(MAX_SAFE) && expectedHeight <= BigInt(MAX_SAFE) &&
    BigInt(surface.chart.width) === expectedWidth && BigInt(surface.chart.height) === expectedHeight;
  if (!chartMatches) {
    report(context, node.sourcePath, node.surface!.span, 'asset.geometry-surface',
      'Box chart dimensions must exactly match the cube box UV net.');
  }
  const uv = cubeUv(surface.chart.origin, [sizeNumbers[0], sizeNumbers[1], sizeNumbers[2]]);
  const faceByDirection = new Map<string, InstantiatedGeometryNode>();
  for (const child of node.children) {
    if (child.kind !== 'face') continue;
    const direction = directionOf(child);
    if (!CUBE_FACES.some((candidate) => candidate === direction)) {
      report(context, child.sourcePath, child.span, 'asset.geometry-face',
        'Cube faces must use one of the six canonical directions.');
    } else if (faceByDirection.has(direction)) {
      report(context, child.sourcePath, child.span, 'asset.duplicate-geometry-face',
        `Cube face "${direction}" is declared more than once.`);
    } else faceByDirection.set(direction, child);
  }
  const face = (direction: typeof CUBE_FACES[number]): CubeFace => {
    const child = faceByDirection.get(direction);
    const childProperties = child === undefined ? new Map<string, PropertyEntry>() :
      propertyMap(child, new Set(['enabled', 'rotation']), [], context);
    if (child !== undefined && child.surface !== null) report(context, child.sourcePath,
      child.surface.span, 'asset.geometry-surface', 'Face nodes cannot own surface bindings.');
    const enabled = child === undefined ? true : boolean(childProperties.get('enabled'), true,
      context, child.sourcePath);
    const rotation = child === undefined ? 0 : lowerFaceRotation(child, childProperties, context);
    return freeze({ enabled: enabled ?? false, textureId: surface.plan.texture.id,
      uv: uv[direction], rotation: rotation ?? 0 });
  };
  const faces: CubeFaces = {
    north: face('north'), south: face('south'), east: face('east'), west: face('west'),
    up: face('up'), down: face('down')
  };
  return { id: node.id, kind: 'cube', name: node.id, parentId, geometryMode: 'axis-box',
    bounds: { from: originNumbers, to: toNumbers }, transform,
    visible: visibleFor(properties, context, node), inflate, mirror, boxUv: true,
    uvOffset: freeze([surface.chart.origin[0], surface.chart.origin[1]]), faces };
};

const lowerFaceRotation = (
  node: InstantiatedGeometryNode,
  properties: ReadonlyMap<string, PropertyEntry>,
  context: Context
): 0 | 90 | 180 | 270 | null => {
  const entry = properties.get('rotation');
  if (entry === undefined) return 0;
  const exact = exactNumber(entry, 'plain', context, node.sourcePath, node.span);
  const value = exact === null ? null : canonical(exact, INTEGER_BOUNDARY, context,
    node.sourcePath, entry.span);
  if (value === null) return null;
  if (value !== 0 && value !== 90 && value !== 180 && value !== 270) {
    report(context, node.sourcePath, entry.span, 'asset.geometry-face',
      'Face rotation must be exactly 0, 90, 180, or 270 degrees.');
    return null;
  }
  return value as 0 | 90 | 180 | 270;
};

const lowerPlane = (
  record: GeometryRecord,
  parentId: string,
  ir: InstantiatedAssetIr,
  plans: ReadonlyMap<string, AssetTexturePlan>,
  context: Context
): SceneNode | null => {
  const node = record.node;
  const properties = propertyMap(node, new Set([
    'origin', 'size', 'position', 'rotation', 'pivot', 'visible', 'u-axis', 'v-axis'
  ]), ['origin', 'size', 'u-axis', 'v-axis'], context);
  const origin = exactVector(properties.get('origin'), 'vec3<unit>', context, node.sourcePath, node.span);
  const size = exactVector(properties.get('size'), 'vec2<unit>', context, node.sourcePath, node.span);
  const u = exactVector(properties.get('u-axis'), 'vec3<unit>', context, node.sourcePath, node.span);
  const v = exactVector(properties.get('v-axis'), 'vec3<unit>', context, node.sourcePath, node.span);
  if (origin === null || size === null || u === null || v === null || !positiveIntegral(size)) {
    if (size !== null && !positiveIntegral(size)) report(context, node.sourcePath,
      properties.get('size')?.span ?? node.span, 'asset.geometry-size',
      'Plane size must contain positive integral unit components.');
    return null;
  }
  const uAxis = signedAxis(u);
  const vAxis = signedAxis(v);
  const dot = uAxis === null || vAxis === null ? null :
    uAxis[0] * vAxis[0] + uAxis[1] * vAxis[1] + uAxis[2] * vAxis[2];
  if (uAxis === null || vAxis === null || dot !== 0) {
    report(context, node.sourcePath, properties.get('u-axis')?.span ?? node.span,
      'asset.geometry-axis', 'Plane axes must be distinct signed orthogonal unit axes.');
    return null;
  }
  const normal = freeze([uAxis[1] * vAxis[2] - uAxis[2] * vAxis[1],
    uAxis[2] * vAxis[0] - uAxis[0] * vAxis[2],
    uAxis[0] * vAxis[1] - uAxis[1] * vAxis[0]]) as Vec3;
  const originNumbers = exactToVector3(origin, NUMBER_BOUNDARY, context, node.sourcePath,
    properties.get('origin')?.span ?? node.span);
  const sizeNumbers = exactToVector2(size, INTEGER_BOUNDARY, context, node.sourcePath,
    properties.get('size')?.span ?? node.span);
  const transform = transformFor(properties, context, node.sourcePath, node.span, true,
    originNumbers ?? undefined);
  const surface = surfacePlan(node, ir, plans, context, 'flat');
  if (originNumbers === null || sizeNumbers === null || transform === null || surface === null) return null;
  if (surface.chart.width !== sizeNumbers[0] || surface.chart.height !== sizeNumbers[1]) {
    report(context, node.sourcePath, node.surface!.span, 'asset.geometry-surface',
      'Flat chart dimensions must exactly match the plane size.');
  }
  const uv: UvRect = freeze([surface.chart.origin[0], surface.chart.origin[1],
    surface.chart.origin[0] + sizeNumbers[0], surface.chart.origin[1] + sizeNumbers[1]]);
  const textureId = surface.plan.texture.id;
  const sidedness = surface.material === 'double' ? 'double' : 'front';
  const makeFace = (enabled: boolean): CubeFace => freeze({ enabled, textureId, uv, rotation: 0 });
  const faces: PlaneFaces = { front: makeFace(true), back: makeFace(sidedness === 'double') };
  return { id: node.id, kind: 'plane', name: node.id, parentId, size: sizeNumbers,
    transform, visible: visibleFor(properties, context, node), sidedness,
    coverageId: `${textureId}\u0000${surface.chart.id}`,
    basis: freeze({ normal, uAxis, vAxis, orientation: 'normal' }), faces };
};

const lowerLocator = (record: GeometryRecord, parentId: string, context: Context): SceneNode | null => {
  const node = record.node;
  const properties = propertyMap(node, new Set(['position', 'rotation', 'visible']), [], context);
  if (node.surface !== null || node.children.length > 0) report(context, node.sourcePath, node.span,
    'asset.invalid-geometry-scope', 'Locator nodes cannot contain surfaces or geometry children.');
  const transform = transformFor(properties, context, node.sourcePath, node.span, false);
  return transform === null ? null : { id: node.id, kind: 'locator', name: node.id,
    parentId, transform, visible: visibleFor(properties, context, node) };
};

const lowerPrivateBone = (record: GeometryRecord, parentId: string, context: Context): SceneNode | null => {
  const node = record.node;
  const properties = propertyMap(node, new Set(['position', 'rotation', 'pivot', 'visible']), [], context);
  if (node.surface !== null) report(context, node.sourcePath, node.span, 'asset.geometry-surface',
    'Bone nodes cannot own surface chart bindings.');
  const transform = transformFor(properties, context, node.sourcePath, node.span, true);
  return transform === null ? null : { id: node.id, kind: 'bone', name: node.id,
    parentId, transform, visible: visibleFor(properties, context, node) };
};

const flatten = (
  instances: readonly InstantiatedComponentInstance[],
  context: Context
): readonly GeometryRecord[] => {
  const records: GeometryRecord[] = [];
  for (const instance of [...instances].sort((left, right) => compare(left.id, right.id))) {
    const pending = [...instance.geometry].reverse().map((node) => ({ node, instance,
      parentNodeId: null as string | null }));
    while (pending.length > 0) {
      const current = pending.pop()!;
      if (current.node.id.length === 0) report(context, current.instance.sourcePath,
        current.node.span, 'asset.invalid-geometry-id', 'Geometry node identifiers cannot be empty.');
      records.push({ node: current.node, instance: current.instance, parentNodeId: current.parentNodeId });
      for (const child of [...current.node.children].reverse()) pending.push({ node: child,
        instance: current.instance, parentNodeId: current.node.id });
    }
  }
  return freeze(records);
};

const validateStructure = (records: readonly GeometryRecord[], context: Context): void => {
  for (const record of records) {
    const node = record.node;
    const allowed = node.kind === 'bone' ? ['bone', 'cube', 'plane', 'locator'] :
      node.kind === 'cube' ? ['face'] : [];
    for (const child of node.children) if (!allowed.some((kind) => kind === child.kind)) {
      report(context, child.sourcePath, child.span, 'asset.invalid-geometry-scope',
        node.kind === 'bone' ? 'Bones may contain only bone, cube, plane, or locator children.' :
          node.kind === 'cube' ? 'Cubes may contain only direct face children.' :
            'Plane, locator, and face nodes cannot contain geometry children.');
    }
    if (node.kind === 'face' && (record.parentNodeId === null ||
        records.find((candidate) => candidate.node.id === record.parentNodeId)?.node.kind !== 'cube')) {
      report(context, node.sourcePath, node.span, 'asset.invalid-geometry-scope',
        'Face nodes must be direct children of a cube.');
    }
  }
};

/** Lower instantiated geometry while keeping exact values outside the canonical boundary. */
export const lowerAssetGeometry = (
  ir: InstantiatedAssetIr,
  plans: readonly AssetTexturePlan[],
  issue: CanonicalGeometryIssue
): CanonicalGeometryProduct | null => {
  const context: Context = { issue, failed: false };
  try {
    const planMap = new Map<string, AssetTexturePlan>();
    for (const plan of [...plans].sort((left, right) => compare(left.surfaceSymbol.key, right.surfaceSymbol.key))) {
      if (planMap.has(plan.surfaceSymbol.key)) report(context, ir.instances[0]?.sourcePath ?? ir.asset.key,
        firstSpan(ir) ?? (() => { throw new Error('No source span for duplicate texture plan.'); })(),
        'asset.duplicate-texture-plan', `Texture plan for surface "${plan.surfaceSymbol.key}" is duplicated.`);
      else planMap.set(plan.surfaceSymbol.key, plan);
    }
    const skeleton = new Map<string, InstantiatedBone>();
    const semantic = new Map<string, string>();
    for (const bone of [...ir.bones].sort((left, right) => compare(left.id, right.id))) {
      if (skeleton.has(bone.id)) report(context, bone.sourcePath, bone.span,
        'asset.duplicate-bone-id', `Bone identifier "${bone.id}" is duplicated.`);
      else skeleton.set(bone.id, bone);
      if (semantic.has(bone.semanticJoint)) report(context, bone.sourcePath, bone.span,
        'asset.duplicate-semantic-joint', `Semantic joint "${bone.semanticJoint}" is ambiguous.`);
      else semantic.set(bone.semanticJoint, bone.id);
    }
    const records = flatten(ir.instances, context);
    validateStructure(records, context);
    const byId = new Map<string, GeometryRecord>();
    for (const record of records) {
      if (byId.has(record.node.id) || skeleton.has(record.node.id) || semantic.has(record.node.id)) report(context,
        record.node.sourcePath, record.node.span, byId.has(record.node.id)
          ? 'asset.duplicate-emitted-id' : 'asset.geometry-id-collision',
        `Geometry identifier "${record.node.id}" is not unique.`);
      else byId.set(record.node.id, record);
    }
    const connections = new Map<string, InstantiatedSocketConnection>();
    for (const connection of [...ir.connections].sort((left, right) => compare(left.id, right.id))) {
      if (connections.has(connection.targetBoneId)) report(context, ir.instances[0]?.sourcePath ?? ir.asset.key,
        connection.span, 'asset.duplicate-socket-authority',
        `Socket target "${connection.targetBoneId}" has more than one connection.`);
      else connections.set(connection.targetBoneId, connection);
    }
    const geometryBones = new Map<string, GeometryRecord>();
    for (const record of records) if (record.node.kind === 'bone') {
      geometryBones.set(record.node.id, record);
      if (connections.has(record.node.id) && record.node.properties.length > 0) for (const property of record.node.properties)
        report(context, record.node.sourcePath, property.span, 'asset.geometry-authority-transform',
          'A socket authority bone cannot author a duplicate transform.');
      if (connections.has(record.node.id) && record.node.surface !== null) report(context,
        record.node.sourcePath, record.node.surface.span, 'asset.geometry-surface',
        'Socket authority bones cannot own surface chart bindings.');
      if (!connections.has(record.node.id) && record.node.attachmentBoneId === null) report(context,
        record.node.sourcePath, record.node.span, 'asset.missing-geometry-parent',
        'A private geometry bone requires a mapped parent or socket authority.');
    }
    const resolveBone = (name: string): string | undefined => skeleton.has(name) ? name :
      semantic.get(name) ?? (geometryBones.has(name) ? name : undefined);
    for (const [target, connection] of connections) if (!geometryBones.has(target)) report(context,
      ir.instances[0]?.sourcePath ?? ir.asset.key, connection.span, 'asset.missing-socket-authority',
      `Socket target bone "${target}" is not an emitted geometry bone.`);
    const parentOf = new Map<string, string>();
    const parentCache = new Map<string, string | null>();
    const parentFor = (record: GeometryRecord): string | null => {
      const cached = parentCache.get(record.node.id);
      if (cached !== undefined) return cached;
      const connection = connections.get(record.node.id);
      const requested = connection?.parentBoneId ?? record.node.attachmentBoneId;
      if (requested === null || requested === undefined) {
        report(context, record.node.sourcePath, record.node.span, 'asset.geometry-parent',
          `Geometry node "${record.node.id}" has no bone parent.`);
        parentCache.set(record.node.id, null);
        return null;
      }
      const parent = resolveBone(requested);
      if (parent === undefined || parent === record.node.id) report(context, record.node.sourcePath,
        record.node.span, 'asset.geometry-parent', `Geometry parent "${requested}" is missing or is not a bone.`);
      const resolved = parent ?? null;
      parentCache.set(record.node.id, resolved);
      return resolved;
    };
    for (const record of records) if (record.node.kind === 'bone') {
      const parent = parentFor(record);
      if (parent !== null) parentOf.set(record.node.id, parent);
    }
    const visiting = new Set<string>(); const visited = new Set<string>();
    const visit = (id: string): void => {
      if (visited.has(id)) return;
      if (visiting.has(id)) {
        const record = geometryBones.get(id);
        if (record !== undefined) report(context, record.node.sourcePath, record.node.span,
          'asset.geometry-parent-cycle', 'Geometry bone parents must be acyclic.');
        return;
      }
      visiting.add(id); const parent = parentOf.get(id);
      if (parent !== undefined && geometryBones.has(parent)) visit(parent);
      visiting.delete(id); visited.add(id);
    };
    for (const id of [...geometryBones.keys()].sort(compare)) visit(id);
    if (context.failed) return null;
    const layout = createGeometryLayout(ir, records, connections, parentFor, context);
    const output: SceneNode[] = [];
    for (const rawRecord of records.filter((candidate) => candidate.node.kind !== 'face')
      .sort((left, right) => compare(left.node.id, right.node.id))) {
      const record = layout.shifted(rawRecord);
      if (record === null) {
        report(context, rawRecord.node.sourcePath, rawRecord.node.span,
          'asset.geometry-layout', 'Geometry bind layout could not be resolved.');
        continue;
      }
      const parent = parentFor(record); if (parent === null) continue;
      const node = record.node;
      if (node.kind === 'bone') {
        const connection = connections.get(node.id);
        if (connection === undefined) {
          const lowered = lowerPrivateBone(record, parent, context);
          if (lowered !== null) output.push(lowered);
        } else {
          const frame = layout.connectionFrame(connection);
          const transform = frame === null ? null : lowerAssetFrameToBoneTransform(frame);
          if (transform === null) report(context, node.sourcePath, connection.span,
            'asset.connection-frame', 'Socket local placement has no canonical transform.');
          else output.push({ id: node.id, kind: 'bone', name: node.id,
            parentId: parent, transform, visible: true });
        }
      } else if (node.kind === 'cube') {
        const lowered = lowerCube(record, parent, ir, planMap, context); if (lowered !== null) output.push(lowered);
      } else if (node.kind === 'plane') {
        const lowered = lowerPlane(record, parent, ir, planMap, context); if (lowered !== null) output.push(lowered);
      } else if (node.kind === 'locator') {
        const lowered = lowerLocator(record, parent, context); if (lowered !== null) output.push(lowered);
      }
    }
    if (context.failed) return null;
    const nodes = output.sort((left, right) => compare(left.id, right.id));
    return deepFreeze({ nodes, roots: [] as EntityId[] });
  } catch {
    const span = firstSpan(ir);
    if (span !== undefined) report(context, ir.instances[0]?.sourcePath ?? ir.asset.key, span,
      'asset.canonical-geometry', 'Canonical geometry lowering failed closed.');
    return null;
  }
};
