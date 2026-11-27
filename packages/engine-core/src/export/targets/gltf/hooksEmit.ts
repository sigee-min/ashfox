import type { CompiledAnchor, HooksDocument } from '../../../hooks/contract';
import type { GltfDocument, GltfNode } from './contract';
import { identityMat4, invertAffineMat4, multiplyMat4, trsMat4, type Mat4 } from './rigid';
import { isIdentityRotation, quaternionFromEuler } from './spatial';

export interface AppendHooksGltfOptions {
  readonly unitScale: number;
  readonly offset?: readonly [number, number, number];
}

const buildBoneIndexMap = (nodes: readonly GltfNode[]): ReadonlyMap<string, number> => {
  const byId = new Map<string, number>();
  nodes.forEach((node, index) => {
    const id = node.extras?.ashfoxId;
    if (id && (node.extras?.ashfoxKind === undefined || node.extras.ashfoxKind === 'bone')) {
      byId.set(id, index);
    }
  });
  return byId;
};

const computeWorldMatrices = (nodes: readonly GltfNode[], roots: readonly number[]): Mat4[] => {
  const world: Mat4[] = nodes.map(() => identityMat4());
  const stack: { idx: number; parent: Mat4 }[] = roots.map((idx) => ({
    idx,
    parent: identityMat4(),
  }));
  while (stack.length > 0) {
    const { idx, parent } = stack.pop()!;
    const node = nodes[idx];
    if (!node) continue;
    const local = trsMat4(
      node.translation ?? [0, 0, 0],
      node.rotation ?? [0, 0, 0, 1],
      node.scale ?? [1, 1, 1],
    );
    const mat = multiplyMat4(parent, local);
    world[idx] = mat;
    for (const child of node.children ?? []) stack.push({ idx: child, parent: mat });
  }
  return world;
};

const normCol = (x: number, y: number, z: number): [number, number, number] => {
  const len = Math.hypot(x, y, z) || 1;
  return [x / len, y / len, z / len];
};

