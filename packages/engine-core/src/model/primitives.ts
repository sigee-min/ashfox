import type { UvRect, Vec2, Vec3 } from './identity';
import type { CubeFaceDirection, CylinderNode, TaperNode, WedgeNode } from './scene';

export interface PrimitivePolygon {
  readonly direction: CubeFaceDirection;
  readonly vertices: readonly Vec3[];
  readonly normal: Vec3;
  readonly uvWeights: readonly Vec2[];
}

const sub3 = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

const cross3 = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

const normalize3 = (v: Vec3, fallback: Vec3): Vec3 => {
  const len = Math.hypot(v[0], v[1], v[2]);
  return len > 1e-8 ? [v[0] / len, v[1] / len, v[2] / len] : fallback;
};

const polyNormal = (vertices: readonly Vec3[], fallback: Vec3): Vec3 => {
  if (vertices.length < 3) return fallback;
  return normalize3(
    cross3(sub3(vertices[1]!, vertices[0]!), sub3(vertices[2]!, vertices[0]!)),
    fallback,
  );
};

const QUAD_WEIGHTS: readonly Vec2[] = Object.freeze([
  [0, 1],
  [1, 1],
  [1, 0],
  [0, 0],
]);

const scaleAxisPair = (min: number, max: number, scale: number): readonly [number, number] => {
  const mid = (min + max) * 0.5;
  const half = (max - min) * 0.5 * scale;
  return [mid - half, mid + half];
};

const taperCorners = (node: TaperNode): readonly Vec3[] => {
  const inf = node.inflate;
  const f: Vec3 = [node.bounds.from[0] - inf, node.bounds.from[1] - inf, node.bounds.from[2] - inf];
  const t: Vec3 = [node.bounds.to[0] + inf, node.bounds.to[1] + inf, node.bounds.to[2] + inf];
  const pts: Vec3[] = [
    [f[0], f[1], f[2]],
    [t[0], f[1], f[2]],
    [t[0], t[1], f[2]],
    [f[0], t[1], f[2]],
    [f[0], f[1], t[2]],
    [t[0], f[1], t[2]],
    [t[0], t[1], t[2]],
    [f[0], t[1], t[2]],
  ];
  const [sx, sz] = node.topScale;
  if (node.axis === 'y') {
    const [x0, x1] = scaleAxisPair(f[0], t[0], sx);
    const [z0, z1] = scaleAxisPair(f[2], t[2], sz);
    pts[2] = [x1, t[1], z0];
    pts[3] = [x0, t[1], z0];
    pts[6] = [x1, t[1], z1];
    pts[7] = [x0, t[1], z1];
  } else if (node.axis === 'x') {
    const [y0, y1] = scaleAxisPair(f[1], t[1], sx);
    const [z0, z1] = scaleAxisPair(f[2], t[2], sz);
    pts[1] = [t[0], y0, z0];
    pts[2] = [t[0], y1, z0];
    pts[5] = [t[0], y0, z1];
    pts[6] = [t[0], y1, z1];
  } else {
    const [x0, x1] = scaleAxisPair(f[0], t[0], sx);
    const [y0, y1] = scaleAxisPair(f[1], t[1], sz);
    pts[4] = [x0, y0, t[2]];
    pts[5] = [x1, y0, t[2]];
    pts[6] = [x1, y1, t[2]];
    pts[7] = [x0, y1, t[2]];
  }
  return pts;
};

