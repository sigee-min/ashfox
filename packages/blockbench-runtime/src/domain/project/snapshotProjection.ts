import { CUBE_FACE_DIRECTIONS } from '@ashfox/blockbench-contracts/types/internal';

import type {
  SessionState,
  TrackedAnimation,
  TrackedBone,
  TrackedCube,
  TrackedMesh,
  TrackedTexture,
} from '../../session';

export const trackedBoneProjection = (bone: TrackedBone): unknown => [
  bone.id ?? null,
  bone.name,
  bone.parent ?? null,
  bone.pivot,
  bone.rotation ?? null,
  bone.scale ?? null,
  bone.visibility ?? null,
];

export const trackedCubeProjection = (cube: TrackedCube): unknown => [
  cube.id ?? null,
  cube.name,
  cube.bone,
  cube.from,
  cube.to,
  cube.origin ?? null,
  cube.rotation ?? null,
  cube.uv ?? null,
  cube.uvOffset ?? null,
  cube.inflate ?? null,
  cube.mirror ?? null,
  cube.visibility ?? null,
  cube.boxUv ?? null,
  cube.shade ?? null,
  cube.lightEmission ?? null,
  cube.rescale ?? null,
  CUBE_FACE_DIRECTIONS.map((direction) => {
    const face = cube.faces?.[direction];
    return [
      direction,
      face
        ? [
            face.enabled,
            face.texture ?? null,
            face.uv ?? null,
            face.rotation ?? null,
            face.cullface ?? null,
            face.tintIndex ?? null,
            face.materialInstance ?? null,
          ]
        : null,
    ];
  }),
];

export const trackedMeshProjection = (mesh: TrackedMesh): unknown => [
  mesh.id ?? null,
  mesh.name,
  mesh.bone ?? null,
  mesh.origin ?? null,
  mesh.rotation ?? null,
  mesh.visibility ?? null,
  mesh.uvPolicy ?? null,
  mesh.vertices.map((vertex) => [vertex.id, vertex.pos]),
  mesh.faces.map((face) => [
    face.id ?? null,
    face.vertices,
    face.uv?.map((entry) => [entry.vertexId, entry.uv]) ?? null,
    face.texture ?? null,
  ]),
];

export const trackedTextureProjection = (texture: TrackedTexture): unknown => [
  texture.id ?? null,
  texture.name,
  texture.path ?? null,
  texture.width ?? null,
  texture.height ?? null,
  texture.contentHash ?? null,
  texture.namespace ?? null,
  texture.folder ?? null,
  texture.particle ?? null,
  texture.visible ?? null,
  texture.renderMode ?? null,
  texture.renderSides ?? null,
  texture.pbrChannel ?? null,
  texture.group ?? null,
  texture.frameTime ?? null,
  texture.frameOrderType ?? null,
  texture.frameOrder ?? null,
  texture.frameInterpolate ?? null,
  texture.internal ?? null,
  texture.keepSize ?? null,
];

const stableUnknownProjection = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stableUnknownProjection);
  if (typeof value !== 'object' || value === null) return value;
  return Object.keys(value)
    .sort((left, right) => left.localeCompare(right))
    .map((key) => [
      key,
      stableUnknownProjection(Object.getOwnPropertyDescriptor(value, key)?.value),
    ]);
};

export const trackedAnimationProjection = (animation: TrackedAnimation): unknown => [
  animation.id ?? null,
  animation.name,
  animation.length,
  animation.loop,
  animation.fps ?? null,
  animation.channels?.map((channel) => [
    channel.bone,
    channel.channel,
    channel.keys.map((key) => [key.time, key.value, key.interp ?? null]),
  ]) ?? null,
  animation.triggers?.map((trigger) => [
    trigger.type,
    trigger.keys.map((key) => [key.time, stableUnknownProjection(key.value)]),
  ]) ?? null,
];

export const sessionRevisionProjection = (snapshot: SessionState): unknown => ({
  id: snapshot.id ?? null,
  format: snapshot.format ?? null,
  formatId: snapshot.formatId ?? null,
  name: snapshot.name ?? null,
  dirty: snapshot.dirty ?? null,
  uvPixelsPerBlock: snapshot.uvPixelsPerBlock ?? null,
  bones: snapshot.bones.map(trackedBoneProjection),
  cubes: snapshot.cubes.map(trackedCubeProjection),
  meshes: (snapshot.meshes ?? []).map(trackedMeshProjection),
  textures: snapshot.textures.map(trackedTextureProjection),
  animations: snapshot.animations.map(trackedAnimationProjection),
  animationsStatus: snapshot.animationsStatus ?? null,
  animationTimePolicy: [
    snapshot.animationTimePolicy.timeEpsilon,
    snapshot.animationTimePolicy.triggerDedupeByValue,
  ],
});
