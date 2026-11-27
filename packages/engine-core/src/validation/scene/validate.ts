import { isExpressionVariantNode } from '../../model/expression';
import type { ProjectDocument } from '../../model';
import { isNonEmptyString, validateTransform } from '../shared/value';
import type { FindingSink, IdRegistrar } from '../contract';
import { validateCube } from './cube';
import { validatePlane } from './plane';
import { validateCylinder, validateTaper, validateWedge } from './primitive';

const validateRoots = (document: ProjectDocument, add: FindingSink): ReadonlySet<string> => {
  const rootSet = new Set<string>();
  for (const [index, rootId] of document.scene.roots.entries()) {
    if (rootSet.has(rootId)) {
      add({
        code: 'scene.root_duplicate',
        severity: 'error',
        message: `Root "${rootId}" appears more than once.`,
        path: `scene.roots[${index}]`,
        entityIds: [rootId],
      });
    }
    rootSet.add(rootId);
    const root = document.scene.nodes[rootId];
    if (!root) {
      add({
        code: 'scene.root_missing',
        severity: 'error',
        message: `Root "${rootId}" does not resolve to a scene node.`,
        path: `scene.roots[${index}]`,
        entityIds: [rootId],
      });
    } else if (root.parentId !== null) {
      add({
        code: 'scene.root_parent',
        severity: 'error',
        message: 'Root nodes must have parentId set to null.',
        path: `scene.nodes.${rootId}.parentId`,
        entityIds: [rootId],
      });
    }
  }
  return rootSet;
};

const validateParent = (
  document: ProjectDocument,
  nodeId: string,
  parentId: string | null,
  path: string,
  rootSet: ReadonlySet<string>,
  add: FindingSink,
): void => {
  if (parentId === null) {
    if (!rootSet.has(nodeId)) {
      add({
        code: 'scene.root_membership',
        severity: 'error',
        message: 'Every parentless node must appear in scene.roots.',
        path: `${path}.parentId`,
        entityIds: [nodeId],
      });
    }
    return;
  }

  const parent = document.scene.nodes[parentId];
  if (!parent) {
    add({
      code: 'scene.parent_missing',
      severity: 'error',
      message: `Parent "${parentId}" does not exist.`,
      path: `${path}.parentId`,
      entityIds: [nodeId, parentId],
    });
  } else if (parent.kind !== 'bone') {
    add({
      code: 'scene.parent_not_bone',
      severity: 'error',
      message: 'Scene nodes may only be parented to bones.',
      path: `${path}.parentId`,
      entityIds: [nodeId, parentId],
    });
  }
  if (rootSet.has(nodeId)) {
    add({
      code: 'scene.root_membership',
      severity: 'error',
      message: 'Parented nodes cannot appear in scene.roots.',
      path,
      entityIds: [nodeId],
    });
  }
};

const validateNodeKind = (
  nodeKey: string,
  node: ProjectDocument['scene']['nodes'][string],
  document: ProjectDocument,
  path: string,
  add: FindingSink,
): void => {
  if (node.kind === 'cube') validateCube(node, document, path, add);
  else if (node.kind === 'plane') validatePlane(node, document, path, add);
  else if (node.kind === 'taper') validateTaper(node, document, path, add);
  else if (node.kind === 'wedge') validateWedge(node, document, path, add);
  else if (node.kind === 'cylinder') validateCylinder(node, document, path, add);
  else if (node.kind !== 'bone' && node.kind !== 'locator') {
    add({
      code: 'scene.invalid_kind',
      severity: 'error',
      message: `Unsupported scene node kind "${String((node as { kind: unknown }).kind)}".`,
      path: `${path}.kind`,
      entityIds: [nodeKey],
    });
  }
};

const validateSingleNode = (
  nodeKey: string,
  node: ProjectDocument['scene']['nodes'][string],
  document: ProjectDocument,
  rootSet: ReadonlySet<string>,
  add: FindingSink,
  registerId: IdRegistrar,
): void => {
  const path = `scene.nodes.${nodeKey}`;
  registerId(node.id, path);
  if (nodeKey !== node.id) {
    add({
      code: 'identity.key_mismatch',
      severity: 'error',
      message: `Scene map key "${nodeKey}" does not match node ID "${node.id}".`,
      path,
      entityIds: [node.id],
    });
  }
  if (!isNonEmptyString(node.name)) {
    add({
      code: 'document.required_value',
      severity: 'error',
      message: 'Scene node names must be non-empty.',
      path: `${path}.name`,
      entityIds: [node.id],
    });
  }
  validateTransform(
    node.transform,
    `${path}.transform`,
    add,
    node.id,
    isExpressionVariantNode(node),
  );
  if (
    node.kind === 'locator' &&
    node.ignoreInheritedScale !== undefined &&
    typeof node.ignoreInheritedScale !== 'boolean'
  ) {
    add({
      code: 'document.required_value',
      severity: 'error',
      message: 'Locator ignoreInheritedScale must be a boolean.',
      path: `${path}.ignoreInheritedScale`,
      entityIds: [node.id],
    });
  }
  validateParent(document, node.id, node.parentId, path, rootSet, add);
  validateNodeKind(nodeKey, node, document, path, add);
};

const validateNodes = (
  document: ProjectDocument,
  rootSet: ReadonlySet<string>,
  add: FindingSink,
  registerId: IdRegistrar,
): void => {
  for (const [nodeKey, node] of Object.entries(document.scene.nodes)) {
    validateSingleNode(nodeKey, node, document, rootSet, add, registerId);
  }
};

const validateAcyclicHierarchy = (document: ProjectDocument, add: FindingSink): void => {
  const visitState = new Map<string, 'visiting' | 'visited'>();
  const visitNode = (nodeId: string): void => {
    const state = visitState.get(nodeId);
    if (state === 'visited') return;
    if (state === 'visiting') {
      add({
        code: 'scene.parent_cycle',
        severity: 'error',
        message: `Scene hierarchy contains a cycle at "${nodeId}".`,
        path: `scene.nodes.${nodeId}.parentId`,
        entityIds: [nodeId],
      });
      return;
    }
    visitState.set(nodeId, 'visiting');
    const parentId = document.scene.nodes[nodeId]?.parentId;
    if (parentId && document.scene.nodes[parentId]) visitNode(parentId);
    visitState.set(nodeId, 'visited');
  };
  Object.keys(document.scene.nodes).forEach(visitNode);
};

export const validateScene = (
  document: ProjectDocument,
  add: FindingSink,
  registerId: IdRegistrar,
): void => {
  const rootSet = validateRoots(document, add);
  validateNodes(document, rootSet, add, registerId);
  validateAcyclicHierarchy(document, add);
};
