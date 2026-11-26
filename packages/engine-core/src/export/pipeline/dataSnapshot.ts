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

const ownDataDescriptor = (
  target: object,
  key: string,
  path: string,
  errorMessage: string,
  descriptorMessage: string,
): PropertyDescriptor => {
  const descriptor = Object.getOwnPropertyDescriptor(target, key);
  if (
    descriptor === undefined ||
    !descriptor.enumerable ||
    !Object.prototype.hasOwnProperty.call(descriptor, 'value')
  ) {
    return snapshotError(errorMessage, path, descriptorMessage);
  }
  return descriptor;
};

const assertDensePlainArray = (value: unknown[], path: string, errorMessage: string): void => {
  if (Object.getPrototypeOf(value) !== Array.prototype) {
    snapshotError(errorMessage, path, 'Export arrays must use the plain array prototype.');
  }
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== value.length + 1 || ownKeys[value.length] !== 'length') {
    snapshotError(errorMessage, path, 'Export arrays must be dense and contain no extra fields.');
  }
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.prototype.hasOwnProperty.call(value, index)) {
      snapshotError(errorMessage, path, 'Export arrays must be dense and contain no extra fields.');
    }
  }
};

const snapshotArray = (
  value: unknown[],
  path: string,
  errorMessage: string,
  copies: WeakMap<object, unknown>,
  visiting: WeakSet<object>,
): readonly unknown[] => {
  assertDensePlainArray(value, path, errorMessage);
  const copy: unknown[] = [];
  copies.set(value, copy);
  visiting.add(value);
  for (let index = 0; index < value.length; index += 1) {
    const entryPath = `${path}.${index}`;
    const descriptor = ownDataDescriptor(
      value,
      String(index),
      entryPath,
      errorMessage,
      'Export array entries must be own enumerable data fields.',
    );
    copy.push(snapshotData(descriptor.value, entryPath, errorMessage, copies, visiting));
  }
  visiting.delete(value);
  return Object.freeze(copy);
};

const snapshotRecord = (
  value: object,
  path: string,
  errorMessage: string,
  copies: WeakMap<object, unknown>,
  visiting: WeakSet<object>,
): Record<string, unknown> => {
  if (Object.getPrototypeOf(value) !== Object.prototype) {
    return snapshotError(errorMessage, path, 'Export records must use the plain object prototype.');
  }
  const copy: Record<string, unknown> = {};
  copies.set(value, copy);
  visiting.add(value);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') {
      return snapshotError(errorMessage, path, 'Export records must not contain symbol keys.');
    }
    const entryPath = `${path}.${key}`;
    const descriptor = ownDataDescriptor(
      value,
      key,
      entryPath,
      errorMessage,
      'Export fields must be own enumerable data properties.',
    );
    Object.defineProperty(copy, key, {
      configurable: false,
      enumerable: true,
      writable: false,
      value: snapshotData(descriptor.value, entryPath, errorMessage, copies, visiting),
    });
  }
  visiting.delete(value);
  return Object.freeze(copy);
};

const isPrimitiveData = (value: unknown): boolean =>
  value === null ||
  value === undefined ||
  typeof value === 'string' ||
  typeof value === 'number' ||
  typeof value === 'boolean';

const snapshotData = (
  value: unknown,
  path: string,
  errorMessage: string,
  copies: WeakMap<object, unknown>,
  visiting: WeakSet<object>,
): unknown => {
  if (isPrimitiveData(value)) return value;
  if (typeof value !== 'object' || value === null) {
    return snapshotError(
      errorMessage,
      path,
      'Export fields must contain only canonical data values.',
    );
  }
  const existing = copies.get(value);
  if (existing !== undefined) {
    if (visiting.has(value)) {
      return snapshotError(errorMessage, path, 'Export data must not contain cycles.');
    }
    return existing;
  }
  return Array.isArray(value)
    ? snapshotArray(value, path, errorMessage, copies, visiting)
    : snapshotRecord(value, path, errorMessage, copies, visiting);
};

/** Exact descriptor-based copy with no aliases into caller-owned data. */
export const snapshotExportData = <T>(value: T, path: string, errorMessage: string): T =>
  snapshotData(value, path, errorMessage, new WeakMap(), new WeakSet()) as T;
