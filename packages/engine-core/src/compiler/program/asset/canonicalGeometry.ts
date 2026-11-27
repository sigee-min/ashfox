import { compareText } from '../../../stableOrder';
import { deepFreeze } from '../../../immutable';
import { createGeometryLayout } from './canonicalLayout';
import { lowerExpressionSlot, lowerPlane } from './canonicalPlane';
import { lowerCube, lowerLocator, lowerPrivateBone } from './canonicalShapes';
import { lowerCustomPrimRecord } from './canonicalPrim';
import { lowerAssetFrameToBoneTransform } from './frameLower';
import type { SourceSpan } from '../../../project/source/contract';
import type { EntityId } from '../../../model/identity';
import type { SceneNode } from '../../../model/scene';
import type {
  InstantiatedAssetIr,
  InstantiatedBone,
  InstantiatedComponentInstance,
  InstantiatedSocketConnection,
} from './ir';
import type { AssetTexturePlan } from './texture/contract';
import {
  report,
  type CanonicalGeometryIssue,
  type Context,
  type GeometryRecord,
  type SurfaceBindings,
} from './geometrySupport';

export type { CanonicalGeometryIssue } from './geometrySupport';

export interface CanonicalGeometryProduct {
  readonly nodes: readonly SceneNode[];
  readonly roots: readonly EntityId[];
}

const firstSpan = (ir: InstantiatedAssetIr): SourceSpan | undefined =>
  ir.instances[0]?.span ?? ir.bones[0]?.span ?? ir.surfaces[0]?.span ?? ir.connections[0]?.span;

const flatten = (
  instances: readonly InstantiatedComponentInstance[],
  context: Context,
): readonly GeometryRecord[] => {
  const records: GeometryRecord[] = [];
  for (const instance of [...instances].sort((left, right) => compareText(left.id, right.id))) {
    const pending = [...instance.geometry]
      .reverse()
      .map((node) => ({ node, instance, parentNodeId: null as string | null }));
    while (pending.length > 0) {
      const current = pending.pop()!;
      if (current.node.id.length === 0) {
        report(
          context,
          current.instance.sourcePath,
          current.node.span,
          'asset.invalid-geometry-id',
          'Geometry node identifiers cannot be empty.',
        );
      }
      records.push({
        node: current.node,
        instance: current.instance,
        parentNodeId: current.parentNodeId,
      });
      for (const child of [...current.node.children].reverse()) {
        pending.push({ node: child, instance: current.instance, parentNodeId: current.node.id });
      }
    }
  }
  return records;
};

const CHILD_KINDS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  bone: ['bone', 'cube', 'plane', 'taper', 'wedge', 'cylinder', 'expression_slot', 'locator'],
  cube: ['face'],
});

const childScopeMessage = (kind: string): string => {
  if (kind === 'bone') {
    return 'Bones may contain only bone, cube, plane, taper, wedge, cylinder, expression_slot, or locator children.';
  }
  if (kind === 'cube') return 'Cubes may contain only direct face children.';
  return 'Plane, locator, and face nodes cannot contain geometry children.';
};

const validateNodeStructure = (
  record: GeometryRecord,
  firstById: ReadonlyMap<string, GeometryRecord>,
  context: Context,
): void => {
  const node = record.node;
  const allowed = CHILD_KINDS[node.kind] ?? [];
  for (const child of node.children) {
    if (!allowed.includes(child.kind)) {
      report(
        context,
        child.sourcePath,
        child.span,
        'asset.invalid-geometry-scope',
        childScopeMessage(node.kind),
      );
    }
  }
  if (
    node.kind === 'face' &&
    (record.parentNodeId === null || firstById.get(record.parentNodeId)?.node.kind !== 'cube')
  ) {
    report(
      context,
      node.sourcePath,
      node.span,
      'asset.invalid-geometry-scope',
      'Face nodes must be direct children of a cube.',
    );
  }
};

const validateStructure = (records: readonly GeometryRecord[], context: Context): void => {
  // Preserve Array.find's first occurrence even for invalid duplicate IDs.
  const firstById = new Map<string, GeometryRecord>();
  for (const record of records) {
    if (!firstById.has(record.node.id)) firstById.set(record.node.id, record);
  }
  for (const record of records) validateNodeStructure(record, firstById, context);
};