const quatFromMat4 = (m: Mat4): [number, number, number, number] => {
  const [m00, m10, m20] = normCol(m[0]!, m[1]!, m[2]!);
  const [m01, m11, m21] = normCol(m[4]!, m[5]!, m[6]!);
  const [m02, m12, m22] = normCol(m[8]!, m[9]!, m[10]!);
  const trace = m00 + m11 + m22;
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1);
    return [(m21 - m12) * s, (m02 - m20) * s, (m10 - m01) * s, 0.25 / s];
  }
  if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
    return [0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s];
  }
  if (m11 > m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
    return [(m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s];
  }
  const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
  return [(m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s];
};

const localPoseForAnchor = (
  anchor: CompiledAnchor,
  unitScale: number,
  offset: readonly [number, number, number],
  boneWorldMat: Mat4 | undefined,
): {
  readonly translation: [number, number, number];
  readonly rotation?: [number, number, number, number];
} => {
  const worldPos: [number, number, number] = [
    anchor.position[0] * unitScale + (boneWorldMat ? 0 : offset[0]),
    anchor.position[1] * unitScale + (boneWorldMat ? 0 : offset[1]),
    anchor.position[2] * unitScale + (boneWorldMat ? 0 : offset[2]),
  ];
  const worldRot: [number, number, number] = [
    anchor.rotation[0],
    anchor.rotation[1],
    anchor.rotation[2],
  ];
  if (!boneWorldMat) {
    return {
      translation: worldPos,
      ...(!isIdentityRotation(worldRot) ? { rotation: quaternionFromEuler(worldRot) } : {}),
    };
  }
  const worldMat = trsMat4(worldPos, quaternionFromEuler(worldRot), [1, 1, 1]);
  const localMat = multiplyMat4(invertAffineMat4(boneWorldMat), worldMat);
  const quat = quatFromMat4(localMat);
  const hasRot = Math.abs(quat[0]) + Math.abs(quat[1]) + Math.abs(quat[2]) > 1e-6;
  return {
    translation: [localMat[12]!, localMat[13]!, localMat[14]!],
    ...(hasRot ? { rotation: quat } : {}),
  };
};

const createAnchorEmptyNode = (
  anchor: CompiledAnchor,
  unitScale: number,
  offset: readonly [number, number, number],
  boneWorldMat: Mat4 | undefined,
): GltfNode => {
  const pose = localPoseForAnchor(anchor, unitScale, offset, boneWorldMat);
  const hasTranslation = pose.translation.some((v) => Math.abs(v) > 1e-6);
  return {
    name: `anchor_${anchor.id}`,
    ...(hasTranslation ? { translation: pose.translation } : {}),
    ...(pose.rotation ? { rotation: pose.rotation } : {}),
    extras: {
      ashfox: {
        hook: {
          kind: 'anchor',
          id: anchor.id,
          schema: anchor.schema,
          normal: anchor.normal,
          ...(anchor.mcBlock ? { mcBlock: anchor.mcBlock } : {}),
          props: anchor.props,
        },
      },
    },
  };
};

const attachNodeChild = (
  nodes: GltfNode[],
  scenes: GltfDocument['scenes'],
  parentIdx: number | undefined,
  childIdx: number,
): void => {
  if (parentIdx !== undefined && nodes[parentIdx]) {
    const parent = nodes[parentIdx]!;
    nodes[parentIdx] = { ...parent, children: [...(parent.children ?? []), childIdx] };
    return;
  }
  const primaryRoot = scenes[0]?.nodes[0];
  if (primaryRoot !== undefined && nodes[primaryRoot]) {
    const root = nodes[primaryRoot]!;
    nodes[primaryRoot] = { ...root, children: [...(root.children ?? []), childIdx] };
    return;
  }
  if (scenes[0]) scenes[0] = { ...scenes[0], nodes: [...scenes[0].nodes, childIdx] };
};

const attachRootHooksExtras = (
  nodes: GltfNode[],
  scenes: GltfDocument['scenes'],
  hooks: HooksDocument,
): void => {
  const rootIdx = scenes[0]?.nodes[0];
  const rootNode = rootIdx !== undefined ? nodes[rootIdx] : undefined;
  if (!rootNode || rootIdx === undefined) return;
  nodes[rootIdx] = {
    ...rootNode,
    extras: {
      ...(rootNode.extras ?? {}),
      ashfox: { ...(rootNode.extras?.ashfox ?? {}), hooks },
    },
  };
};

const hasGlbHookItems = (hooks: HooksDocument | undefined): hooks is HooksDocument =>
  Boolean(
    hooks &&
    (hooks.schemas.length > 0 ||
      hooks.anchors.length > 0 ||
      hooks.volumes.length > 0 ||
      hooks.cues.length > 0 ||
      hooks.meta.length > 0 ||
      hooks.zones.length > 0),
  );

/**
 * Append `anchor_<id>` Empty Nodes and canonical `extras.ashfox.hooks` to a glTF document.
 * Preserves existing geometry meshes, draw calls, and extensions untouched.
 */
export const appendHooksToGltfDocument = <T extends GltfDocument>(
  document: T,
  hooks: HooksDocument | undefined,
  options: AppendHooksGltfOptions,
): T => {
  if (!hasGlbHookItems(hooks)) return document;
  const nodes = document.nodes.map((n) => ({
    ...n,
    ...(n.children ? { children: [...n.children] } : {}),
  }));
  const scenes = document.scenes.map((s) => ({ ...s, nodes: [...s.nodes] }));
  const boneMap = buildBoneIndexMap(nodes);
  const worldMats = computeWorldMatrices(nodes, scenes[0]?.nodes ?? []);
  const offset = options.offset ?? [0, 0, 0];
  for (const anchor of hooks.anchors) {
    const boneIdx = anchor.bone ? boneMap.get(anchor.bone) : undefined;
    const boneWorld = boneIdx !== undefined ? worldMats[boneIdx] : undefined;
    const emptyIdx =
      nodes.push(createAnchorEmptyNode(anchor, options.unitScale, offset, boneWorld)) - 1;
    attachNodeChild(nodes, scenes, boneIdx, emptyIdx);
  }
  attachRootHooksExtras(nodes, scenes, hooks);
  return {
    ...document,
    scenes,
    nodes,
    extras: {
      ...(document.extras ?? {}),
      ashfox: { ...(document.extras?.ashfox ?? {}), hooks },
    },
  };
};
