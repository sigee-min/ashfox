import { composeAssetFrames, type AssetExactFrame, type AssetExactUnitVector } from './frame';
import { identityTypedFrame } from './hirFrames';
import type { InstantiatedAssetIr, InstantiatedBone, InstantiatedSocketConnection } from './ir';
import { assetNumberValue, assetVectorValue } from './value/contract';
import { addExact, exactVector, type Context, type GeometryRecord } from './geometrySupport';

/** Canonical pivots are an unrotated bind layout; runtimes subtract parent pivots. */
export const appendBindLayout = (
  parentOrigin: AssetExactUnitVector,
  parentFrame: AssetExactFrame
): AssetExactFrame | null => composeAssetFrames(
  { ...identityTypedFrame(), origin: parentOrigin }, parentFrame);

export const createBoneLayouts = (
  bones: ReadonlyMap<string, InstantiatedBone>,
  parents: ReadonlyMap<string, string | null>
): ((id: string) => AssetExactFrame | null) => {
  const layouts = new Map<string, AssetExactFrame | null>();
  const layout = (id: string): AssetExactFrame | null => {
    if (layouts.has(id)) return layouts.get(id)!;
    const parentId = parents.get(id);
    const parent = parentId ? layout(parentId) : identityTypedFrame();
    const value = parent === null ? null : appendBindLayout(parent.origin, bones.get(id)!.parentRestFrame);
    layouts.set(id, value);
    return value;
  };
  return layout;
};

const zero = (): AssetExactUnitVector => identityTypedFrame().origin;
const add = (a: AssetExactUnitVector, b: AssetExactUnitVector): AssetExactUnitVector =>
  [addExact(a[0], b[0]), addExact(a[1], b[1]), addExact(a[2], b[2])];
interface Layout { readonly origin: AssetExactUnitVector; readonly componentOffset: AssetExactUnitVector }

/** Socket-owned geometry is component-local; translate its bind layout once. */
export const createGeometryLayout = (
  ir: InstantiatedAssetIr,
  records: readonly GeometryRecord[],
  connections: ReadonlyMap<string, InstantiatedSocketConnection>,
  parentFor: (record: GeometryRecord) => string | null,
  context: Context
) => {
  const bones = new Map(ir.bones.map((bone) => [bone.id, bone]));
  const semantic = new Map(ir.bones.map((bone) => [bone.semanticJoint, bone.id]));
  const geometry = new Map(records.filter((record) => record.node.kind === 'bone').map((record) => [record.node.id, record]));
  const cache = new Map<string, Layout | null>();
  const active = new Set<string>();
  const property = (record: GeometryRecord, name: string): AssetExactUnitVector | null => {
    const entry = record.node.properties.find((value) => value.name === name);
    if (!entry) return zero();
    const value = exactVector(entry, 'vec3<unit>', context, record.node.sourcePath, record.node.span);
    return value === null ? null : [value[0]!, value[1]!, value[2]!];
  };
  const resolve = (id: string): Layout | null => {
    id = semantic.get(id) ?? id;
    if (cache.has(id)) return cache.get(id)!;
    if (active.has(id) || active.size >= 128) return null;
    active.add(id);
    let result: Layout | null = null;
    const bone = bones.get(id);
    const record = geometry.get(id);
    if (bone) {
      const parent = bone.parentId === null ? { origin: zero() } : resolve(bone.parentId);
      const frame = parent && appendBindLayout(parent.origin, bone.parentRestFrame);
      if (frame) result = { origin: frame.origin, componentOffset: zero() };
    } else if (record) {
      const parentId = parentFor(record);
      const parent = parentId === null ? null : resolve(parentId);
      const connection = connections.get(id);
      if (parent && connection) {
        const frame = appendBindLayout(parent.origin, connection.parentPlacement);
        if (frame) result = { origin: frame.origin, componentOffset: frame.origin };
      } else if (parent) {
        const pivot = property(record, 'pivot');
        const position = property(record, 'position');
        if (pivot && position) result = { origin: add(add(pivot, position), parent.componentOffset), componentOffset: parent.componentOffset };
      }
    }
    active.delete(id);
    cache.set(id, result);
    return result;
  };
  const shifted = (record: GeometryRecord): GeometryRecord | null => {
    if (connections.has(record.node.id) || record.node.kind === 'locator') return record;
    const parentId = parentFor(record);
    const layout = parentId === null ? null : resolve(parentId);
    if (!layout) return null;
    const offset = layout.componentOffset;
    if (offset.every((value) => value.numerator === 0n)) return record;
    const names = record.node.kind === 'cube' ? ['origin', 'pivot'] :
      record.node.kind === 'bone' ? ['pivot'] :
      record.node.properties.some((value) => value.name === 'position') ? ['position'] : ['origin'];
    const properties = [...record.node.properties];
    for (const name of names) {
      if (name !== 'pivot' && !properties.some((value) => value.name === name)) continue;
      const original = property(record, name);
      if (!original) return null;
      const existing = properties.findIndex((value) => value.name === name);
      const shiftedProperty = { name, span: existing < 0 ? record.node.span : properties[existing]!.span,
        value: assetVectorValue(add(original, offset).map(assetNumberValue), 'vec3<unit>') };
      if (existing < 0) properties.push(shiftedProperty); else properties[existing] = shiftedProperty;
    }
    return { ...record, node: { ...record.node, properties } };
  };
  const connectionFrame = (connection: InstantiatedSocketConnection): AssetExactFrame | null => {
    const layout = resolve(connection.targetBoneId);
    return layout === null ? null : { ...connection.parentPlacement, origin: layout.origin };
  };
  return { shifted, connectionFrame };
};