/** Outward polygons for a TaperNode with UVs aligned to its box faces. */
export const buildTaperPolygons = (node: TaperNode): readonly PrimitivePolygon[] => {
  const c = taperCorners(node);
  const defs: readonly {
    dir: CubeFaceDirection;
    idx: readonly [number, number, number, number];
    fb: Vec3;
  }[] = [
    { dir: 'north', idx: [1, 0, 3, 2], fb: [0, 0, -1] },
    { dir: 'south', idx: [4, 5, 6, 7], fb: [0, 0, 1] },
    { dir: 'east', idx: [5, 1, 2, 6], fb: [1, 0, 0] },
    { dir: 'west', idx: [0, 4, 7, 3], fb: [-1, 0, 0] },
    { dir: 'up', idx: [7, 6, 2, 3], fb: [0, 1, 0] },
    { dir: 'down', idx: [0, 1, 5, 4], fb: [0, -1, 0] },
  ];
  return defs.map((def) => {
    const vertices: Vec3[] = [c[def.idx[0]]!, c[def.idx[1]]!, c[def.idx[2]]!, c[def.idx[3]]!];
    return {
      direction: def.dir,
      vertices,
      normal: polyNormal(vertices, def.fb),
      uvWeights: QUAD_WEIGHTS,
    };
  });
};

/** Six unique corners of a wedge in local unrotated coordinates. */
const wedgeCornerSet = (node: WedgeNode): readonly Vec3[] => {
  const inf = node.inflate;
  const f: Vec3 = [node.bounds.from[0] - inf, node.bounds.from[1] - inf, node.bounds.from[2] - inf];
  const t: Vec3 = [node.bounds.to[0] + inf, node.bounds.to[1] + inf, node.bounds.to[2] + inf];
  // First 4 are the rectangular base; last 2 are the top ridge corners.
  if (node.slope === 'north') {
    return [
      [f[0], f[1], f[2]],
      [t[0], f[1], f[2]],
      [t[0], f[1], t[2]],
      [f[0], f[1], t[2]],
      [f[0], t[1], t[2]],
      [t[0], t[1], t[2]],
    ];
  }
  if (node.slope === 'south') {
    return [
      [f[0], f[1], f[2]],
      [t[0], f[1], f[2]],
      [t[0], f[1], t[2]],
      [f[0], f[1], t[2]],
      [f[0], t[1], f[2]],
      [t[0], t[1], f[2]],
    ];
  }
  if (node.slope === 'east') {
    return [
      [f[0], f[1], f[2]],
      [t[0], f[1], f[2]],
      [t[0], f[1], t[2]],
      [f[0], f[1], t[2]],
      [f[0], t[1], f[2]],
      [f[0], t[1], t[2]],
    ];
  }
  return [
    [f[0], f[1], f[2]],
    [t[0], f[1], f[2]],
    [t[0], f[1], t[2]],
    [f[0], f[1], t[2]],
    [t[0], t[1], f[2]],
    [t[0], t[1], t[2]],
  ];
};

const makePoly = (
  direction: CubeFaceDirection,
  vertices: readonly Vec3[],
  fallback: Vec3,
  uvWeights: readonly Vec2[],
): PrimitivePolygon => ({
  direction,
  vertices,
  normal: polyNormal(vertices, fallback),
  uvWeights,
});

