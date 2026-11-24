import type { ProjectDocument, SceneNode } from '../../../model';
import {
  boneTransformMatchesCanonicalFrame,
  cubeGeometryPivot,
  isCanonicalBoneFrame,
} from '../../../model';
import { effectivelyVisibleSceneNodeIds } from '../../../sceneVisibility';
import { compileOpaqueCubeFaceOcclusion } from '../../occlusion/cube';
import { compileRigidGltfBatches, gltfNodeGeometryRotation } from './rigid';
import {
  addVec3,
  isIdentityRotation,
  isIdentityScale,
  multiplyVec3,
  quaternionFromEuler,
  subtractVec3,
} from './spatial';
import type { GltfCompiledScene, GltfSceneCompileOptions } from './graph';
import type { GltfNode } from './contract';

export type { GltfCompiledScene, GltfSceneCompileOptions } from './graph';

const parentOrigin = (document: ProjectDocument, node: SceneNode): [number, number, number] => {
  if (node.parentId === null) return [0, 0, 0];
  const parent = document.scene.nodes[node.parentId];
  if (!parent || parent.kind !== 'bone') return [0, 0, 0];
  return addVec3(parent.transform.pivot, parent.transform.position);
};

const restTranslation = (
  document: ProjectDocument,
  node: SceneNode,
  unitScale: number,
): [number, number, number] => {
  if (node.kind === 'locator') {
    return multiplyVec3(node.transform.position, unitScale);
  }
  const geometryPivot = node.kind === 'cube' ? cubeGeometryPivot(node) : node.transform.pivot;
  const origin = addVec3(geometryPivot, node.transform.position);
  return multiplyVec3(subtractVec3(origin, parentOrigin(document, node)), unitScale);
};

const createGltfNode = (node: SceneNode, translation: [number, number, number]): GltfNode => {
  const rotation = gltfNodeGeometryRotation(node);
  return {
    name: node.name,
    ...(translation.some((value) => Math.abs(value) > 0.000001) ? { translation } : {}),
    ...(!isIdentityRotation(rotation) ? { rotation: quaternionFromEuler(rotation) } : {}),
    ...(!isIdentityScale(node.transform.scale)
      ? {
          scale: [node.transform.scale[0], node.transform.scale[1], node.transform.scale[2]] as [
            number,
            number,
            number,
          ],
        }
      : {}),
    extras: {
      ashfoxId: node.id,
      ashfoxKind: node.kind,
      visible: node.visible,
      ...(node.tags ? { ashfoxTags: [...node.tags] } : {}),
      ...(node.kind === 'bone' && node.canonicalFrame !== undefined
        ? {
            ashfoxCanonicalFrame: node.canonicalFrame,
          }
        : {}),
    },
  };
};

const assertValidCanonicalBone = (node: SceneNode): void => {
  if (
    node.kind === 'bone' &&
    node.canonicalFrame !== undefined &&
    (!isCanonicalBoneFrame(node.canonicalFrame) || !boneTransformMatchesCanonicalFrame(node))
  ) {
    throw new RangeError(`Bone ${node.id} has an invalid canonical frame.`);
  }
};

const linkGltfHierarchy = (
  orderedNodes: readonly SceneNode[],
  nodes: GltfNode[],
  nodeIndexById: ReadonlyMap<string, number>,
): void => {
  for (const node of orderedNodes) {
    if (node.parentId === null) continue;
    const parentIndex = nodeIndexById.get(node.parentId);
    const childIndex = nodeIndexById.get(node.id);
    if (parentIndex === undefined || childIndex === undefined) continue;
    const parentNode = nodes[parentIndex];
    parentNode.children = [...(parentNode.children ?? []), childIndex];
  }
};

export const compileGltfScene = (
  document: ProjectDocument,
  options: GltfSceneCompileOptions,
): GltfCompiledScene => {
  const nodes: GltfNode[] = [];
  const nodeIndexById = new Map<string, number>();
  const restTranslationById = new Map<string, [number, number, number]>();
  const restRotationById = new Map<string, [number, number, number]>();
  const restScaleById = new Map<string, [number, number, number]>();
  const visibleNodeIds = effectivelyVisibleSceneNodeIds(document);
  const orderedNodes = Object.values(document.scene.nodes)
    .filter((node) => visibleNodeIds.has(node.id))
    .sort((left, right) => left.id.localeCompare(right.id));
  const compileOptions: GltfSceneCompileOptions = {
    ...options,
    cubeFaceOcclusion: compileOpaqueCubeFaceOcclusion(document),
  };

  for (const node of orderedNodes) {
    assertValidCanonicalBone(node);
    const translation = restTranslation(document, node, options.unitScale);
    nodeIndexById.set(node.id, nodes.length);
    restTranslationById.set(node.id, translation);
    restRotationById.set(node.id, [...gltfNodeGeometryRotation(node)]);
    restScaleById.set(node.id, [...node.transform.scale]);
    nodes.push(createGltfNode(node, translation));
  }

  const compiledBatches = compileRigidGltfBatches(
    document,
    orderedNodes,
    restTranslationById,
    compileOptions,
  );
  for (const [ownerId, mesh] of compiledBatches.meshIndexByOwnerId) {
    const nodeIndex = nodeIndexById.get(ownerId);
    if (nodeIndex !== undefined) nodes[nodeIndex].mesh = mesh;
  }
  linkGltfHierarchy(orderedNodes, nodes, nodeIndexById);

  const rootNodeIndices = document.scene.roots
    .map((id) => nodeIndexById.get(id))
    .filter((index): index is number => index !== undefined);

  return {
    nodes,
    meshes: compiledBatches.meshes,
    skins: [],
    rootNodeIndices,
    nodeIndexById,
    restTranslationById,
    restRotationById,
    restScaleById,
  };
};
