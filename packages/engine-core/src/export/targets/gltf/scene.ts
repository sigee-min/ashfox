import { compareText } from '../../../stableOrder';
import type { ProjectDocument, SceneNode } from '../../../model';
import {
  boneTransformMatchesCanonicalFrame,
  cubeGeometryPivot,
  isCanonicalBoneFrame,
} from '../../../model';
import { effectivelyVisibleSceneNodeIds } from '../../../sceneVisibility';
import { compileOpaqueCubeFaceOcclusion } from '../../occlusion/cube';
import {
  animatedNodeIds,
  compileMergedModelGltf,
  gltfNodeGeometryRotation,
  identityMat4,
  multiplyMat4,
  trsMat4,
  type Mat4,
} from './rigid';
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

export const restTranslation = (
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

const createGltfNode = (
  node: SceneNode,
  translation: [number, number, number],
  compactExtras: boolean,
): GltfNode => {
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
    extras: compactExtras
      ? {
          ashfoxId: node.id,
          ...(!node.visible ? { visible: false } : {}),
          ...(node.tags ? { ashfoxTags: [...node.tags] } : {}),
        }
      : {
          ashfoxId: node.id,
          ashfoxKind: node.kind,
          visible: node.visible,
          ...(node.tags ? { ashfoxTags: [...node.tags] } : {}),
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

export const computeWorldMatrices = (
  orderedNodes: readonly SceneNode[],
  restTranslationById: ReadonlyMap<string, [number, number, number]>,
  restRotationById: ReadonlyMap<string, [number, number, number]>,
  restScaleById: ReadonlyMap<string, [number, number, number]>,
): Map<string, Mat4> => {
  const byId = new Map<string, SceneNode>(orderedNodes.map((n) => [n.id, n]));
  const worldById = new Map<string, Mat4>();
  const resolve = (id: string): Mat4 => {
    const hit = worldById.get(id);
    if (hit) return hit;
    const node = byId.get(id);
    if (!node) return identityMat4();
    const rot = restRotationById.get(id) ?? [0, 0, 0];
    const quat = isIdentityRotation(rot) ? ([0, 0, 0, 1] as const) : quaternionFromEuler(rot);
    const local = trsMat4(
      restTranslationById.get(id) ?? [0, 0, 0],
      quat,
      restScaleById.get(id) ?? [1, 1, 1],
    );
    const world =
      node.parentId && byId.has(node.parentId)
        ? multiplyMat4(resolve(node.parentId), local)
        : local;
    worldById.set(id, world);
    return world;
  };
  for (const node of orderedNodes) resolve(node.id);
  return worldById;
};

const selectKeptNodeIds = (
  document: ProjectDocument,
  orderedNodes: readonly SceneNode[],
  animated: ReadonlySet<string>,
): ReadonlySet<string> => {
  const kept = new Set<string>();
  const isAnim = animated.size > 0;
  for (const node of orderedNodes) {
    const keepLeaf =
      node.kind === 'bone' || node.kind === 'locator' || (isAnim && animated.has(node.id));
    if (!keepLeaf) continue;
    let cur: SceneNode | undefined = node;
    while (cur && !kept.has(cur.id)) {
      kept.add(cur.id);
      cur = cur.parentId ? document.scene.nodes[cur.parentId] : undefined;
    }
  }
  return kept;
};

const linkGltfHierarchy = (
  keptNodes: readonly SceneNode[],
  nodes: GltfNode[],
  nodeIndexById: ReadonlyMap<string, number>,
): void => {
  for (const node of keptNodes) {
    if (node.parentId === null) continue;
    const parentIndex = nodeIndexById.get(node.parentId);
    const childIndex = nodeIndexById.get(node.id);
    if (parentIndex === undefined || childIndex === undefined) continue;
    const parentNode = nodes[parentIndex]!;
    parentNode.children = [...(parentNode.children ?? []), childIndex];
  }
};

export const compileGltfScene = (
  document: ProjectDocument,
  options: GltfSceneCompileOptions,
): GltfCompiledScene => {
  const visibleNodeIds = effectivelyVisibleSceneNodeIds(document);
  const orderedNodes = Object.values(document.scene.nodes)
    .filter((node) => visibleNodeIds.has(node.id))
    .sort((left, right) => compareText(left.id, right.id));
  const restTranslationById = new Map<string, [number, number, number]>();
  const restRotationById = new Map<string, [number, number, number]>();
  const restScaleById = new Map<string, [number, number, number]>();
  for (const node of orderedNodes) {
    assertValidCanonicalBone(node);
    restTranslationById.set(node.id, restTranslation(document, node, options.unitScale));
    restRotationById.set(node.id, [...gltfNodeGeometryRotation(node)]);
    restScaleById.set(node.id, [...node.transform.scale]);
  }
  const worldMatrixById = computeWorldMatrices(
    orderedNodes,
    restTranslationById,
    restRotationById,
    restScaleById,
  );
  const animated = animatedNodeIds(document);
  const keptSet = selectKeptNodeIds(document, orderedNodes, animated);
  const keptNodes = orderedNodes.filter((n) => keptSet.has(n.id));
  const nodes: GltfNode[] = [];
  const nodeIndexById = new Map<string, number>();
  for (const node of keptNodes) {
    nodeIndexById.set(node.id, nodes.length);
    nodes.push(createGltfNode(node, restTranslationById.get(node.id)!, options.writer.isQuantized));
  }
  linkGltfHierarchy(keptNodes, nodes, nodeIndexById);
  const rootNodeIndices = document.scene.roots
    .map((id) => nodeIndexById.get(id))
    .filter((index): index is number => index !== undefined);

  const compiled = compileMergedModelGltf(
    document,
    orderedNodes,
    worldMatrixById,
    nodeIndexById,
    animated,
    { ...options, cubeFaceOcclusion: compileOpaqueCubeFaceOcclusion(document) },
  );
  for (const meshNode of compiled.meshNodes) {
    rootNodeIndices.push(nodes.length);
    nodes.push(meshNode);
  }
  return {
    nodes,
    meshes: compiled.meshes,
    skins: compiled.skins,
    rootNodeIndices,
    nodeIndexById,
    restTranslationById,
    restRotationById,
    restScaleById,
  };
};