/** Outward polygons (3 quads + 2 triangles = 8 triangles, 6 unique vertices) for a WedgeNode. */
export const buildWedgePolygons = (node: WedgeNode): readonly PrimitivePolygon[] => {
  const c = wedgeCornerSet(node);
  const down = makePoly('down', [c[0]!, c[1]!, c[2]!, c[3]!], [0, -1, 0], QUAD_WEIGHTS);
  const triW: readonly Vec2[] = [
    [0, 1],
    [1, 1],
    [0, 0],
  ];
  if (node.slope === 'north') {
    return [
      down,
      makePoly('south', [c[3]!, c[2]!, c[5]!, c[4]!], [0, 0, 1], QUAD_WEIGHTS),
      makePoly('up', [c[4]!, c[5]!, c[1]!, c[0]!], [0, 1, -1], QUAD_WEIGHTS),
      makePoly('east', [c[2]!, c[1]!, c[5]!], [1, 0, 0], triW),
      makePoly('west', [c[0]!, c[3]!, c[4]!], [-1, 0, 0], triW),
    ];
  }
  if (node.slope === 'south') {
    return [
      down,
      makePoly('north', [c[1]!, c[0]!, c[4]!, c[5]!], [0, 0, -1], QUAD_WEIGHTS),
      makePoly('up', [c[3]!, c[2]!, c[5]!, c[4]!], [0, 1, 1], QUAD_WEIGHTS),
      makePoly('east', [c[2]!, c[1]!, c[5]!], [1, 0, 0], triW),
      makePoly('west', [c[0]!, c[3]!, c[4]!], [-1, 0, 0], triW),
    ];
  }
  if (node.slope === 'east') {
    return [
      down,
      makePoly('west', [c[0]!, c[3]!, c[5]!, c[4]!], [-1, 0, 0], QUAD_WEIGHTS),
      makePoly('up', [c[2]!, c[1]!, c[4]!, c[5]!], [1, 1, 0], QUAD_WEIGHTS),
      makePoly('north', [c[1]!, c[0]!, c[4]!], [0, 0, -1], triW),
      makePoly('south', [c[3]!, c[2]!, c[5]!], [0, 0, 1], triW),
    ];
  }
  return [
    down,
    makePoly('east', [c[2]!, c[1]!, c[4]!, c[5]!], [1, 0, 0], QUAD_WEIGHTS),
    makePoly('up', [c[0]!, c[3]!, c[5]!, c[4]!], [-1, 1, 0], QUAD_WEIGHTS),
    makePoly('north', [c[1]!, c[0]!, c[4]!], [0, 0, -1], triW),
    makePoly('south', [c[3]!, c[2]!, c[5]!], [0, 0, 1], triW),
  ];
};

const cylinderRingPoint = (
  origin: Vec3,
  axis: 'x' | 'y' | 'z',
  along: number,
  radius: number,
  angle: number,
): Vec3 => {
  const ca = radius * Math.cos(angle);
  const sa = radius * Math.sin(angle);
  if (axis === 'y') return [origin[0] + ca, origin[1] + along, origin[2] + sa];
  if (axis === 'x') return [origin[0] + along, origin[1] + sa, origin[2] + ca];
  return [origin[0] + sa, origin[1] + ca, origin[2] + along];
};

const cylinderCapWeights = (sides: number, top: boolean): readonly Vec2[] => {
  const weights: Vec2[] = [];
  for (let i = 0; i < sides; i += 1) {
    const a = (i / sides) * Math.PI * 2;
    const x = 0.5 + 0.5 * Math.cos(a);
    const y = 0.5 + 0.5 * Math.sin(a);
    weights.push(top ? [x, 1 - y] : [x, y]);
  }
  return weights;
};

