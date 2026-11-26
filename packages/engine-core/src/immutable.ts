const DEEPLY_FROZEN = new WeakSet<object>();

/** Shallow-freezes a value while keeping its mutable static type for builders. */
export const freeze = <T>(value: T): T => Object.freeze(value);

const freezeRecursive = <T>(value: T, seen: WeakSet<object>): T => {
  if (typeof value !== 'object' || value === null) return value;
  if (DEEPLY_FROZEN.has(value) || seen.has(value)) return value;
  seen.add(value);
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      freezeRecursive(value[index], seen);
    }
  } else {
    const record = value as Record<string, unknown>;
    for (const key in record) {
      if (Object.prototype.hasOwnProperty.call(record, key)) {
        freezeRecursive(record[key], seen);
      }
    }
  }
  Object.freeze(value);
  DEEPLY_FROZEN.add(value);
  return value;
};

/** Recursively seals a canonical value while preserving object identity. */
export const deepFreeze = <T>(value: T, seen?: WeakSet<object>): T => {
  if (typeof value !== 'object' || value === null || DEEPLY_FROZEN.has(value)) {
    return value;
  }
  return freezeRecursive(value, seen ?? new WeakSet<object>());
};
