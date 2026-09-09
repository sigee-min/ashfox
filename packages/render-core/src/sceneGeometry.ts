import * as THREE from 'three';

import {
  cubeGeometryPivot,
  cubeGeometryRotation,
  cubeUnrotatedBounds,
  type
  ProjectDocument,
  type SceneNode,
  type TextureAsset
} from '@ashfox/engine-core';

import { subtractVectors } from './sceneTransform';
import type { ProjectMaterialLibrary } from './sceneMaterials';
import type { ProjectSceneOptions } from './sceneTypes';

interface GeometryBuildContext {
  materials: ProjectMaterialLibrary;
  textures: ProjectDocument['textures'];
  options: ProjectSceneOptions;
  selectable: THREE.Object3D[];
}

const CUBE_MATERIAL_ORDER = [
  'east',
  'west',
  'up',
  'down',
  'south',
  'north'
] as const;

const rotateUvs = (
  corners: readonly [
    readonly [number, number],
    readonly [number, number],
    readonly [number, number],
    readonly [number, number]
  ],
  rotation: 0 | 90 | 180 | 270
) => {
  const turns = rotation / 90;
  const mappings = [
    [0, 1, 2, 3],
    [2, 0, 3, 1],
    [3, 2, 1, 0],
    [1, 3, 0, 2]
  ] as const;
  return mappings[turns].map((index) => corners[index]);
};

const normalizedFaceUvs = (
  texture: TextureAsset,
  uv: readonly [number, number, number, number],
  rotation: 0 | 90 | 180 | 270
) =>
  rotateUvs(
    [
      [uv[0] / texture.width, 1 - uv[1] / texture.height],
      [uv[2] / texture.width, 1 - uv[1] / texture.height],
      [uv[0] / texture.width, 1 - uv[3] / texture.height],
      [uv[2] / texture.width, 1 - uv[3] / texture.height]
    ],
    rotation
  );

const applyCubeFaceUvs = (
  geometry: THREE.BoxGeometry,
  node: Extract<SceneNode, { kind: 'cube' }>,
  textures: ProjectDocument['textures']
): void => {
  const attribute = geometry.getAttribute('uv');
  for (const [faceIndex, direction] of CUBE_MATERIAL_ORDER.entries()) {
    const face = node.faces[direction];
    const texture =
      face.textureId === null ? undefined : textures[face.textureId];
    if (!texture || !face.uv) continue;
    const uvs = normalizedFaceUvs(
      texture,
      face.uv,
      face.rotation ?? 0
    );
    for (const [cornerIndex, [u, v]] of uvs.entries()) {
      attribute.setXY(faceIndex * 4 + cornerIndex, u, v);
    }
  }
  attribute.needsUpdate = true;
};

const retainEnabledCubeFaces = (
  geometry: THREE.BoxGeometry,
  node: Extract<SceneNode, { kind: 'cube' }>
): readonly (typeof CUBE_MATERIAL_ORDER)[number][] => {
  const sourceIndex = geometry.getIndex();
  if (!sourceIndex) return [];
  const sourceGroups = [...geometry.groups];
  const enabledDirections = CUBE_MATERIAL_ORDER.filter(
    (direction) => node.faces[direction].enabled
  );
  const indices: number[] = [];
  geometry.clearGroups();
  for (const [materialIndex, direction] of enabledDirections.entries()) {
    const sourceMaterialIndex = CUBE_MATERIAL_ORDER.indexOf(direction);
    const sourceGroup =
      sourceGroups.find(
        (group) => group.materialIndex === sourceMaterialIndex
      ) ?? sourceGroups[sourceMaterialIndex];
    if (!sourceGroup) continue;
    const start = indices.length;
    for (
      let index = sourceGroup.start;
      index < sourceGroup.start + sourceGroup.count;
      index += 1
    ) {
      indices.push(sourceIndex.getX(index));
    }
    geometry.addGroup(start, sourceGroup.count, materialIndex);
  }
  geometry.setIndex(indices);
  return enabledDirections;
};