const indexPlans = (
  plans: readonly AssetTexturePlan[],
  ir: InstantiatedAssetIr,
  context: Context,
): Map<string, AssetTexturePlan> => {
  const planMap = new Map<string, AssetTexturePlan>();
  for (const plan of [...plans].sort((left, right) =>
    compareText(left.surfaceSymbol.key, right.surfaceSymbol.key),
  )) {
    if (!planMap.has(plan.surfaceSymbol.key)) {
      planMap.set(plan.surfaceSymbol.key, plan);
      continue;
    }
    const span = firstSpan(ir);
    if (span === undefined) throw new Error('No source span for duplicate texture plan.');
    report(
      context,
      ir.instances[0]?.sourcePath ?? ir.asset.key,
      span,
      'asset.duplicate-texture-plan',
      `Texture plan for surface "${plan.surfaceSymbol.key}" is duplicated.`,
    );
  }
  return planMap;
};

interface BoneIndex {
  readonly skeleton: Map<string, InstantiatedBone>;
  readonly semantic: Map<string, string>;
}

const indexSkeletonBones = (bones: readonly InstantiatedBone[], context: Context): BoneIndex => {
  const skeleton = new Map<string, InstantiatedBone>();
  const semantic = new Map<string, string>();
  for (const bone of [...bones].sort((left, right) => compareText(left.id, right.id))) {
    if (skeleton.has(bone.id)) {
      report(
        context,
        bone.sourcePath,
        bone.span,
        'asset.duplicate-bone-id',
        `Bone identifier "${bone.id}" is duplicated.`,
      );
    } else skeleton.set(bone.id, bone);
    if (semantic.has(bone.semanticJoint)) {
      report(
        context,
        bone.sourcePath,
        bone.span,
        'asset.duplicate-semantic-joint',
        `Semantic joint "${bone.semanticJoint}" is ambiguous.`,
      );
    } else semantic.set(bone.semanticJoint, bone.id);
  }
  return { skeleton, semantic };
};

const verifyUniqueRecordIds = (
  records: readonly GeometryRecord[],
  bones: BoneIndex,
  context: Context,
): void => {
  const byId = new Map<string, GeometryRecord>();
  for (const record of records) {
    const duplicate = byId.has(record.node.id);
    if (duplicate || bones.skeleton.has(record.node.id) || bones.semantic.has(record.node.id)) {
      report(
        context,
        record.node.sourcePath,
        record.node.span,
        duplicate ? 'asset.duplicate-emitted-id' : 'asset.geometry-id-collision',
        `Geometry identifier "${record.node.id}" is not unique.`,
      );
    } else byId.set(record.node.id, record);
  }
};

const indexConnections = (
  ir: InstantiatedAssetIr,
  context: Context,
): Map<string, InstantiatedSocketConnection> => {
  const connections = new Map<string, InstantiatedSocketConnection>();
  for (const connection of [...ir.connections].sort((left, right) =>
    compareText(left.id, right.id),
  )) {
    if (connections.has(connection.targetBoneId)) {
      report(
        context,
        ir.instances[0]?.sourcePath ?? ir.asset.key,
        connection.span,
        'asset.duplicate-socket-authority',
        `Socket target "${connection.targetBoneId}" has more than one connection.`,
      );
    } else connections.set(connection.targetBoneId, connection);
  }
  return connections;
};

const validateGeometryBone = (
  record: GeometryRecord,
  connections: ReadonlyMap<string, InstantiatedSocketConnection>,
  context: Context,
): void => {
  const bound = connections.has(record.node.id);
  if (bound) {
    for (const property of record.node.properties) {
      report(
        context,
        record.node.sourcePath,
        property.span,
        'asset.geometry-authority-transform',
        'A socket authority bone cannot author a duplicate transform.',
      );
    }
    if (record.node.surface !== null) {
      report(
        context,
        record.node.sourcePath,
        record.node.surface.span,
        'asset.geometry-surface',
        'Socket authority bones cannot own surface chart bindings.',
      );
    }
  } else if (record.node.attachmentBoneId === null) {
    report(
      context,
      record.node.sourcePath,
      record.node.span,
      'asset.missing-geometry-parent',
      'A private geometry bone requires a mapped parent or socket authority.',
    );
  }
};

