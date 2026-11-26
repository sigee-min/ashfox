import type { MirrorMode, Point, ShapeSpec } from '../../project/sprite/contract';

const pointInPolygon = (px: number, py: number, pts: readonly Point[]): boolean => {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i]![0] + 0.5,
      yi = pts[i]![1] + 0.5;
    const xj = pts[j]![0] + 0.5,
      yj = pts[j]![1] + 0.5;
    const cross = yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi + 1e-9) + xi;
    if (cross) inside = !inside;
  }
  return inside;
};

const distToSegment = (
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): number => {
  const dx = x2 - x1,
    dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq <= 1e-9) return Math.hypot(px - x1, py - y1);
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lenSq));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
};

export const insideShape = (shape: ShapeSpec, x: number, y: number): boolean => {
  const px = x + 0.5,
    py = y + 0.5;
  if (shape.kind === 'rect') {
    return x >= shape.x && y >= shape.y && x < shape.x + shape.width && y < shape.y + shape.height;
  }
  if (shape.kind === 'ellipse') {
    const nx = (px - (shape.cx + 0.5)) / shape.rx;
    const ny = (py - (shape.cy + 0.5)) / shape.ry;
    return nx * nx + ny * ny <= 1.0;
  }
  if (shape.kind === 'capsule') {
    return (
      distToSegment(px, py, shape.x1 + 0.5, shape.y1 + 0.5, shape.x2 + 0.5, shape.y2 + 0.5) <=
      shape.radius
    );
  }
  if (shape.kind === 'line') {
    return (
      distToSegment(px, py, shape.x1 + 0.5, shape.y1 + 0.5, shape.x2 + 0.5, shape.y2 + 0.5) <=
      shape.thickness * 0.5
    );
  }
  return pointInPolygon(px, py, shape.points);
};

const markMirrored = (
  mask: Uint8Array,
  x: number,
  y: number,
  width: number,
  height: number,
  mx: boolean,
  my: boolean,
): void => {
  mask[y * width + x] = 1;
  if (mx) mask[y * width + (width - 1 - x)] = 1;
  if (my) mask[(height - 1 - y) * width + x] = 1;
  if (mx && my) mask[(height - 1 - y) * width + (width - 1 - x)] = 1;
};

const shapeBounds = (
  shape: ShapeSpec,
  width: number,
  height: number,
): readonly [number, number, number, number] => {
  if (shape.kind === 'rect') {
    return [
      Math.max(0, Math.floor(shape.x)),
      Math.max(0, Math.floor(shape.y)),
      Math.min(width, Math.ceil(shape.x + shape.width)),
      Math.min(height, Math.ceil(shape.y + shape.height)),
    ];
  }
  if (shape.kind === 'ellipse') {
    return [
      Math.max(0, Math.floor(shape.cx - shape.rx)),
      Math.max(0, Math.floor(shape.cy - shape.ry)),
      Math.min(width, Math.ceil(shape.cx + shape.rx) + 1),
      Math.min(height, Math.ceil(shape.cy + shape.ry) + 1),
    ];
  }
  if (shape.kind === 'capsule' || shape.kind === 'line') {
    const pad = Math.ceil(shape.kind === 'capsule' ? shape.radius : shape.thickness * 0.5) + 1;
    return [
      Math.max(0, Math.floor(Math.min(shape.x1, shape.x2)) - pad),
      Math.max(0, Math.floor(Math.min(shape.y1, shape.y2)) - pad),
      Math.min(width, Math.ceil(Math.max(shape.x1, shape.x2)) + pad + 1),
      Math.min(height, Math.ceil(Math.max(shape.y1, shape.y2)) + pad + 1),
    ];
  }
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let i = 0; i < shape.points.length; i += 1) {
    const pt = shape.points[i]!;
    if (pt[0] < minX) minX = pt[0];
    if (pt[0] > maxX) maxX = pt[0];
    if (pt[1] < minY) minY = pt[1];
    if (pt[1] > maxY) maxY = pt[1];
  }
  return [
    Math.max(0, Math.floor(minX) - 1),
    Math.max(0, Math.floor(minY) - 1),
    Math.min(width, Math.ceil(maxX) + 2),
    Math.min(height, Math.ceil(maxY) + 2),
  ];
};

export const rasterizeShapeMask = (
  shape: ShapeSpec,
  width: number,
  height: number,
  mirror: MirrorMode,
): Uint8Array => {
  const mask = new Uint8Array(width * height);
  const mx = mirror === 'x' || mirror === 'xy';
  const my = mirror === 'y' || mirror === 'xy';
  const [x0, y0, x1, y1] = shapeBounds(shape, width, height);
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      if (insideShape(shape, x, y)) markMirrored(mask, x, y, width, height, mx, my);
    }
  }
  return mask;
};

export const maskBounds = (
  mask: Uint8Array,
  width: number,
  height: number,
): readonly [number, number, number, number] | null => {
  let minX = width,
    minY = height,
    maxX = -1,
    maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!mask[y * width + x]) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  return maxX < 0 ? null : [minX, minY, maxX - minX + 1, maxY - minY + 1];
};
