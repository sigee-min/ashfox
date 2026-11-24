import type { ProjectDocument, SceneNode, Vec3 } from '../../../model';
import { cubeGeometryRotation } from '../../../model';
import { compileGltfCubePrimitiveData } from './cube';
import { compileGltfPlanePrimitiveData } from './plane';
import { compileGltfPrimitive } from './primitive';
import type { GltfPrimitiveData } from './data';
import { quaternionFromEuler, rotateVec3ByQuaternion } from './spatial';
import type { GltfSceneCompileOptions } from './graph';
import type { GltfMesh } from './contract';

interface PrimitiveBatch {
  material: number | undefined;
  hasUvs: boolean;
  primitives: GltfPrimitiveData[];
}

/** A canonical plane basis already maps its chart into model space.  Its
 * transform rotation is a basis-less lowering hint for consumers that cannot
 * read the basis and must never be applied a second time by glTF. */
export const gltfNodeGeometryRotation = (node: SceneNode): Vec3 =>
  node.kind === 'plane' && node.basis !== undefined
    ? [0, 0, 0]
    : node.kind === 'cube'
      ? cubeGeometryRotation(node)
      : node.transform.rotation;

export interface CompiledRigidBatches {
  meshes: GltfMesh[];
  meshIndexByOwnerId: ReadonlyMap<string, number>;
}

const animatedNodeIds = (document: ProjectDocument): ReadonlySet<string> =>
  new Set(
    Object.values(document.animations).flatMap((clip) =>
      Object.values(clip.channels).map((channel) => channel.targetNodeId),
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

const normalize = (value: Vec3): [number, number, number] => {
  const length = Math.hypot(value[0], value[1], value[2]);
  return length <= 0.000001 ? [0, 1, 0] : [value[0] / length, value[1] / length, value[2] / length];
};

const inverseScaledNormal = (normal: number, scale: number): number =>
  Math.abs(scale) <= 0.000001 ? 0 : normal / scale;

const flipTriangleWinding = (indices: readonly number[]): number[] => {
  const result = [...indices];
  for (let index = 0; index + 2 < result.length; index += 3) {
    const second = result[index + 1];
    result[index + 1] = result[index + 2];
    result[index + 2] = second;
  }
  return result;
};

export const bakeGltfPrimitiveToParent = (
  node: SceneNode,
  translation: Vec3,
  primitive: GltfPrimitiveData,
): GltfPrimitiveData => {
  const rotation = quaternionFromEuler(gltfNodeGeometryRotation(node));
  const scale = node.transform.scale;
  const positions: number[] = [];
  const normals: number[] = [];
  for (let offset = 0; offset < primitive.positions.length; offset += 3) {
    const position = rotateVec3ByQuaternion(
      [
        primitive.positions[offset] * scale[0],
        primitive.positions[offset + 1] * scale[1],
        primitive.positions[offset + 2] * scale[2],
      ],
      rotation,
    );
    positions.push(
      position[0] + translation[0],
      position[1] + translation[1],
      position[2] + translation[2],
    );
    const normal = normalize(
      rotateVec3ByQuaternion(
        [
          inverseScaledNormal(primitive.normals[offset], scale[0]),
          inverseScaledNormal(primitive.normals[offset + 1], scale[1]),
          inverseScaledNormal(primitive.normals[offset + 2], scale[2]),
        ],
        rotation,
      ),
    );
    normals.push(...normal);
  }
  return {
    positions,
    normals,
    ...(primitive.uvs ? { uvs: primitive.uvs } : {}),
    ...(primitive.material === undefined ? {} : { material: primitive.material }),
    indices:
      scale[0] * scale[1] * scale[2] < 0
        ? flipTriangleWinding(primitive.indices)
        : primitive.indices,
    ...(primitive.sourceNodeId === undefined ? {} : { sourceNodeId: primitive.sourceNodeId }),
  };
};

const batchKey = (material: number | undefined, hasUvs: boolean): string =>
  `${material ?? 'none'}:${hasUvs ? 'uv' : 'plain'}`;

const compareBatches = (left: PrimitiveBatch, right: PrimitiveBatch): number =>
  (left.material ?? -1) - (right.material ?? -1) || Number(left.hasUvs) - Number(right.hasUvs);

const appendNodePrimitives = (
  document: ProjectDocument,
  node: SceneNode,
  animated: ReadonlySet<string>,
  restTranslationById: ReadonlyMap<string, Vec3>,
  options: GltfSceneCompileOptions,
  batchesByOwner: Map<string, Map<string, PrimitiveBatch>>,
): void => {
  if (node.kind !== 'cube' && node.kind !== 'plane') return;
  const ownerId = node.parentId !== null && !animated.has(node.id) ? node.parentId : node.id;
  const ownerBatches = batchesByOwner.get(ownerId) ?? new Map<string, PrimitiveBatch>();
  const bake = ownerId !== node.id;
  const translation = restTranslationById.get(node.id) ?? [0, 0, 0];
  for (const source of primitiveDataForGltfNode(document, node, options)) {
    const authoredSource = { ...source, sourceNodeId: node.id };
    const primitive = bake
      ? bakeGltfPrimitiveToParent(node, translation, authoredSource)
      : authoredSource;
    const key = batchKey(primitive.material, primitive.uvs !== undefined);
    const batch = ownerBatches.get(key) ?? {
      material: primitive.material,
      hasUvs: primitive.uvs !== undefined,
      primitives: [],
    };
    batch.primitives.push(primitive);
    ownerBatches.set(key, batch);
  }
  batchesByOwner.set(ownerId, ownerBatches);
};

const compileBatchMesh = (
  owner: SceneNode,
  batches: ReadonlyMap<string, PrimitiveBatch>,
  options: GltfSceneCompileOptions,
): GltfMesh => {
  const primitives = [...batches.values()]
    .sort(compareBatches)
    .flatMap((batch) =>
      batch.primitives.map((primitive) =>
        compileGltfPrimitive(
          options.writer,
          primitive.positions,
          primitive.normals,
          primitive.uvs,
          primitive.joints,
          primitive.material,
          primitive.indices,
          primitive.sourceNodeId === undefined
            ? undefined
            : { ashfoxSourceNodeId: primitive.sourceNodeId },
        ),
      ),
    );
  return { name: `${owner.name} rigid batch`, primitives };
};

export const compileRigidGltfBatches = (
  document: ProjectDocument,
  orderedNodes: readonly SceneNode[],
  restTranslationById: ReadonlyMap<string, Vec3>,
  options: GltfSceneCompileOptions,
): CompiledRigidBatches => {
  const animated = animatedNodeIds(document);
  const batchesByOwner = new Map<string, Map<string, PrimitiveBatch>>();
  for (const node of orderedNodes) {
    appendNodePrimitives(document, node, animated, restTranslationById, options, batchesByOwner);
  }

  const meshes: GltfMesh[] = [];
  const meshIndexByOwnerId = new Map<string, number>();
  for (const owner of orderedNodes) {
    const batches = batchesByOwner.get(owner.id);
    if (!batches || batches.size === 0) continue;
    meshIndexByOwnerId.set(owner.id, meshes.length);
    meshes.push(compileBatchMesh(owner, batches, options));
  }
  return { meshes, meshIndexByOwnerId };
};
