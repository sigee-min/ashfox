import { IDENTITY_TRANSFORM, type CubeFace, type CubeFaces, type ProjectDocument } from '../src';
import { createProjectDocument } from '../src/project/create';

const face = (textureId: string): CubeFace => ({
  enabled: true,
  textureId,
  uv: [0, 0, 16, 16],
  rotation: 0,
});

const createFaces = (textureId: string): CubeFaces => ({
  north: face(textureId),
  south: face(textureId),
  east: face(textureId),
  west: face(textureId),
  up: face(textureId),
  down: face(textureId),
});

/** Noncanonical scene-consumer fixture used to exercise rotated delivery data. */
export const createSceneProject = (): ProjectDocument => {
  const document = createProjectDocument({
    id: 'project-crate',
    name: 'ashfox_crate',
    revision: 'revision-1',
    createdAt: '2026-07-28T00:00:00.000Z',
  });
  return {
    ...document,
    scene: {
      roots: ['bone-root'],
      nodes: {
        'bone-root': {
          id: 'bone-root',
          kind: 'bone',
          name: 'root',
          parentId: null,
          transform: {
            ...IDENTITY_TRANSFORM,
            pivot: [0, 0, 0],
          },
          visible: true,
        },
        'cube-body': {
          id: 'cube-body',
          kind: 'cube',
          geometryMode: 'axis-box',
          name: 'body',
          parentId: 'bone-root',
          transform: {
            ...IDENTITY_TRANSFORM,
            rotation: [0, 45, 0],
            pivot: [0, 4, 0],
          },
          visible: true,
          bounds: {
            from: [-4, 0, -4],
            to: [4, 8, 4],
          },
          inflate: 0,
          mirror: false,
          boxUv: false,
          faces: createFaces('texture-base'),
        },
      },
    },
    textures: {
      'texture-base': {
        id: 'texture-base',
        name: 'ashfox_crate',
        width: 64,
        height: 64,
        source: {
          bucket: 'textures',
          key: 'project-crate/ashfox_crate.png',
          contentType: 'image/png',
          contentHash: 'sha256:crate',
          byteLength: 256,
        },
        visible: true,
        sampling: 'nearest',
        colorSpace: 'srgb',
        renderMode: 'default',
        renderSides: 'front',
        atlasMode: 'preserve',
      },
    },
  };
};
