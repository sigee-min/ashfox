import {
  buildPrimitivePolygons,
  evalPolygonFaceUvs,
  primitiveLocalVertices,
  type CylinderNode,
  type ProjectDocument,
  type TaperNode,
  type Vec3,
  type WedgeNode,
} from '../../../model';
import type { GltfPrimitiveData } from './data';
import type { GltfSceneCompileOptions } from './graph';
import { multiplyVec3 } from './spatial';

const subPivot = (v: Vec3, pivot: Vec3, scale: number): Vec3 =>
  multiplyVec3([v[0] - pivot[0], v[1] - pivot[1], v[2] - pivot[2]], scale);

/** Compute LOD world bounds points, unscaled volume, and enabled triangles for custom primitives. */
export const measureCustomPrimMetrics = (
  node: TaperNode | WedgeNode | CylinderNode,
  unitScale: number,
  xfScale: Vec3,
  xformPt: (local: Vec3) => Vec3,
): { readonly worldPts: Vec3[]; readonly volume: number; readonly triCount: number } => {
  const piv = node.transform.pivot;
  const pMin: [number, number, number] = [Infinity, Infinity, Infinity];
  const pMax: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  const worldPts: Vec3[] = [];
  for (const pt of primitiveLocalVertices(node)) {
    const local: Vec3 = [
      (pt[0] - piv[0]) * unitScale,
      (pt[1] - piv[1]) * unitScale,
      (pt[2] - piv[2]) * unitScale,
    ];
    worldPts.push(xformPt(local));
    for (let i = 0; i < 3; i += 1) {
      [pMin[i], pMax[i]] = [Math.min(pMin[i]!, local[i]!), Math.max(pMax[i]!, local[i]!)];
    }
  }
  const triCount = buildPrimitivePolygons(node).reduce(
    (sum, poly) =>
      sum + (node.faces[poly.direction].enabled ? Math.max(0, poly.vertices.length - 2) : 0),
    0,
  );
  const volume =
    ((pMax[0] - pMin[0]) *
      Math.abs(xfScale[0]) *
      (pMax[1] - pMin[1]) *
      Math.abs(xfScale[1]) *
      (pMax[2] - pMin[2]) *
      Math.abs(xfScale[2])) /
    unitScale ** 3;
  return { worldPts, volume: Math.max(0, volume), triCount };
};

const compileSinglePrimPoly = (
  poly: ReturnType<typeof buildPrimitivePolygons>[number],
  node: TaperNode | WedgeNode | CylinderNode,
  document: ProjectDocument,
  options: GltfSceneCompileOptions,
): GltfPrimitiveData | null => {
  const face = node.faces[poly.direction];
  if (!face.enabled || poly.vertices.length < 3) return null;
  const texture = face.textureId === null ? undefined : document.textures[face.textureId];
  const positions = poly.vertices.flatMap((v) =>
    subPivot(v, node.transform.pivot, options.unitScale),
  );
  const normals = poly.vertices.flatMap(() => poly.normal);
  const uvs =
    texture && face.uv
      ? evalPolygonFaceUvs(
          poly.uvWeights,
          face.uv,
          face.rotation ?? 0,
          texture.width,
          texture.height,
        ).flatMap((uv) => uv)
      : undefined;
  const indices: number[] = [];
  for (let i = 1; i + 1 < poly.vertices.length; i += 1) indices.push(0, i, i + 1);
  const material =
    face.textureId === null ? undefined : options.materialByTextureId.get(face.textureId);
  return {
    positions,
    normals,
    ...(uvs ? { uvs } : {}),
    ...(material === undefined ? {} : { material }),
    indices,
  };
};

/** Compile glTF primitive data for taper, wedge, or cylinder nodes. */
export const compileGltfCustomPrimitiveData = (
  document: ProjectDocument,
  node: TaperNode | WedgeNode | CylinderNode,
  options: GltfSceneCompileOptions,
): GltfPrimitiveData[] =>
  buildPrimitivePolygons(node)
    .map((poly) => compileSinglePrimPoly(poly, node, document, options))
    .filter((prim): prim is GltfPrimitiveData => prim !== null);
