import type { ProjectDocument, SceneNode, Vec3 } from '../../../model';
import { cubeGeometryRotation } from '../../../model';
import { compileGltfCubePrimitiveData } from './cube';
import { compileGltfPlanePrimitiveData } from './plane';
import { compileGltfPrimitive } from './primitive';
import type { GltfPrimitiveData } from './data';
import type { GltfSceneCompileOptions } from './graph';
import type { GltfMesh, GltfNode, GltfSkin } from './contract';
import {
  computePositionsBounds,
  normalizePositionsWithBounds,
  type PositionBounds,
} from './vertexLayout';

export type Mat4 = readonly number[];

interface PrimitiveBatch {
  material: number | undefined;
  hasUvs: boolean;
  primitives: Array<GltfPrimitiveData & { jointId?: string | null }>;
}

interface MergedGroup {
  positions: number[];
  normals: number[];
  uvs?: number[];
  joints?: number[];
  material: number | undefined;
  indices: number[];
}

export interface CompiledModelGltf {
  meshes: GltfMesh[];
  skins: GltfSkin[];
  meshNodes: GltfNode[];
}

/** A canonical plane basis already maps its chart into model space. Its
 * transform rotation is a basis-less lowering hint for consumers that cannot
 * read the basis and must never be applied a second time by glTF. */
export const gltfNodeGeometryRotation = (node: SceneNode): Vec3 =>
  node.kind === 'plane' && node.basis !== undefined
    ? [0, 0, 0]
    : node.kind === 'cube'
      ? cubeGeometryRotation(node)
      : node.transform.rotation;

export const animatedNodeIds = (document: ProjectDocument): ReadonlySet<string> =>
  new Set(
    Object.values(document.animations).flatMap((clip) =>
      Object.values(clip.channels).flatMap((channel) =>
        channel.keys.length > 0 ? [channel.targetNodeId] : [],
      ),
    ),
  );

export const primitiveDataForGltfNode = (
  document: ProjectDocument,
  node: SceneNode,
  options: GltfSceneCompileOptions,
): GltfPrimitiveData[] => {
  switch (node.kind) {
    case 'cube':
      return compileGltfCubePrimitiveData(document, node, options);
    case 'plane':
      return compileGltfPlanePrimitiveData(document, node, options);
    case 'bone':
    case 'locator':
      return [];
  }
};

export const identityMat4 = (): Mat4 => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

export const trsMat4 = (
  t: readonly [number, number, number],
  q: readonly [number, number, number, number],
  s: readonly [number, number, number],
): number[] => {
  const [x, y, z, w] = q;
  const x2 = x + x;
  const y2 = y + y;
  const z2 = z + z;
  const xx = x * x2;
  const xy = x * y2;
  const xz = x * z2;
  const yy = y * y2;
  const yz = y * z2;
  const zz = z * z2;
  const wx = w * x2;
  const wy = w * y2;
  const wz = w * z2;
  return [
    (1 - (yy + zz)) * s[0],
    (xy + wz) * s[0],
    (xz - wy) * s[0],
    0,
    (xy - wz) * s[1],
    (1 - (xx + zz)) * s[1],
    (yz + wx) * s[1],
    0,
    (xz + wy) * s[2],
    (yz - wx) * s[2],
    (1 - (xx + yy)) * s[2],
    0,
    t[0],
    t[1],
    t[2],
    1,
  ];
};

export const multiplyMat4 = (a: Mat4, b: Mat4): number[] => {
  const out = new Array<number>(16);
  for (let col = 0; col < 4; col += 1) {
    const b0 = b[col * 4]!;
    const b1 = b[col * 4 + 1]!;
    const b2 = b[col * 4 + 2]!;
    const b3 = b[col * 4 + 3]!;
    for (let row = 0; row < 4; row += 1) {
      out[col * 4 + row] = a[row]! * b0 + a[4 + row]! * b1 + a[8 + row]! * b2 + a[12 + row]! * b3;
    }
  }
  return out;
};