const addCubeGeometry = (
  node: Extract<SceneNode, { kind: 'cube' }>,
  group: THREE.Group,
  context: GeometryBuildContext
): void => {
  const bounds = cubeUnrotatedBounds(node);
  const pivot = cubeGeometryPivot(node);
  const rotation = cubeGeometryRotation(node);
  const size = subtractVectors(bounds.to, bounds.from);
  const geometry = new THREE.BoxGeometry(
    size[0] + node.inflate * 2,
    size[1] + node.inflate * 2,
    size[2] + node.inflate * 2
  );
  applyCubeFaceUvs(geometry, node, context.textures);
  const enabledDirections = retainEnabledCubeFaces(geometry, node);
  const center: [number, number, number] = [
    (bounds.from[0] + bounds.to[0]) / 2 - pivot[0],
    (bounds.from[1] + bounds.to[1]) / 2 - pivot[1],
    (bounds.from[2] + bounds.to[2]) / 2 - pivot[2]
  ];
  const materials = enabledDirections.map((direction) => {
    const textureId = context.options.showTextures === false
      ? null
      : node.faces[direction].textureId;
    return context.materials.resolve(textureId, node.lightEmission);
  });
  const mesh = new THREE.Mesh(geometry, materials);
  if (node.geometryMode === 'oriented-box') {
    const euler = new THREE.Euler(...rotation.map(THREE.MathUtils.degToRad) as
      [number, number, number], 'XYZ');
    const offset = new THREE.Vector3(...center).applyEuler(euler);
    mesh.position.set(pivot[0] + offset.x, pivot[1] + offset.y,
      pivot[2] + offset.z);
    mesh.rotation.copy(euler);
  } else {
    mesh.position.fromArray(center);
  }
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.nodeId = node.id;
  mesh.userData.kind = node.kind;
  group.add(mesh);
  context.selectable.push(mesh);

  if (!context.options.showWireframe) return;
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(geometry),
    new THREE.LineBasicMaterial({
      color: '#172028',
      transparent: true,
      opacity: 0.66
    })
  );
  edges.position.copy(mesh.position);
  if (node.geometryMode === 'oriented-box') edges.rotation.copy(mesh.rotation);
  edges.userData.overlay = true;
  group.add(edges);
};

const applyPlaneFaceUvs = (
  geometry: THREE.PlaneGeometry,
  node: Extract<SceneNode, { kind: 'plane' }>,
  direction: 'front' | 'back',
  textures: ProjectDocument['textures']
): void => {
  const face = node.faces[direction];
  const texture = face.textureId === null
    ? undefined : textures[face.textureId];
  if (!texture || !face.uv) return;
  const uvs = normalizedFaceUvs(texture, face.uv, face.rotation ?? 0);
  const attribute = geometry.getAttribute('uv');
  const order = direction === 'front' ? [2, 3, 0, 1] : [3, 2, 1, 0];
  for (const [vertex, source] of order.entries()) {
    const point = uvs[source]!;
    attribute.setXY(vertex, point[0], point[1]);
  }
  attribute.needsUpdate = true;
};

const planeMaterial = (
  material: THREE.Material,
  sidedness: Extract<SceneNode, { kind: 'plane' }>['sidedness']
): THREE.Material => {
  const result = material.clone();
  result.side = sidedness === 'double' ? THREE.DoubleSide : THREE.FrontSide;
  if ('alphaTest' in result) result.alphaTest = 0.5;
  // Canonical plane coverage is binary (0/255), so use an alpha-tested
  // cutout. It must participate in the depth buffer like a cube; blending and
  // depth-write suppression make intersecting decorative planes order-bound.
  if ('transparent' in result) result.transparent = false;
  if ('depthWrite' in result) result.depthWrite = true;
  result.needsUpdate = true;
  return result;
};

