import { CUBE_FACE_DIRECTIONS, PLANE_FACE_DIRECTIONS, type ProjectDocument } from '../model';
import { effectivelyVisibleSceneNodeIds } from '../sceneVisibility';
import type { ProductionReadinessFinding } from './contract';

export interface GeometryReadiness {
  findings: readonly ProductionReadinessFinding[];
  visibleNodeIds: ReadonlySet<string>;
  counts: {
    visibleGeometry: number;
    enabledVisibleFaces: number;
    texturedVisibleFaces: number;
    untexturedVisibleFaces: number;
  };
}

const visibleGeometry = (
  document: ProjectDocument,
  visibleNodeIds: ReadonlySet<string>,
): {
  geometryIds: readonly string[];
  textureIds: readonly (string | null)[];
} => {
  const geometryIds: string[] = [];
  const textureIds: (string | null)[] = [];
  for (const node of Object.values(document.scene.nodes)) {
    if (!visibleNodeIds.has(node.id)) continue;
    if (node.kind === 'cube') {
      const enabledFaces = CUBE_FACE_DIRECTIONS.map((direction) => node.faces[direction]).filter(
        (face) => face.enabled,
      );
      if (enabledFaces.length > 0) geometryIds.push(node.id);
      textureIds.push(...enabledFaces.map((face) => face.textureId));
      continue;
    }
    if (node.kind === 'plane') {
      const enabledFaces = PLANE_FACE_DIRECTIONS.map((direction) => node.faces[direction]).filter(
        (face) => face.enabled,
      );
      if (enabledFaces.length > 0) geometryIds.push(node.id);
      textureIds.push(...enabledFaces.map((face) => face.textureId));
    }
  }
  return { geometryIds, textureIds };
};

const geometryFindings = (
  geometryIds: readonly string[],
  faceCount: number,
  untexturedFaceCount: number,
): readonly ProductionReadinessFinding[] => {
  if (geometryIds.length === 0) {
    return [
      {
        code: 'production.geometry_missing',
        severity: 'error',
        message: 'The project has no effectively visible renderable geometry.',
        path: 'scene.nodes',
        fix: 'Compile one complete selected workspace entry.',
      },
    ];
  }
  if (faceCount === 0 || untexturedFaceCount > 0) {
    return [
      {
        code: 'production.texture_coverage_incomplete',
        severity: 'error',
        message:
          `${untexturedFaceCount} of ${faceCount} visible faces do not ` +
          'resolve to a texture asset.',
        path: 'scene.nodes',
        entityIds: geometryIds,
        fix: 'Correct the authored source and bind an explicit material texture.',
      },
    ];
  }
  return [];
};

export const evaluateGeometryReadiness = (document: ProjectDocument): GeometryReadiness => {
  const visibleNodeIds = effectivelyVisibleSceneNodeIds(document);
  const { geometryIds, textureIds } = visibleGeometry(document, visibleNodeIds);
  const texturedVisibleFaces = textureIds.filter(
    (textureId) => textureId !== null && document.textures[textureId] !== undefined,
  ).length;
  const untexturedVisibleFaces = textureIds.length - texturedVisibleFaces;
  return {
    findings: geometryFindings(geometryIds, textureIds.length, untexturedVisibleFaces),
    visibleNodeIds,
    counts: {
      visibleGeometry: geometryIds.length,
      enabledVisibleFaces: textureIds.length,
      texturedVisibleFaces,
      untexturedVisibleFaces,
    },
  };
};