const upper3x3Cofactors = (m: Mat4) => {
  const a00 = m[0]!;
  const a10 = m[1]!;
  const a20 = m[2]!;
  const a01 = m[4]!;
  const a11 = m[5]!;
  const a21 = m[6]!;
  const a02 = m[8]!;
  const a12 = m[9]!;
  const a22 = m[10]!;
  const c00 = a11 * a22 - a12 * a21;
  const c01 = a02 * a21 - a01 * a22;
  const c02 = a01 * a12 - a02 * a11;
  const c10 = a12 * a20 - a10 * a22;
  const c11 = a00 * a22 - a02 * a20;
  const c12 = a02 * a10 - a00 * a12;
  const c20 = a10 * a21 - a11 * a20;
  const c21 = a01 * a20 - a00 * a21;
  const c22 = a00 * a11 - a01 * a10;
  const det = a00 * c00 + a01 * c10 + a02 * c20;
  return { c00, c01, c02, c10, c11, c12, c20, c21, c22, det };
};

export const invertAffineMat4 = (m: Mat4): number[] => {
  const c = upper3x3Cofactors(m);
  if (Math.abs(c.det) <= 1e-12) return [...identityMat4()];
  const d = 1 / c.det;
  const tx = m[12]!;
  const ty = m[13]!;
  const tz = m[14]!;
  return [
    c.c00 * d,
    c.c10 * d,
    c.c20 * d,
    0,
    c.c01 * d,
    c.c11 * d,
    c.c21 * d,
    0,
    c.c02 * d,
    c.c12 * d,
    c.c22 * d,
    0,
    -(c.c00 * tx + c.c01 * ty + c.c02 * tz) * d,
    -(c.c10 * tx + c.c11 * ty + c.c12 * tz) * d,
    -(c.c20 * tx + c.c21 * ty + c.c22 * tz) * d,
    1,
  ];
};

export const transformPrimitiveByWorldMat4 = (
  primitive: GltfPrimitiveData,
  world: Mat4,
  jointId: string | null,
): GltfPrimitiveData & { jointId: string | null } => {
  const cof = upper3x3Cofactors(world);
  const sign = cof.det < 0 ? -1 : 1;
  const positions: number[] = [];
  const normals: number[] = [];
  for (let i = 0; i < primitive.positions.length; i += 3) {
    const px = primitive.positions[i]!;
    const py = primitive.positions[i + 1]!;
    const pz = primitive.positions[i + 2]!;
    positions.push(
      world[0]! * px + world[4]! * py + world[8]! * pz + world[12]!,
      world[1]! * px + world[5]! * py + world[9]! * pz + world[13]!,
      world[2]! * px + world[6]! * py + world[10]! * pz + world[14]!,
    );
    const nx = primitive.normals[i]!;
    const ny = primitive.normals[i + 1]!;
    const nz = primitive.normals[i + 2]!;
    const rnx = (cof.c00 * nx + cof.c10 * ny + cof.c20 * nz) * sign;
    const rny = (cof.c01 * nx + cof.c11 * ny + cof.c21 * nz) * sign;
    const rnz = (cof.c02 * nx + cof.c12 * ny + cof.c22 * nz) * sign;
    const len = Math.hypot(rnx, rny, rnz);
    if (len <= 1e-6) normals.push(0, 1, 0);
    else normals.push(rnx / len, rny / len, rnz / len);
  }
  const indices = [...primitive.indices];
  if (cof.det < 0) {
    for (let i = 0; i + 2 < indices.length; i += 3) {
      const tmp = indices[i + 1]!;
      indices[i + 1] = indices[i + 2]!;
      indices[i + 2] = tmp;
    }
  }
  return {
    positions,
    normals,
    ...(primitive.uvs ? { uvs: primitive.uvs } : {}),
    ...(primitive.material === undefined ? {} : { material: primitive.material }),
    indices,
    jointId,
  };
};