const collectGeometryBones = (
  records: readonly GeometryRecord[],
  connections: ReadonlyMap<string, InstantiatedSocketConnection>,
  ir: InstantiatedAssetIr,
  context: Context,
): Map<string, GeometryRecord> => {
  const geometryBones = new Map<string, GeometryRecord>();
  for (const record of records) {
    if (record.node.kind !== 'bone') continue;
    geometryBones.set(record.node.id, record);
    validateGeometryBone(record, connections, context);
  }
  for (const [target, connection] of connections) {
    if (!geometryBones.has(target)) {
      report(
        context,
        ir.instances[0]?.sourcePath ?? ir.asset.key,
        connection.span,
        'asset.missing-socket-authority',
        `Socket target bone "${target}" is not an emitted geometry bone.`,
      );
    }
  }
  return geometryBones;
};

interface ParentLookup {
  readonly bones: BoneIndex;
  readonly geometryBones: ReadonlyMap<string, GeometryRecord>;
  readonly connections: ReadonlyMap<string, InstantiatedSocketConnection>;
  readonly cache: Map<string, string | null>;
  readonly context: Context;
}

const resolveGeometryParent = (record: GeometryRecord, lookup: ParentLookup): string | null => {
  const cached = lookup.cache.get(record.node.id);
  if (cached !== undefined) return cached;
  const connection = lookup.connections.get(record.node.id);
  const requested = connection?.parentBoneId ?? record.node.attachmentBoneId;
  if (requested === null || requested === undefined) {
    report(
      lookup.context,
      record.node.sourcePath,
      record.node.span,
      'asset.geometry-parent',
      `Geometry node "${record.node.id}" has no bone parent.`,
    );
    lookup.cache.set(record.node.id, null);
    return null;
  }
  const parent = lookup.bones.skeleton.has(requested)
    ? requested
    : (lookup.bones.semantic.get(requested) ??
      (lookup.geometryBones.has(requested) ? requested : undefined));
  if (parent === undefined || parent === record.node.id) {
    report(
      lookup.context,
      record.node.sourcePath,
      record.node.span,
      'asset.geometry-parent',
      `Geometry parent "${requested}" is missing or is not a bone.`,
    );
  }
  const resolved = parent ?? null;
  lookup.cache.set(record.node.id, resolved);
  return resolved;
};

const checkGeometryBoneCycles = (
  geometryBones: ReadonlyMap<string, GeometryRecord>,
  parentFor: (record: GeometryRecord) => string | null,
  context: Context,
): void => {
  const parentOf = new Map<string, string>();
  for (const record of geometryBones.values()) {
    const parent = parentFor(record);
    if (parent !== null) parentOf.set(record.node.id, parent);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): void => {
    if (visited.has(id)) return;
    if (visiting.has(id)) {
      const record = geometryBones.get(id);
      if (record !== undefined) {
        report(
          context,
          record.node.sourcePath,
          record.node.span,
          'asset.geometry-parent-cycle',
          'Geometry bone parents must be acyclic.',
        );
      }
      return;
    }
    visiting.add(id);
    const parent = parentOf.get(id);
    if (parent !== undefined && geometryBones.has(parent)) visit(parent);
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of [...geometryBones.keys()].sort(compareText)) visit(id);
};

const groupSurfaces = (ir: InstantiatedAssetIr): SurfaceBindings => {
  const surfaces = new Map<string, InstantiatedAssetIr['surfaces'][number][]>();
  for (const binding of ir.surfaces) {
    const entries = surfaces.get(binding.surface.key);
    if (entries) entries.push(binding);
    else surfaces.set(binding.surface.key, [binding]);
  }
  return surfaces;
};

