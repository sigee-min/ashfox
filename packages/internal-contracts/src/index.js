'use strict';

/** Current-only serialized schema authorities. Historical internal registries,
 * generic version lookup, and unused routing versions are deliberately absent. */
const PROJECT_DOCUMENT_SCHEMA_VERSION = 1;
const COMMAND_RECEIPT_SCHEMA_VERSION = 1;
const EXPORT_BUNDLE_SCHEMA_VERSION = 1;
const SIDECAR_IPC_SCHEMA_VERSION = 1;
const TRACE_LOG_SCHEMA_VERSION = 1;
const SKILL_RELEASE_DESCRIPTOR_SCHEMA_VERSION = 2;

const isClosedContractRecord = (value) => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return false;
    if ('toJSON' in value) return false;
    return Reflect.ownKeys(value).every((key) => {
      if (typeof key !== 'string') return false;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return descriptor !== undefined &&
        descriptor.enumerable === true &&
        Object.prototype.hasOwnProperty.call(descriptor, 'value');
    });
  } catch (_error) {
    return false;
  }
};

const isDenseContractArray = (value) => {
  if (!Array.isArray(value)) return false;
  try {
    if (Object.getPrototypeOf(value) !== Array.prototype) return false;
    if ('toJSON' in value) return false;
    const keys = Reflect.ownKeys(value);
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
    if (
      !lengthDescriptor ||
      !Object.prototype.hasOwnProperty.call(lengthDescriptor, 'value') ||
      !Number.isSafeInteger(lengthDescriptor.value) ||
      lengthDescriptor.value < 0 ||
      keys.length !== lengthDescriptor.value + 1
    ) {
      return false;
    }
    for (const key of keys) {
      if (typeof key !== 'string') return false;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
        return false;
      }
      if (key === 'length') {
        if (descriptor.enumerable) return false;
        continue;
      }
      const index = Number(key);
      if (
        !Number.isSafeInteger(index) ||
        index < 0 ||
        index >= lengthDescriptor.value ||
        String(index) !== key ||
        !descriptor.enumerable
      ) {
        return false;
      }
    }
    return true;
  } catch (_error) {
    return false;
  }
};

const hasExactContractKeys = (value, keys) => {
  try {
    const actual = Reflect.ownKeys(value);
    return actual.length === keys.size &&
      actual.every((key) => typeof key === 'string' && keys.has(key));
  } catch (_error) {
    return false;
  }
};

const isCanonicalIsoDate = (value) => {
  if (typeof value !== 'string') return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value;
};

const isNonEmptyContractText = (value) =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.trim() === value;

const isUniqueContractTextArray = (value) =>
  (() => {
    if (!isDenseContractArray(value)) return false;
    const seen = new Set();
    for (let index = 0; index < value.length; index += 1) {
      const entry = value[index];
      if (!isNonEmptyContractText(entry) || seen.has(entry)) return false;
      seen.add(entry);
    }
    return true;
  })();

const FINITE_JSON_CONTRACT_MAX_DEPTH = 64;
const FINITE_JSON_CONTRACT_MAX_CONTAINERS = 100000;
const FINITE_JSON_CONTRACT_MAX_DEPTH_ALLOWANCE = 16;

const invalidFiniteJsonSnapshot = () => ({ ok: false });