const findDrivingJointId = (
  document: ProjectDocument,
  node: SceneNode,
  animated: ReadonlySet<string>,
): string | null => {
  let cur: SceneNode | undefined = node;
  while (cur) {
    if (cur.kind === 'bone' || animated.has(cur.id)) return cur.id;
    cur = cur.parentId ? document.scene.nodes[cur.parentId] : undefined;
  }
  return null;
};

const batchKey = (material: number | undefined, hasUvs: boolean): string =>
  `${material ?? 'none'}:${hasUvs ? 'uv' : 'plain'}`;

const compareBatches = (left: PrimitiveBatch, right: PrimitiveBatch): number =>
  (left.material ?? -1) - (right.material ?? -1) || Number(left.hasUvs) - Number(right.hasUvs);

export const appendNumbers = (dst: number[], src: readonly number[]): void => {
  for (let i = 0; i < src.length; i += 1) dst.push(src[i]!);
};

const mergeBatch = (
  batch: PrimitiveBatch,
  jointIndexById: ReadonlyMap<string, number> | undefined,
): MergedGroup => {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const joints: number[] = [];
  const indices: number[] = [];
  for (const prim of batch.primitives) {
    const base = positions.length / 3;
    appendNumbers(positions, prim.positions);
    appendNumbers(normals, prim.normals);
    if (batch.hasUvs && prim.uvs) appendNumbers(uvs, prim.uvs);
    if (jointIndexById && prim.jointId !== undefined && prim.jointId !== null) {
      const jointIdx = jointIndexById.get(prim.jointId)!;
      const vCount = prim.positions.length / 3;
      for (let v = 0; v < vCount; v += 1) joints.push(jointIdx);
    }
    for (let i = 0; i < prim.indices.length; i += 1) indices.push(base + prim.indices[i]!);
  }
  return {
    positions,
    normals,
    ...(batch.hasUvs ? { uvs } : {}),
    ...(jointIndexById ? { joints } : {}),
    material: batch.material,
    indices,
  };
};

const buildMergedGroups = (
  primitives: readonly (GltfPrimitiveData & { jointId: string | null })[],
  jointIndexById: ReadonlyMap<string, number> | undefined,
): MergedGroup[] => {
  const byKey = new Map<string, PrimitiveBatch>();
  for (const prim of primitives) {
    const hasUvs = prim.uvs !== undefined;
    const key = batchKey(prim.material, hasUvs);
    const batch = byKey.get(key) ?? { material: prim.material, hasUvs, primitives: [] };
    batch.primitives.push(prim);
    byKey.set(key, batch);
  }
  return [...byKey.values()].sort(compareBatches).map((batch) => mergeBatch(batch, jointIndexById));
};

const compileQuantizedGroups = (
  groups: readonly MergedGroup[],
  options: GltfSceneCompileOptions,
): {
  readonly primitives: ReturnType<typeof compileGltfPrimitive>[];
  readonly bounds: PositionBounds;
} => {
  const bounds = computePositionsBounds(groups.map((group) => group.positions));
  const quantize = options.writer.isQuantized;
  const primitives = groups.map((group) => {
    const positions = quantize
      ? normalizePositionsWithBounds(group.positions, bounds)
      : group.positions;
    return compileGltfPrimitive(
      options.writer,
      positions,
      group.normals,
      group.uvs,
      group.joints,
      group.material,
      group.indices,
    );
  });
  return { primitives, bounds };
};

const findCommonSkeletonNode = (
  document: ProjectDocument,
  usedJointIds: readonly string[],
  nodeIndexById: ReadonlyMap<string, number>,
): number | undefined => {
  if (usedJointIds.length === 0) return undefined;
  const chains = usedJointIds.map((id) => {
    const path: string[] = [];
    let cur: SceneNode | undefined = document.scene.nodes[id];
    while (cur) {
      path.push(cur.id);
      cur = cur.parentId ? document.scene.nodes[cur.parentId] : undefined;
    }
    return path.reverse();
  });
  let common: string | undefined;
  const minLen = Math.min(...chains.map((chain) => chain.length));
  for (let depth = 0; depth < minLen; depth += 1) {
    const candidate = chains[0]![depth]!;
    if (chains.every((chain) => chain[depth] === candidate)) common = candidate;
    else break;
  }
  return common === undefined ? undefined : nodeIndexById.get(common);
};

