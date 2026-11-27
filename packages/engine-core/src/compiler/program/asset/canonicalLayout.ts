import type { Vec3 } from '../../../model/identity';
import { composeAssetFrames, type AssetExactFrame, type AssetExactUnitVector } from './frame';
import { identityTypedFrame } from './hirFrames';
import type {
  InstantiatedAssetIr,
  InstantiatedBone,
  InstantiatedGeometryNode,
  InstantiatedSocketConnection,
} from './ir';
import { assetNumberValue, assetVectorValue } from './value/contract';
import {
  NUMBER_BOUNDARY,
  addExact,
  exactToVector3,
  exactVector,
  type Context,
  type GeometryRecord,
} from './geometrySupport';

/** Canonical pivots are an unrotated bind layout; runtimes subtract parent pivots. */
export const appendBindLayout = (
  parentOrigin: AssetExactUnitVector,
  parentFrame: AssetExactFrame,
): AssetExactFrame | null =>
  composeAssetFrames({ ...identityTypedFrame(), origin: parentOrigin }, parentFrame);

export const createBoneLayouts = (
  bones: ReadonlyMap<string, InstantiatedBone>,
  parents: ReadonlyMap<string, string | null>,
): ((id: string) => AssetExactFrame | null) => {
  const layouts = new Map<string, AssetExactFrame | null>();
  const layout = (id: string): AssetExactFrame | null => {
    if (layouts.has(id)) return layouts.get(id)!;
    const parentId = parents.get(id);
    const parent = parentId ? layout(parentId) : identityTypedFrame();
    const value =
      parent === null ? null : appendBindLayout(parent.origin, bones.get(id)!.parentRestFrame);
    layouts.set(id, value);
    return value;
  };
  return layout;
};

const zero = (): AssetExactUnitVector => identityTypedFrame().origin;

const add = (a: AssetExactUnitVector, b: AssetExactUnitVector): AssetExactUnitVector => [
  addExact(a[0], b[0]),
  addExact(a[1], b[1]),
  addExact(a[2], b[2]),
];

interface Layout {
  readonly origin: AssetExactUnitVector;
  readonly componentOffset: AssetExactUnitVector;
}

interface LayoutState {
  readonly bones: ReadonlyMap<string, InstantiatedBone>;
  readonly semantic: ReadonlyMap<string, string>;
  readonly geometry: ReadonlyMap<string, GeometryRecord>;
  readonly connections: ReadonlyMap<string, InstantiatedSocketConnection>;
  readonly parentFor: (record: GeometryRecord) => string | null;
  readonly context: Context;
  readonly cache: Map<string, Layout | null>;
  readonly active: Set<string>;
}

const readUnitProperty = (
  record: GeometryRecord,
  name: string,
  context: Context,
): AssetExactUnitVector | null => {
  const entry = record.node.properties.find((value) => value.name === name);
  if (!entry) return zero();
  const value = exactVector(entry, 'vec3<unit>', context, record.node.sourcePath, record.node.span);
  return value === null ? null : [value[0]!, value[1]!, value[2]!];
};

const resolveBoneNodeLayout = (bone: InstantiatedBone, state: LayoutState): Layout | null => {
  const parent = bone.parentId === null ? { origin: zero() } : resolveLayout(bone.parentId, state);
  const frame = parent && appendBindLayout(parent.origin, bone.parentRestFrame);
  return frame ? { origin: frame.origin, componentOffset: zero() } : null;
};

const resolveGeometryNodeLayout = (
  id: string,
  record: GeometryRecord,
  state: LayoutState,
): Layout | null => {
  const parentId = state.parentFor(record);
  const parent = parentId === null ? null : resolveLayout(parentId, state);
  if (!parent) return null;
  const connection = state.connections.get(id);
  if (connection) {
    const frame = appendBindLayout(parent.origin, connection.parentPlacement);
    return frame ? { origin: frame.origin, componentOffset: frame.origin } : null;
  }
  const pivot = readUnitProperty(record, 'pivot', state.context);
  const position = readUnitProperty(record, 'position', state.context);
  if (!pivot || !position) return null;
  return {
    origin: add(add(pivot, position), parent.componentOffset),
    componentOffset: parent.componentOffset,
  };
};

const resolveLayout = (id: string, state: LayoutState): Layout | null => {
  const canonicalId = state.semantic.get(id) ?? id;
  if (state.cache.has(canonicalId)) return state.cache.get(canonicalId)!;
  if (state.active.has(canonicalId) || state.active.size >= 128) return null;
  state.active.add(canonicalId);
  const bone = state.bones.get(canonicalId);
  const record = state.geometry.get(canonicalId);
  let result: Layout | null = null;
  if (bone) result = resolveBoneNodeLayout(bone, state);
  else if (record) result = resolveGeometryNodeLayout(canonicalId, record, state);
  state.active.delete(canonicalId);
  state.cache.set(canonicalId, result);
  return result;
};

const shiftTargetNames = (node: GeometryRecord['node']): readonly string[] => {
  if (node.kind === 'cube') return ['origin', 'pivot'];
  if (node.kind === 'bone') return ['pivot'];
  return node.properties.some((value) => value.name === 'position') ? ['position'] : ['origin'];
};

