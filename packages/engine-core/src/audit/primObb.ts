import { add3, dot3, length3, mul3, normalize3, sub3 } from '../math/vec3';
import type { Vec3 } from '../model/identity';
import {
  CUBE_FACE_DIRECTIONS,
  PLANE_FACE_DIRECTIONS,
  cubeUnrotatedBounds,
  type CubeFace,
  type CubeNode,
  type CylinderNode,
  type PlaneNode,
  type SceneNode,
  type TaperNode,
  type WedgeNode,
} from '../model/scene';
import { canonicalRotatePoint } from '../model/transform';
import type { TextureAsset } from '../model/texture';

export interface AuditFaceBinding {
  readonly nodeId: string;
  readonly direction: string;
  readonly face: CubeFace;
  readonly worldWidth: number;
  readonly worldHeight: number;
  readonly isTop: boolean;
  readonly isBottom: boolean;
}

export interface AuditObb {
  readonly nodeId: string;
  readonly parentId: string | null;
  readonly center: Vec3;
  readonly half: Vec3;
  readonly ax: Vec3;
  readonly ay: Vec3;
  readonly az: Vec3;
  readonly corners: readonly Vec3[];
  readonly aabbMin: Vec3;
  readonly aabbMax: Vec3;
  readonly volume: number;
  readonly angled: boolean;
  readonly isPlane: boolean;
  readonly solidPlane: boolean;
  readonly opaque: boolean;
}

interface TransparentMaskSpan {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

export interface TextureOpacityInfo {
  readonly detailsOpaque: boolean;
  readonly transparentMasks: readonly TransparentMaskSpan[];
}

const origin = (node: SceneNode): Vec3 => add3(node.transform.pivot, node.transform.position);

export const toModelSpace = (localPoint: Vec3, chain: readonly SceneNode[]): Vec3 => {
  let point = localPoint;
  for (let i = 0; i < chain.length; i += 1) {
    const owner = chain[i]!;
    const parent = chain[i + 1];
    const translation = sub3(origin(owner), parent ? origin(parent) : [0, 0, 0]);
    point = add3(
      canonicalRotatePoint(mul3(point, owner.transform.scale), owner.transform.rotation),
      translation,
    );
  }
  return point;
};

export const hasAngledRotation = (rot: Vec3): boolean => rot.some((deg) => Math.abs(deg) >= 2.5);

export const buildTextureOpacityCache = (
  textures: Readonly<Record<string, TextureAsset>>,
): Map<string, TextureOpacityInfo> => {
  const cache = new Map<string, TextureOpacityInfo>();
  for (const [id, tex] of Object.entries(textures)) {
    if (
      tex.renderMode !== 'default' ||
      tex.raster === undefined ||
      tex.raster.backgroundAlpha !== 255
    ) {
      cache.set(id, { detailsOpaque: false, transparentMasks: [] });
      continue;
    }
    if (!tex.raster.canvasDetails.every((d) => d.alpha === 255)) {
      cache.set(id, { detailsOpaque: false, transparentMasks: [] });
      continue;
    }
    const transparentMasks: TransparentMaskSpan[] = [];
    for (const m of tex.raster.alphaMasks ?? []) {
      if (m.bits.includes('0')) {
        transparentMasks.push({ x0: m.x, y0: m.y, x1: m.x + m.width, y1: m.y + m.height });
      }
    }
    cache.set(id, { detailsOpaque: true, transparentMasks });
  }
  return cache;
};

const faceMaskCoversUv = (face: CubeFace, masks: readonly TransparentMaskSpan[]): boolean => {
  if (masks.length === 0 || !face.uv) return false;
  const x0 = Math.min(face.uv[0], face.uv[2]);
  const x1 = Math.max(face.uv[0], face.uv[2]);
  const y0 = Math.min(face.uv[1], face.uv[3]);
  const y1 = Math.max(face.uv[1], face.uv[3]);
  return masks.some((m) => m.x0 < x1 && m.x1 > x0 && m.y0 < y1 && m.y1 > y0);
};

export const isOpaqueFace = (
  face: CubeFace,
  opacityCache: ReadonlyMap<string, TextureOpacityInfo>,
): boolean => {
  if (!face.enabled || face.textureId === null) return false;
  const info = opacityCache.get(face.textureId);
  return info !== undefined && info.detailsOpaque && !faceMaskCoversUv(face, info.transparentMasks);
};

export const buildObbFromBasisPoints = (
  nodeId: string,
  parentId: string | null,
  p000: Vec3,
  p100: Vec3,
  p010: Vec3,
  p001: Vec3,
  angled: boolean,
  isPlane: boolean,
  solidPlane: boolean,
  opaque: boolean,
): AuditObb => {
  const vx = sub3(p100, p000);
  const vy = sub3(p010, p000);
  const vz = sub3(p001, p000);
  const half: Vec3 = [length3(vx) * 0.5, length3(vy) * 0.5, length3(vz) * 0.5];
  const center: Vec3 = [
    p000[0] + (vx[0] + vy[0] + vz[0]) * 0.5,
    p000[1] + (vx[1] + vy[1] + vz[1]) * 0.5,
    p000[2] + (vx[2] + vy[2] + vz[2]) * 0.5,
  ];
  const corners: Vec3[] = [];
  const aabbMin: [number, number, number] = [Infinity, Infinity, Infinity];
  const aabbMax: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const sx of [0, 1]) {
    for (const sy of [0, 1]) {
      for (const sz of [0, 1]) {
        const c: Vec3 = [
          p000[0] + sx * vx[0] + sy * vy[0] + sz * vz[0],
          p000[1] + sx * vx[1] + sy * vy[1] + sz * vz[1],
          p000[2] + sx * vx[2] + sy * vy[2] + sz * vz[2],
        ];
        corners.push(c);
        for (let k = 0; k < 3; k += 1) {
          aabbMin[k] = Math.min(aabbMin[k]!, c[k]!);
          aabbMax[k] = Math.max(aabbMax[k]!, c[k]!);
        }
      }
    }
  }
  return {
    nodeId,
    parentId,
    center,
    half,
    ax: normalize3(vx),
    ay: normalize3(vy),
    az: normalize3(vz),
    corners,
    aabbMin,
    aabbMax,
    volume: Math.max(0, half[0] * half[1] * half[2] * 8),
    angled,
    isPlane,
    solidPlane,
    opaque,
  };
};

