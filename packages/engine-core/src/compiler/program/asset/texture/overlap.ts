interface Rectangle {
  readonly origin: readonly [number, number];
  readonly abiWidth: number;
  readonly abiHeight: number;
}

/** Detect any overlap among validated positive, finite atlas rectangles.
 * Sweep half-open x intervals; a compressed y segment tree counts coverage.
 * Detailed diagnostics remain owned by the original ordered pair traversal. */
export const hasChartOverlap = (rectangles: readonly Rectangle[]): boolean => {
  if (rectangles.length < 2) return false;
  const ys = [...new Set(rectangles.flatMap(rectangle =>
    [rectangle.origin[1], rectangle.origin[1] + rectangle.abiHeight]))].sort((a, b) => a - b);
  const positions = new Map(ys.map((value, index) => [value, index]));
  const events = rectangles.flatMap(rectangle => {
    const low = positions.get(rectangle.origin[1])!;
    const high = positions.get(rectangle.origin[1] + rectangle.abiHeight)!;
    return [
      { x: rectangle.origin[0], low, high, delta: 1 },
      { x: rectangle.origin[0] + rectangle.abiWidth, low, high, delta: -1 }
    ];
  }).sort((a, b) => a.x - b.x || a.delta - b.delta);
  // End events precede starts at the same x, so touching edges do not overlap.
  const maximum = new Int32Array(ys.length * 4);
  const cover = new Int32Array(ys.length * 4);
  const update = (node: number, left: number, right: number,
    low: number, high: number, delta: number): void => {
    if (high <= left || right <= low) return;
    if (low <= left && right <= high) cover[node]! += delta;
    else {
      const middle = Math.floor((left + right) / 2);
      update(node * 2, left, middle, low, high, delta);
      update(node * 2 + 1, middle, right, low, high, delta);
    }
    maximum[node] = cover[node]! + (right - left === 1 ? 0 :
      Math.max(maximum[node * 2]!, maximum[node * 2 + 1]!));
  };
  for (const event of events) {
    update(1, 0, ys.length - 1, event.low, event.high, event.delta);
    if (maximum[1]! > 1) return true;
  }
  return false;
};
