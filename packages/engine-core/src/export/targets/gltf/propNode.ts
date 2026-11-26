import type { StructureProduct } from '../../../compiler/structure/contract';
import type { GltfBinaryWriter } from './binary';
import type { GltfNode } from './contract';
import { quaternionFromEuler, rotateVec3ByQuaternion } from './spatial';
import type { PositionBounds } from './vertexLayout';

type PropInstance = StructureProduct['bakedMesh']['instances'][number];

const propOffset = (
  bounds: PositionBounds | undefined,
  rotQ: readonly [number, number, number, number],
  quantize: boolean,
): readonly [number, number, number] =>
  quantize && bounds ? rotateVec3ByQuaternion([...bounds.center], rotQ) : [0, 0, 0];

const emitInstancedProp = (
  name: string,
  mesh: number,
  bounds: PositionBounds | undefined,
  group: readonly PropInstance[],
  writer: GltfBinaryWriter,
): GltfNode => {
  const [tr, ro, sc]: [number[], number[], number[]] = [[], [], []];
  const quantize = writer.isQuantized;
  for (const inst of group) {
    const rq = inst.rotation ? quaternionFromEuler([0, inst.rotation, 0]) : ([0, 0, 0, 1] as const);
    const off = propOffset(bounds, rq, quantize);
    tr.push(
      inst.translation[0] + off[0],
      inst.translation[1] + off[1],
      inst.translation[2] + off[2],
    );
    ro.push(rq[0], rq[1], rq[2], rq[3]);
    if (quantize && bounds)
      sc.push(bounds.halfExtent[0], bounds.halfExtent[1], bounds.halfExtent[2]);
  }
  const attributes = {
    TRANSLATION: writer.addFloatAccessor(tr, 3, false),
    ROTATION: writer.addFloatAccessor(ro, 4, false),
    ...(quantize && bounds ? { SCALE: writer.addFloatAccessor(sc, 3, false) } : {}),
  };
  return { name, mesh, extensions: { EXT_mesh_gpu_instancing: { attributes } } };
};

export const buildPropNode = (
  name: string,
  mesh: number,
  bounds: PositionBounds | undefined,
  group: readonly PropInstance[],
  writer: GltfBinaryWriter,
): { readonly node: GltfNode; readonly instanced: boolean } => {
  if (group.length >= 2) {
    return { node: emitInstancedProp(name, mesh, bounds, group, writer), instanced: true };
  }
  const inst = group[0]!;
  const rq = inst.rotation ? quaternionFromEuler([0, inst.rotation, 0]) : undefined;
  const off = propOffset(bounds, rq ?? [0, 0, 0, 1], writer.isQuantized);
  const scale =
    writer.isQuantized && bounds ? ([...bounds.halfExtent] as [number, number, number]) : undefined;
  return {
    node: {
      name,
      mesh,
      translation: [
        inst.translation[0] + off[0],
        inst.translation[1] + off[1],
        inst.translation[2] + off[2],
      ],
      ...(rq ? { rotation: rq } : {}),
      ...(scale ? { scale } : {}),
    },
    instanced: false,
  };
};

export const emitLod1PropNodes = (
  nodes: GltfNode[],
  meshes: readonly { readonly name?: string }[],
  writer: GltfBinaryWriter,
  product: StructureProduct,
  customBounds?: ReadonlyMap<string, PositionBounds>,
): { readonly props: number[]; readonly usesGpuInstancing: boolean } => {
  const lod1 = product.lodLevels?.lod1;
  if (!lod1 || lod1.instances.length === 0) return { props: [], usesGpuInstancing: false };
  const byMesh = new Map<string, number>();
  meshes.forEach((m, i) => m.name && byMesh.set(m.name, i));
  const byKey = new Map<string, PropInstance[]>();
  for (const inst of lod1.instances) {
    if (!byMesh.has(inst.assetKey)) continue;
    const list = byKey.get(inst.assetKey) ?? [];
    list.push(inst);
    byKey.set(inst.assetKey, list);
  }
  const props: number[] = [];
  let usesGpuInstancing = false;
  for (const [assetKey, group] of byKey) {
    const name = group.length >= 2 ? `lod1_props_${assetKey}` : `lod1_prop_${props.length + 1}`;
    const built = buildPropNode(
      name,
      byMesh.get(assetKey)!,
      customBounds?.get(assetKey),
      group,
      writer,
    );
    if (built.instanced) usesGpuInstancing = true;
    props.push(nodes.push(built.node) - 1);
  }
  return { props, usesGpuInstancing };
};