const buildSkinForMesh = (
  document: ProjectDocument,
  usedJointIds: readonly string[],
  nodeIndexById: ReadonlyMap<string, number>,
  worldMatrixById: ReadonlyMap<string, Mat4>,
  bounds: PositionBounds,
  options: GltfSceneCompileOptions,
): GltfSkin => {
  const dequantMat = options.writer.isQuantized
    ? trsMat4([...bounds.center], [0, 0, 0, 1], [...bounds.halfExtent])
    : undefined;
  const ibmFloats: number[] = [];
  const joints: number[] = [];
  for (const id of usedJointIds) {
    joints.push(nodeIndexById.get(id)!);
    const invWorld = invertAffineMat4(worldMatrixById.get(id)!);
    const ibm = dequantMat ? multiplyMat4(invWorld, dequantMat) : invWorld;
    appendNumbers(ibmFloats, ibm);
  }
  const skeleton = findCommonSkeletonNode(document, usedJointIds, nodeIndexById);
  return {
    name: `${document.name}_skin`,
    joints,
    ...(skeleton === undefined ? {} : { skeleton }),
    inverseBindMatrices: options.writer.addFloatMatrixAccessor(ibmFloats),
  };
};

export const compileMergedModelGltf = (
  document: ProjectDocument,
  orderedNodes: readonly SceneNode[],
  worldMatrixById: ReadonlyMap<string, Mat4>,
  nodeIndexById: ReadonlyMap<string, number>,
  animated: ReadonlySet<string>,
  options: GltfSceneCompileOptions,
): CompiledModelGltf => {
  const allPrimitives: Array<GltfPrimitiveData & { jointId: string | null }> = [];
  for (const node of orderedNodes) {
    if (node.kind !== 'cube' && node.kind !== 'plane') continue;
    const world = worldMatrixById.get(node.id)!;
    const jointId = animated.size > 0 ? findDrivingJointId(document, node, animated) : null;
    for (const source of primitiveDataForGltfNode(document, node, options)) {
      allPrimitives.push(transformPrimitiveByWorldMat4(source, world, jointId));
    }
  }
  const meshes: GltfMesh[] = [];
  const skins: GltfSkin[] = [];
  const meshNodes: GltfNode[] = [];
  const skinnedSource = allPrimitives.filter((p) => p.jointId !== null);
  const staticSource = allPrimitives.filter((p) => p.jointId === null);

  if (skinnedSource.length > 0) {
    const usedSet = new Set(skinnedSource.map((p) => p.jointId!));
    const usedJointIds = orderedNodes.filter((n) => usedSet.has(n.id)).map((n) => n.id);
    const jointIndexById = new Map(usedJointIds.map((id, idx) => [id, idx]));
    const groups = buildMergedGroups(skinnedSource, jointIndexById);
    const { primitives, bounds } = compileQuantizedGroups(groups, options);
    const skinIdx = skins.length;
    skins.push(
      buildSkinForMesh(document, usedJointIds, nodeIndexById, worldMatrixById, bounds, options),
    );
    const meshIdx = meshes.length;
    meshes.push({ name: `${document.name}_skinned`, primitives });
    meshNodes.push({ name: `${document.name}_mesh`, mesh: meshIdx, skin: skinIdx });
  }
  if (staticSource.length > 0) {
    const groups = buildMergedGroups(staticSource, undefined);
    const { primitives, bounds } = compileQuantizedGroups(groups, options);
    const meshIdx = meshes.length;
    meshes.push({ name: `${document.name}_static`, primitives });
    meshNodes.push({
      name: `${document.name}_static`,
      mesh: meshIdx,
      ...(options.writer.isQuantized
        ? { translation: [...bounds.center], scale: [...bounds.halfExtent] }
        : {}),
    });
  }
  return { meshes, skins, meshNodes };
};
