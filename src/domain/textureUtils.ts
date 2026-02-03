export const resolveTextureSize = (
  primary: { width?: number; height?: number },
  ...fallbacks: Array<{ width?: number; height?: number } | undefined>
): { width?: number; height?: number } => {
  const pick = (value?: number): number | undefined =>
    typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
  const candidates = [primary, ...fallbacks].filter(Boolean) as Array<{ width?: number; height?: number }>;
  let width: number | undefined;
  let height: number | undefined;
  candidates.forEach((entry) => {
    if (width === undefined) width = pick(entry.width);
    if (height === undefined) height = pick(entry.height);
  });
  return { width, height };
};

export const normalizeTextureDimension = (value?: number): number | null => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  if (value <= 0) return null;
  return Math.trunc(value);
};

export const normalizeTextureSize = (
  width?: number,
  height?: number
): { width: number; height: number } | null => {
  const w = normalizeTextureDimension(width);
  const h = normalizeTextureDimension(height);
  if (!w || !h) return null;
  return { width: w, height: h };
};