const lowerGeometryBone = (
  record: GeometryRecord,
  parent: string,
  layout: ReturnType<typeof createGeometryLayout>,
  connections: ReadonlyMap<string, InstantiatedSocketConnection>,
  context: Context,
): SceneNode | null => {
  const connection = connections.get(record.node.id);
  if (connection === undefined) return lowerPrivateBone(record, parent, context);
  const frame = layout.connectionFrame(connection);
  const transform = frame === null ? null : lowerAssetFrameToBoneTransform(frame);
  if (transform !== null) {
    return {
      id: record.node.id,
      kind: 'bone',
      name: record.node.id,
      parentId: parent,
      transform,
      visible: true,
    };
  }
  report(
    context,
    record.node.sourcePath,
    connection.span,
    'asset.connection-frame',
    'Socket local placement has no canonical transform.',
  );
  return null;
};

const lowerRecordNodes = (
  rawRecord: GeometryRecord,
  layout: ReturnType<typeof createGeometryLayout>,
  connections: ReadonlyMap<string, InstantiatedSocketConnection>,
  parentFor: (record: GeometryRecord) => string | null,
  surfaces: SurfaceBindings,
  planMap: ReadonlyMap<string, AssetTexturePlan>,
  context: Context,
): readonly SceneNode[] => {
  const record = layout.shifted(rawRecord);
  if (record === null) {
    report(
      context,
      rawRecord.node.sourcePath,
      rawRecord.node.span,
      'asset.geometry-layout',
      'Geometry bind layout could not be resolved.',
    );
    return [];
  }
  const parent = parentFor(record);
  if (parent === null) return [];
  const kind = record.node.kind;
  if (kind === 'expression_slot')
    return lowerExpressionSlot(record, parent, surfaces, planMap, context);
  let one: SceneNode | null = null;
  if (kind === 'bone') one = lowerGeometryBone(record, parent, layout, connections, context);
  else if (kind === 'cube') one = lowerCube(record, parent, surfaces, planMap, context);
  else if (kind === 'plane') one = lowerPlane(record, parent, surfaces, planMap, context);
  else if (kind === 'locator') one = lowerLocator(record, parent, context);
  else one = lowerCustomPrimRecord(record, parent, surfaces, planMap, context);
  return one === null ? [] : [one];
};

const lowerAssetGeometryChecked = (
  ir: InstantiatedAssetIr,
  plans: readonly AssetTexturePlan[],
  context: Context,
): CanonicalGeometryProduct | null => {
  const planMap = indexPlans(plans, ir, context);
  const bones = indexSkeletonBones(ir.bones, context);
  const records = flatten(ir.instances, context);
  validateStructure(records, context);
  verifyUniqueRecordIds(records, bones, context);
  const connections = indexConnections(ir, context);
  const geometryBones = collectGeometryBones(records, connections, ir, context);
  const lookup: ParentLookup = { bones, geometryBones, connections, cache: new Map(), context };
  const parentFor = (record: GeometryRecord): string | null =>
    resolveGeometryParent(record, lookup);
  checkGeometryBoneCycles(geometryBones, parentFor, context);
  if (context.failed) return null;
  const layout = createGeometryLayout(ir, records, connections, parentFor, context);
  const surfaces = groupSurfaces(ir);
  const sorted = records
    .filter((c) => c.node.kind !== 'face')
    .sort((l, r) => compareText(l.node.id, r.node.id));
  const output = sorted.flatMap((rec) =>
    lowerRecordNodes(rec, layout, connections, parentFor, surfaces, planMap, context),
  );
  if (context.failed) return null;
  return deepFreeze({
    nodes: output.sort((l, r) => compareText(l.id, r.id)),
    roots: [] as EntityId[],
  });
};

/** Lower instantiated geometry while keeping exact values outside the canonical boundary. */
export const lowerAssetGeometry = (
  ir: InstantiatedAssetIr,
  plans: readonly AssetTexturePlan[],
  issue: CanonicalGeometryIssue,
): CanonicalGeometryProduct | null => {
  const context: Context = { issue, failed: false };
  try {
    return lowerAssetGeometryChecked(ir, plans, context);
  } catch {
    const span = firstSpan(ir);
    if (span !== undefined) {
      report(
        context,
        ir.instances[0]?.sourcePath ?? ir.asset.key,
        span,
        'asset.canonical-geometry',
        'Canonical geometry lowering failed closed.',
      );
    }
    return null;
  }
};