const createFiniteJsonSnapshotAtDepth = (
  value,
  seen,
  depth,
  budget,
  options
) => {
  if (depth > options.maxDepth) return invalidFiniteJsonSnapshot();
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return { ok: true, value };
  }
  if (typeof value === 'number') {
    return Number.isFinite(value)
      ? { ok: true, value: Object.is(value, -0) ? 0 : value }
      : invalidFiniteJsonSnapshot();
  }
  if (typeof value !== 'object' || seen.has(value)) {
    return invalidFiniteJsonSnapshot();
  }
  budget.containers += 1;
  if (budget.containers > FINITE_JSON_CONTRACT_MAX_CONTAINERS) {
    return invalidFiniteJsonSnapshot();
  }
  seen.add(value);

  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype) {
      return invalidFiniteJsonSnapshot();
    }
    if (Reflect.has(value, 'toJSON')) return invalidFiniteJsonSnapshot();
    const keys = Reflect.ownKeys(value);
    const descriptors = new Map();
    for (const key of keys) {
      if (typeof key !== 'string') return invalidFiniteJsonSnapshot();
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
        return invalidFiniteJsonSnapshot();
      }
      descriptors.set(key, descriptor);
    }
    const lengthDescriptor = descriptors.get('length');
    if (
      !lengthDescriptor ||
      !Number.isSafeInteger(lengthDescriptor.value) ||
      lengthDescriptor.value < 0 ||
      keys.length !== lengthDescriptor.value + 1 ||
      lengthDescriptor.enumerable
    ) {
      return invalidFiniteJsonSnapshot();
    }
    const snapshot = [];
    for (let index = 0; index < lengthDescriptor.value; index += 1) {
      const descriptor = descriptors.get(String(index));
      if (!descriptor || !descriptor.enumerable) {
        return invalidFiniteJsonSnapshot();
      }
      const entry = createFiniteJsonSnapshotAtDepth(
        descriptor.value,
        seen,
        depth + 1,
        budget,
        options
      );
      if (!entry.ok) return entry;
      snapshot.push(entry.value);
    }
    seen.delete(value);
    return { ok: true, value: snapshot };
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return invalidFiniteJsonSnapshot();
  }
  if (Reflect.has(value, 'toJSON')) return invalidFiniteJsonSnapshot();
  const keys = Reflect.ownKeys(value);
  const snapshot = options.objectPrototype === 'standard'
    ? {}
    : Object.create(null);
  for (const key of keys) {
    if (typeof key !== 'string' || key === 'toJSON') {
      return invalidFiniteJsonSnapshot();
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      !descriptor ||
      !descriptor.enumerable ||
      !Object.prototype.hasOwnProperty.call(descriptor, 'value')
    ) {
      return invalidFiniteJsonSnapshot();
    }
    if (
      descriptor.value === undefined &&
      options.omitUndefinedObjectProperties
    ) {
      continue;
    }
    const entry = createFiniteJsonSnapshotAtDepth(
      descriptor.value,
      seen,
      depth + 1,
      budget,
      options
    );
    if (!entry.ok) return entry;
    Object.defineProperty(snapshot, key, {
      value: entry.value,
      enumerable: true,
      configurable: true,
      writable: true
    });
  }
  seen.delete(value);
  return { ok: true, value: snapshot };
};

const createFiniteJsonSnapshot = (value, options = {}) => {
  try {
    const requestedAllowance = Number.isSafeInteger(options.depthAllowance)
      ? Math.max(0, options.depthAllowance)
      : 0;
    const depthAllowance = Math.min(
      FINITE_JSON_CONTRACT_MAX_DEPTH_ALLOWANCE,
      requestedAllowance
    );
    return createFiniteJsonSnapshotAtDepth(
      value,
      new WeakSet(),
      0,
      { containers: 0 },
      {
        maxDepth: FINITE_JSON_CONTRACT_MAX_DEPTH + depthAllowance,
        omitUndefinedObjectProperties:
          options.omitUndefinedObjectProperties === true,
        objectPrototype:
          options.objectPrototype === 'standard' ? 'standard' : 'null'
      }
    );
  } catch (_error) {
    return invalidFiniteJsonSnapshot();
  }
};

const isFiniteJsonValue = (value) =>
  createFiniteJsonSnapshot(value).ok;

const utf8ContractByteLength = (value) => {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit <= 0x7f) {
      bytes += 1;
    } else if (codeUnit <= 0x7ff) {
      bytes += 2;
    } else if (
      codeUnit >= 0xd800 &&
      codeUnit <= 0xdbff &&
      index + 1 < value.length
    ) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else {
        bytes += 3;
      }
    } else {
      bytes += 3;
    }
  }
  return bytes;
};

module.exports = {
  COMMAND_RECEIPT_SCHEMA_VERSION,
  createFiniteJsonSnapshot,
  EXPORT_BUNDLE_SCHEMA_VERSION,
  FINITE_JSON_CONTRACT_MAX_CONTAINERS,
  FINITE_JSON_CONTRACT_MAX_DEPTH,
  hasExactContractKeys,
  isCanonicalIsoDate,
  isClosedContractRecord,
  isDenseContractArray,
  isFiniteJsonValue,
  isNonEmptyContractText,
  isUniqueContractTextArray,
  PROJECT_DOCUMENT_SCHEMA_VERSION,
  SIDECAR_IPC_SCHEMA_VERSION,
  SKILL_RELEASE_DESCRIPTOR_SCHEMA_VERSION,
  TRACE_LOG_SCHEMA_VERSION,
  utf8ContractByteLength
};