const addPlaneGeometry = (
  node: Extract<SceneNode, { kind: 'plane' }>,
  group: THREE.Group,
  context: GeometryBuildContext
): void => {
  const center: [number, number, number] = node.basis
    ? [
        node.basis.uAxis[0] * (node.size[0] / 2 - node.transform.pivot[0]) +
          node.basis.vAxis[0] * (node.size[1] / 2 - node.transform.pivot[1]) -
          node.basis.normal[0] * node.transform.pivot[2],
        node.basis.uAxis[1] * (node.size[0] / 2 - node.transform.pivot[0]) +
          node.basis.vAxis[1] * (node.size[1] / 2 - node.transform.pivot[1]) -
          node.basis.normal[1] * node.transform.pivot[2],
        node.basis.uAxis[2] * (node.size[0] / 2 - node.transform.pivot[0]) +
          node.basis.vAxis[2] * (node.size[1] / 2 - node.transform.pivot[1]) -
          node.basis.normal[2] * node.transform.pivot[2]
      ]
    : [
        node.size[0] / 2 - node.transform.pivot[0],
        node.size[1] / 2 - node.transform.pivot[1],
        -node.transform.pivot[2]
      ];
  // A canonical double-sided plane has identical front/back material and UV
  // records. One DoubleSide mesh avoids two coplanar depth writers (and the
  // resulting z-fighting) while retaining the source sidedness decision.
  const directions = ['front'] as const;
  for (const direction of directions) {
    const face = node.faces[direction];
    if (!face.enabled) continue;
    const geometry = new THREE.PlaneGeometry(node.size[0], node.size[1]);
    applyPlaneFaceUvs(geometry, node, direction, context.textures);
    const mesh = new THREE.Mesh(
      geometry,
      planeMaterial(
        context.materials.resolve(
          context.options.showTextures === false ? null : face.textureId
        ),
        node.sidedness
      )
    );
    mesh.position.fromArray(center);
    if (node.basis) {
      const basisMatrix = new THREE.Matrix4().makeBasis(
        new THREE.Vector3(...node.basis.uAxis),
        new THREE.Vector3(...node.basis.vAxis),
        new THREE.Vector3(...node.basis.normal)
      );
      mesh.setRotationFromMatrix(basisMatrix);
    }
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.nodeId = node.id;
    mesh.userData.kind = node.kind;
    mesh.userData.planeSide = direction;
    mesh.userData.ownsMaterial = true;
    group.add(mesh);
    context.selectable.push(mesh);
  }

  if (!context.options.showWireframe) return;
  const outline = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.PlaneGeometry(node.size[0], node.size[1])),
    new THREE.LineBasicMaterial({
      color: '#172028',
      transparent: true,
      opacity: 0.66
    })
  );
  outline.position.fromArray(center);
  if (node.basis) {
    const basisMatrix = new THREE.Matrix4().makeBasis(
      new THREE.Vector3(...node.basis.uAxis),
      new THREE.Vector3(...node.basis.vAxis),
      new THREE.Vector3(...node.basis.normal)
    );
    outline.setRotationFromMatrix(basisMatrix);
  }
  outline.userData.overlay = true;
  group.add(outline);
};

const addNodeHelper = (
  node: SceneNode,
  group: THREE.Group,
  selectable: THREE.Object3D[]
): void => {
  const helper =
    node.kind === 'locator'
      ? new THREE.AxesHelper(1.5)
      : new THREE.Mesh(
          new THREE.OctahedronGeometry(0.32, 0),
          new THREE.MeshBasicMaterial({
            color: node.kind === 'bone' ? '#e4a851' : '#7bd6d0',
            depthTest: false
          })
        );
  helper.renderOrder = 5;
  helper.userData.nodeId = node.id;
  helper.userData.kind = node.kind;
  helper.userData.overlay = true;
  group.add(helper);
  selectable.push(helper);
};

export const addNodeGeometry = (
  node: SceneNode,
  group: THREE.Group,
  context: GeometryBuildContext
): void => {
  if (node.kind === 'cube') addCubeGeometry(node, group, context);
  if (node.kind === 'plane') addPlaneGeometry(node, group, context);
  if (
    context.options.showSkeleton &&
    (node.kind === 'bone' || node.kind === 'locator')
  ) {
    addNodeHelper(node, group, context.selectable);
  }
};
