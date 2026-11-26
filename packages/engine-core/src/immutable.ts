const DEEPLY_FROZEN = new WeakSet<object>();

/** Shallow-freezes a value while keeping its mutable static type for builders. */
export const freeze = <T>(value: T): T => Object.freeze(value);

const isUnfrozenObject = (value: unknown): value is object =>
  typeof value === 'object' &&
  value !== null &&
  !ArrayBuffer.isView(value) &&
  !DEEPLY_FROZEN.has(value);

const freezeChildren = (value: object, seen: WeakSet<object>): void => {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const child = value[index];
      if (isUnfrozenObject(child)) freezeRecursive(child, seen);
    }
    return;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  for (let index = 0; index < keys.length; index += 1) {
    const child = record[keys[index]!];
    if (isUnfrozenObject(child)) freezeRecursive(child, seen);
  }
};

const freezeRecursive = <T>(value: T, seen: WeakSet<object>): T => {
  if (!isUnfrozenObject(value) || seen.has(value)) return value;
  seen.add(value);
  freezeChildren(value, seen);
  Object.freeze(value);
  DEEPLY_FROZEN.add(value);
  return value;
};

/** Recursively seals a canonical value while preserving object identity. */
export const deepFreeze = <T>(value: T, seen?: WeakSet<object>): T => {
  if (
    typeof value !== 'object' ||
    value === null ||
    ArrayBuffer.isView(value) ||
    DEEPLY_FROZEN.has(value)
  ) {
    return value;
  }
  return freezeRecursive(value, seen ?? new WeakSet<object>());
};