const customPrimBounds = (
  node: TaperNode | WedgeNode | CylinderNode,
): Readonly<{ from: Vec3; to: Vec3; angled: boolean }> => {
  if (node.kind === 'cylinder') {
    const r = Math.max(node.radius, node.radiusTop);
    const o = node.origin;
    if (node.axis === 'y') {
      return {
        from: [o[0] - r, o[1], o[2] - r],
        to: [o[0] + r, o[1] + node.height, o[2] + r],
        angled: true,
      };
    }
    if (node.axis === 'x') {
      return {
        from: [o[0], o[1] - r, o[2] - r],
        to: [o[0] + node.height, o[1] + r, o[2] + r],
        angled: true,
      };
    }
    return {
      from: [o[0] - r, o[1] - r, o[2]],
      to: [o[0] + r, o[1] + r, o[2] + node.height],
      angled: true,
    };
  }
  const inf = node.inflate;
  return {
    from: [node.bounds.from[0] - inf, node.bounds.from[1] - inf, node.bounds.from[2] - inf],
    to: [node.bounds.to[0] + inf, node.bounds.to[1] + inf, node.bounds.to[2] + inf],
    angled: true,
  };
};

export const customPrimObb = (
  node: TaperNode | WedgeNode | CylinderNode,
  chain: readonly SceneNode[],
  opacityCache: ReadonlyMap<string, TextureOpacityInfo>,
): AuditObb => {
  const { from, to, angled } = customPrimBounds(node);
  const mapPt = (pt: Vec3): Vec3 => toModelSpace(sub3(pt, node.transform.pivot), chain);
  const opaque =
    node.kind === 'taper' &&
    CUBE_FACE_DIRECTIONS.every((dir) => isOpaqueFace(node.faces[dir], opacityCache));
  return buildObbFromBasisPoints(
    node.id,
    node.parentId,
    mapPt([from[0], from[1], from[2]]),
    mapPt([to[0], from[1], from[2]]),
    mapPt([from[0], to[1], from[2]]),
    mapPt([from[0], from[1], to[2]]),
    angled || chain.some((entry) => hasAngledRotation(entry.transform.rotation)),
    false,
    false,
    opaque,
  );
};

const solidFaceDims = (
  dx: number,
  dy: number,
  dz: number,
  dir: string,
): readonly [number, number] => {
  if (dir === 'north' || dir === 'south') return [dx, dy];
  if (dir === 'east' || dir === 'west') return [dz, dy];
  return [dx, dz];
};

const collectSolidNodeFaces = (
  node: CubeNode | TaperNode | WedgeNode | CylinderNode,
  obb: AuditObb,
  worldCenterY: number,
  out: AuditFaceBinding[],
): void => {
  const b = node.kind === 'cube' ? cubeUnrotatedBounds(node) : customPrimBounds(node);
  const inf = node.kind === 'cube' ? node.inflate : 0;
  const dx = Math.abs(b.to[0] - b.from[0]) + inf * 2;
  const dy = Math.abs(b.to[1] - b.from[1]) + inf * 2;
  const dz = Math.abs(b.to[2] - b.from[2]) + inf * 2;
  for (const dir of CUBE_FACE_DIRECTIONS) {
    const face = node.faces[dir];
    if (!face.enabled) continue;
    const [worldWidth, worldHeight] = solidFaceDims(dx, dy, dz, dir);
    out.push({
      nodeId: node.id,
      direction: dir,
      face,
      worldWidth,
      worldHeight,
      isTop: dir === 'up' || (dir !== 'down' && obb.center[1] > worldCenterY),
      isBottom: dir === 'down' || (dir !== 'up' && obb.center[1] < worldCenterY),
    });
  }
};

export const collectNodeFaces = (
  node: CubeNode | PlaneNode | TaperNode | WedgeNode | CylinderNode,
  obb: AuditObb,
  worldCenterY: number,
  out: AuditFaceBinding[],
): void => {
  if (node.kind !== 'plane') {
    collectSolidNodeFaces(node, obb, worldCenterY, out);
    return;
  }
  const ny = Math.abs(dot3(obb.az, [0, 1, 0]));
  for (const dir of PLANE_FACE_DIRECTIONS) {
    const face = node.faces[dir];
    if (!face.enabled) continue;
    out.push({
      nodeId: node.id,
      direction: dir,
      face,
      worldWidth: node.size[0],
      worldHeight: node.size[1],
      isTop: ny > 0.5 || obb.center[1] > worldCenterY,
      isBottom: obb.center[1] < worldCenterY,
    });
  }
};
