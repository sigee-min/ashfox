/** Shallow-freezes a value while keeping its mutable static type for builders. */
export const freeze = <T>(value: T): T => Object.freeze(value);

/** Recursively seals a canonical value while preserving object identity. */
export const deepFreeze = <T>(value: T, seen = new WeakSet<object>()): T => {
  if (typeof value !== 'object' || value === null || seen.has(value)) {
    return value;
  }
  seen.add(value);
  for (const child of Object.values(value as Record<string, unknown>)) {
    deepFreeze(child, seen);
  }
  return Object.freeze(value);
};
