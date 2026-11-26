import { ProjectExportError } from '../contract';

const formatPath = (prefix: string, segment: string | number): string => `${prefix}.${segment}`;

const snapshotError = (
  errorMessage: string,
  prefix: string,
  segment: string | number | null,
  message: string,
): never => {
  const path = segment === null ? prefix : formatPath(prefix, segment);
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
  prefix: string,
  segment: string | number,
  errorMessage: string,
  descriptorMessage: string,
): PropertyDescriptor => {
  const descriptor = Object.getOwnPropertyDescriptor(target, key);
  if (
    descriptor === undefined ||
    !descriptor.enumerable ||
    !Object.prototype.hasOwnProperty.call(descriptor, 'value')
  ) {
    return snapshotError(errorMessage, prefix, segment, descriptorMessage);
  }
  return descriptor;
};

const assertDensePlainArray = (value: unknown[], path: string, errorMessage: string): void => {
  if (Object.getPrototypeOf(value) !== Array.prototype) {
    snapshotError(errorMessage, path, null, 'Export arrays must use the plain array prototype.');
  }
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== value.length + 1 || ownKeys[value.length] !== 'length') {
    snapshotError(
      errorMessage,
      path,
      null,
      'Export arrays must be dense and contain no extra fields.',
    );
  }
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.prototype.hasOwnProperty.call(value, index)) {
      snapshotError(
        errorMessage,
        path,
        null,
        'Export arrays must be dense and contain no extra fields.',
      );
    }
  }
};

const snapshotArray = (
  value: unknown[],
  prefix: string,
  segment: string | number | null,
  errorMessage: string,
  copies: WeakMap<object, unknown>,
  visiting: WeakSet<object>,
): readonly unknown[] => {
  const path = segment === null ? prefix : formatPath(prefix, segment);
  assertDensePlainArray(value, path, errorMessage);
  const copy = new Array<unknown>(value.length);
  copies.set(value, copy);
  visiting.add(value);
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = ownDataDescriptor(
      value,
      String(index),
      path,
      index,
      errorMessage,
      'Export array entries must be own enumerable data fields.',
    );
    copy[index] = snapshotData(descriptor.value, path, index, errorMessage, copies, visiting);
  }
  visiting.delete(value);
  return Object.freeze(copy);
};

const snapshotRecord = (
  value: object,
  prefix: string,
  segment: string | number | null,
  errorMessage: string,
  copies: WeakMap<object, unknown>,
  visiting: WeakSet<object>,
): Record<string, unknown> => {
  const path = segment === null ? prefix : formatPath(prefix, segment);
  if (Object.getPrototypeOf(value) !== Object.prototype) {
    return snapshotError(
      errorMessage,
      path,
      null,
      'Export records must use the plain object prototype.',
    );
  }
  const copy: Record<string, unknown> = {};
  copies.set(value, copy);
  visiting.add(value);
  const keys = Reflect.ownKeys(value);
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    if (typeof key !== 'string') {
      return snapshotError(
        errorMessage,
        path,
        null,
        'Export records must not contain symbol keys.',
      );
    }
    const descriptor = ownDataDescriptor(
      value,
      key,
      path,
      key,
      errorMessage,
      'Export fields must be own enumerable data properties.',
    );
    const snapped = snapshotData(descriptor.value, path, key, errorMessage, copies, visiting);
    if (key === '__proto__') {
      Object.defineProperty(copy, key, {
        configurable: false,
        enumerable: true,
        writable: false,
        value: snapped,
      });
    } else {
      copy[key] = snapped;
    }
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
  prefix: string,
  segment: string | number | null,
  errorMessage: string,
  copies: WeakMap<object, unknown>,
  visiting: WeakSet<object>,
): unknown => {
  if (isPrimitiveData(value)) return value;
  if (typeof value !== 'object' || value === null) {
    return snapshotError(
      errorMessage,
      prefix,
      segment,
      'Export fields must contain only canonical data values.',
    );
  }
  const existing = copies.get(value);
  if (existing !== undefined) {
    if (visiting.has(value)) {
      return snapshotError(errorMessage, prefix, segment, 'Export data must not contain cycles.');
    }
    return existing;
  }
  return Array.isArray(value)
    ? snapshotArray(value, prefix, segment, errorMessage, copies, visiting)
    : snapshotRecord(value, prefix, segment, errorMessage, copies, visiting);
};

/** Exact descriptor-based copy with no aliases into caller-owned data. */
export const snapshotExportData = <T>(value: T, path: string, errorMessage: string): T =>
  snapshotData(value, path, null, errorMessage, new WeakMap(), new WeakSet()) as T;