const applyShiftProperty = (
  record: GeometryRecord,
  name: string,
  offset: AssetExactUnitVector,
  properties: GeometryRecord['node']['properties'][number][],
  context: Context,
): boolean => {
  if (name !== 'pivot' && !properties.some((value) => value.name === name)) return true;
  const original = readUnitProperty(record, name, context);
  if (!original) return false;
  const existing = properties.findIndex((value) => value.name === name);
  const shiftedProperty = {
    name,
    span: existing < 0 ? record.node.span : properties[existing]!.span,
    value: assetVectorValue(add(original, offset).map(assetNumberValue), 'vec3<unit>'),
  };
  if (existing < 0) properties.push(shiftedProperty);
  else properties[existing] = shiftedProperty;
  return true;
};

const shiftRecord = (record: GeometryRecord, state: LayoutState): GeometryRecord | null => {
  if (state.connections.has(record.node.id) || record.node.kind === 'locator') return record;
  const parentId = state.parentFor(record);
  const layout = parentId === null ? null : resolveLayout(parentId, state);
  if (!layout) return null;
  const offset = layout.componentOffset;
  if (offset.every((value) => value.numerator === 0n)) return record;
  const properties = [...record.node.properties];
  for (const name of shiftTargetNames(record.node)) {
    if (!applyShiftProperty(record, name, offset, properties, state.context)) return null;
  }
  return { ...record, node: { ...record.node, properties } };
};

const resolveConnectionFrame = (
  connection: InstantiatedSocketConnection,
  state: LayoutState,
): AssetExactFrame | null => {
  const layout = resolveLayout(connection.targetBoneId, state);
  return layout === null ? null : { ...connection.parentPlacement, origin: layout.origin };
};

export interface ParentSolidBounds {
  readonly min: Vec3;
  readonly max: Vec3;
}

const solidBoxBoundsFromProps = (
  node: InstantiatedGeometryNode,
  context: Context,
): ParentSolidBounds | null => {
  const originProp = node.properties.find((p) => p.name === 'origin');
  const sizeProp = node.properties.find((p) => p.name === 'size');
  if (!originProp || !sizeProp) return null;
  const oEx = exactVector(originProp, 'vec3<unit>', context, node.sourcePath, node.span);
  const sEx = exactVector(sizeProp, 'vec3<unit>', context, node.sourcePath, node.span);
  if (!oEx || !sEx) return null;
  const o = exactToVector3(oEx, NUMBER_BOUNDARY, context, node.sourcePath, node.span);
  const s = exactToVector3(sEx, NUMBER_BOUNDARY, context, node.sourcePath, node.span);
  if (!o || !s) return null;
  return {
    min: [Math.min(o[0], o[0] + s[0]), Math.min(o[1], o[1] + s[1]), Math.min(o[2], o[2] + s[2])],
    max: [Math.max(o[0], o[0] + s[0]), Math.max(o[1], o[1] + s[1]), Math.max(o[2], o[2] + s[2])],
  };
};

const resolveParentSolidBounds = (
  parentId: string,
  shiftedRecords: readonly GeometryRecord[],
  parentFor: (record: GeometryRecord) => string | null,
  context: Context,
): ParentSolidBounds | undefined => {
  const solids = shiftedRecords.filter(
    (r) =>
      (r.node.kind === 'cube' || r.node.kind === 'taper' || r.node.kind === 'wedge') &&
      parentFor(r) === parentId,
  );
  const preferred = solids.find((r) => /(?:^|\/)(?:skull|head)$/i.test(r.node.id)) ?? solids[0];
  return preferred ? (solidBoxBoundsFromProps(preferred.node, context) ?? undefined) : undefined;
};

/** Socket-owned geometry is component-local; translate its bind layout once. */
export const createGeometryLayout = (
  ir: InstantiatedAssetIr,
  records: readonly GeometryRecord[],
  connections: ReadonlyMap<string, InstantiatedSocketConnection>,
  parentFor: (record: GeometryRecord) => string | null,
  context: Context,
) => {
  const state: LayoutState = {
    bones: new Map(ir.bones.map((bone) => [bone.id, bone])),
    semantic: new Map(ir.bones.map((bone) => [bone.semanticJoint, bone.id])),
    geometry: new Map(
      records
        .filter((record) => record.node.kind === 'bone')
        .map((record) => [record.node.id, record]),
    ),
    connections,
    parentFor,
    context,
    cache: new Map<string, Layout | null>(),
    active: new Set<string>(),
  };
  let shiftedCache: readonly GeometryRecord[] | null = null;
  return {
    shifted: (record: GeometryRecord): GeometryRecord | null => shiftRecord(record, state),
    connectionFrame: (connection: InstantiatedSocketConnection): AssetExactFrame | null =>
      resolveConnectionFrame(connection, state),
    parentSolidBounds: (parentId: string): ParentSolidBounds | undefined => {
      shiftedCache ??= records
        .filter((r) => r.node.kind !== 'face')
        .map((r) => shiftRecord(r, state) ?? r);
      return resolveParentSolidBounds(parentId, shiftedCache, parentFor, context);
    },
  };
};