const cylinderSideDir = (midAngle: number): CubeFaceDirection => {
  const norm = ((midAngle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  if (norm < Math.PI * 0.25 || norm >= Math.PI * 1.75) return 'east';
  if (norm < Math.PI * 0.75) return 'south';
  if (norm < Math.PI * 1.25) return 'west';
  return 'north';
};

const pushCylinderSide = (
  polys: PrimitivePolygon[],
  node: CylinderNode,
  bottomPts: readonly Vec3[],
  topPts: readonly Vec3[],
  i: number,
): void => {
  const next = (i + 1) % node.sides;
  const midA = ((i + 0.5) / node.sides) * Math.PI * 2;
  const u0 = i / node.sides;
  const u1 = (i + 1) / node.sides;
  const fallback: Vec3 = [Math.cos(midA), 0, Math.sin(midA)];
  const dir = cylinderSideDir(midA);
  if (node.radius <= 1e-6) {
    polys.push(
      makePoly(dir, [bottomPts[i]!, topPts[i]!, topPts[next]!], fallback, [
        [(u0 + u1) * 0.5, 1],
        [u0, 0],
        [u1, 0],
      ]),
    );
    return;
  }
  if (node.radiusTop <= 1e-6) {
    polys.push(
      makePoly(dir, [bottomPts[next]!, bottomPts[i]!, topPts[i]!], fallback, [
        [u1, 1],
        [u0, 1],
        [(u0 + u1) * 0.5, 0],
      ]),
    );
    return;
  }
  polys.push(
    makePoly(dir, [bottomPts[next]!, bottomPts[i]!, topPts[i]!, topPts[next]!], fallback, [
      [u1, 1],
      [u0, 1],
      [u0, 0],
      [u1, 0],
    ]),
  );
};

/** Outward cap + barrel polygons for a CylinderNode. */
export const buildCylinderPolygons = (node: CylinderNode): readonly PrimitivePolygon[] => {
  const polys: PrimitivePolygon[] = [];
  const bottomPts: Vec3[] = [];
  const topPts: Vec3[] = [];
  for (let i = 0; i < node.sides; i += 1) {
    const a = (i / node.sides) * Math.PI * 2;
    bottomPts.push(cylinderRingPoint(node.origin, node.axis, 0, node.radius, a));
    topPts.push(cylinderRingPoint(node.origin, node.axis, node.height, node.radiusTop, a));
  }
  const downFallback: Vec3 =
    node.axis === 'y' ? [0, -1, 0] : node.axis === 'x' ? [-1, 0, 0] : [0, 0, -1];
  const upFallback: Vec3 = [-downFallback[0], -downFallback[1], -downFallback[2]];
  if (node.radius > 1e-6) {
    polys.push(makePoly('down', bottomPts, downFallback, cylinderCapWeights(node.sides, false)));
  }
  if (node.radiusTop > 1e-6) {
    polys.push(
      makePoly('up', [...topPts].reverse(), upFallback, cylinderCapWeights(node.sides, true)),
    );
  }
  for (let i = 0; i < node.sides; i += 1) pushCylinderSide(polys, node, bottomPts, topPts, i);
  return polys;
};

/** Dispatch polygon generation for taper, wedge, or cylinder primitives. */
export const buildPrimitivePolygons = (
  node: TaperNode | WedgeNode | CylinderNode,
): readonly PrimitivePolygon[] => {
  if (node.kind === 'taper') return buildTaperPolygons(node);
  if (node.kind === 'wedge') return buildWedgePolygons(node);
  return buildCylinderPolygons(node);
};

/** Unrotated local vertex cloud for measurement and collider bounds. */
export const primitiveLocalVertices = (
  node: TaperNode | WedgeNode | CylinderNode,
): readonly Vec3[] => {
  if (node.kind === 'taper') return taperCorners(node);
  if (node.kind === 'wedge') return wedgeCornerSet(node);
  return buildCylinderPolygons(node)
    .slice(0, 2)
    .flatMap((cap) => cap.vertices);
};

/** Rotate a normalized UV weight `(s, t)` inside `[0..1]` by cube face rotation steps. */
export const rotateUvWeight = (weight: Vec2, rotation: 0 | 90 | 180 | 270): Vec2 => {
  const steps = (rotation / 90) % 4;
  let u = weight[0];
  let v = weight[1];
  for (let i = 0; i < steps; i += 1) {
    const nextU = v;
    const nextV = 1 - u;
    u = nextU;
    v = nextV;
  }
  return [u, v];
};

/** Evaluate texel UV coordinates in `[0..1]` for glTF/RenderCore from face rect + weights. */
export const evalPolygonFaceUvs = (
  weights: readonly Vec2[],
  rect: UvRect,
  rotation: 0 | 90 | 180 | 270,
  texWidth: number,
  texHeight: number,
  flipV = false,
): readonly Vec2[] =>
  weights.map((weight) => {
    const [s, t] = rotateUvWeight(weight, rotation);
    const u = (rect[0] + s * (rect[2] - rect[0])) / texWidth;
    const vRaw = (rect[1] + t * (rect[3] - rect[1])) / texHeight;
    return [u, flipV ? 1 - vRaw : vRaw];
  });
