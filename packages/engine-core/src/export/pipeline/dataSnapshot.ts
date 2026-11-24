import { ProjectExportError } from '../contract';

const snapshotError = (errorMessage: string, path: string, message: string): never => {
  throw new ProjectExportError(errorMessage, [
    {
      code: 'format.unsupported_data',
      severity: 'error',
      path,
      message,
    },
  ]);
};

const snapshotData = (
  value: unknown,
  path: string,
  errorMessage: string,
  copies: WeakMap<object, unknown>,
  visiting: WeakSet<object>,
): unknown => {
  if (
    value === null ||
    value === undefined ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  )
    return value;
  if (typeof value !== 'object')
    return snapshotError(
      errorMessage,
      path,
      'Export fields must contain only canonical data values.',
    );
  const existing = copies.get(value);
  if (existing !== undefined) {
    if (visiting.has(value))
      return snapshotError(errorMessage, path, 'Export data must not contain cycles.');
    return existing;
  }
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype) {
      return snapshotError(errorMessage, path, 'Export arrays must use the plain array prototype.');
    }
    const ownKeys = Reflect.ownKeys(value);
    const expected = new Set([
      'length',
      ...Array.from({ length: value.length }, (_entry, index) => String(index)),
    ]);
    if (
      ownKeys.length !== expected.size ||
      ownKeys.some((key) => typeof key !== 'string' || !expected.has(key))
    ) {
      return snapshotError(
        errorMessage,
        path,
        'Export arrays must be dense and contain no extra fields.',
      );
    }
    const copy: unknown[] = [];
    copies.set(value, copy);
    visiting.add(value);
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (
        descriptor === undefined ||
        !descriptor.enumerable ||
        !Object.prototype.hasOwnProperty.call(descriptor, 'value')
      ) {
        return snapshotError(
          errorMessage,
          `${path}.${index}`,
          'Export array entries must be own enumerable data fields.',
        );
      }
      copy.push(snapshotData(descriptor.value, `${path}.${index}`, errorMessage, copies, visiting));
    }
    visiting.delete(value);
    return Object.freeze(copy);
  }
  if (Object.getPrototypeOf(value) !== Object.prototype) {
    return snapshotError(errorMessage, path, 'Export records must use the plain object prototype.');
  }
  const copy: Record<string, unknown> = {};
  copies.set(value, copy);
  visiting.add(value);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string')
      return snapshotError(errorMessage, path, 'Export records must not contain symbol keys.');
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      descriptor === undefined ||
      !descriptor.enumerable ||
      !Object.prototype.hasOwnProperty.call(descriptor, 'value')
    ) {
      return snapshotError(
        errorMessage,
        `${path}.${key}`,
        'Export fields must be own enumerable data properties.',
      );
    }
    Object.defineProperty(copy, key, {
      configurable: false,
      enumerable: true,
      writable: false,
      value: snapshotData(descriptor.value, `${path}.${key}`, errorMessage, copies, visiting),
    });
  }
  visiting.delete(value);
  return Object.freeze(copy);
};

/** Exact descriptor-based copy with no aliases into caller-owned data. */
export const snapshotExportData = <T>(value: T, path: string, errorMessage: string): T =>
  snapshotData(value, path, errorMessage, new WeakMap(), new WeakSet()) as T;
