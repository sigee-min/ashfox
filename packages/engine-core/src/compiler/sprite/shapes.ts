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

export const rasterizeShapeMask = (
  shape: ShapeSpec,
  width: number,
  height: number,
  mirror: MirrorMode,
): Uint8Array => {
  const mask = new Uint8Array(width * height);
  const mx = mirror === 'x' || mirror === 'xy';
  const my = mirror === 'y' || mirror === 'xy';
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
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
